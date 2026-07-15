import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { D1VerificationMarketStore } from "../services/verification/d1-verification-market-store.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
const problemRevisionId = "problem-revision:formal-conjectures:erdos-865:k2:1";
const poolId = "pool:formal-conjectures:erdos-865:k2:pilot-v1";
const manifestHash = sha("a");
let miniflare;
let database;
let store;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  await seedMarketFixture(database);
  store = new D1VerificationMarketStore(database);
});

after(async () => {
  await miniflare?.dispose();
});

test("an active pool publishes exactly the policy review jobs for one staged Bundle", async () => {
  const draftBundle = await seedSecondBundle(database, sha("b"));
  const draft = await store.publishJobsForBundle(draftBundle, "2026-07-15T07:59:59Z");
  assert.equal(draft.published, false);
  assert.equal(draft.reason, "pool_draft");

  await activatePool(database);
  const published = await store.publishJobsForBundle(manifestHash, "2026-07-15T08:00:00Z");
  assert.equal(published.published, true);
  assert.equal(published.jobs.length, 3);
  assert.deepEqual(
    published.jobs.map(({ claimType, rewardWeight }) => ({ claimType, rewardWeight })),
    [
      { claimType: "bundle_reproducible", rewardWeight: 1 },
      { claimType: "novelty_reviewed", rewardWeight: 2 },
      { claimType: "statement_faithful", rewardWeight: 2 },
    ],
  );
  assert.equal((await store.publishJobsForBundle(manifestHash, "2026-07-15T08:00:00Z")).jobs.length, 3);

  const open = await store.listOpenJobs();
  assert.equal(open.length, 3);
  assert.equal(open[0].target.problemSlug, "erdos-865-k2");
  assert.equal(open[0].pool.verificationBucketPercentage, 20);
  assert.equal(open.every((job) => !Object.hasOwn(job, "attemptOwnerPersonId")), true);
});

test("claiming is atomic, different-owner, review-delegated, and immediately accepted", async () => {
  const [job] = await store.listOpenJobs();
  await assert.rejects(
    store.claimJob(job.id, "person:market-owner", "2026-07-15T08:01:00Z"),
    /own Attempt/,
  );
  await assert.rejects(
    store.claimJob(job.id, "person:no-review-agent", "2026-07-15T08:01:00Z"),
    /active review-scoped Agent delegation/,
  );

  const claimed = await store.claimJob(job.id, "person:market-reviewer", "2026-07-15T08:01:00Z");
  assert.equal(claimed.created, true);
  assert.equal(claimed.assignment.status, "accepted");
  assert.equal(claimed.assignment.claimType, job.claimType);
  assert.equal((await store.claimJob(job.id, "person:market-reviewer", "2026-07-15T08:01:30Z")).created, false);
  await assert.rejects(
    store.claimJob(job.id, "person:market-reviewer-two", "2026-07-15T08:01:30Z"),
    /already been claimed by another Person/,
  );

  const assignmentEvents = await database.prepare(
    "SELECT sequence, event_type, status FROM verification_assignment_events WHERE assignment_id = ? ORDER BY sequence",
  ).bind(claimed.assignment.id).all();
  assert.deepEqual(assignmentEvents.results, [
    { sequence: 1, event_type: "assignment_created", status: "assigned" },
    { sequence: 2, event_type: "assignment_accepted", status: "accepted" },
  ]);
  const jobEvents = await database.prepare(
    "SELECT sequence, event_type FROM verification_market_job_events WHERE job_id = ? ORDER BY sequence",
  ).bind(job.id).all();
  assert.deepEqual(jobEvents.results, [
    { sequence: 1, event_type: "published" },
    { sequence: 2, event_type: "claimed" },
  ]);
  assert.equal((await store.listOpenJobs()).length, 2);
});

test("two concurrent reviewers can create only one immutable claim", async () => {
  const [job] = await store.listOpenJobs();
  const results = await Promise.allSettled([
    store.claimJob(job.id, "person:market-reviewer", "2026-07-15T08:02:00Z"),
    store.claimJob(job.id, "person:market-reviewer-two", "2026-07-15T08:02:00Z"),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const claimCount = await database.prepare(
    "SELECT COUNT(*) AS count FROM verification_market_job_claims WHERE job_id = ?",
  ).bind(job.id).first();
  assert.equal(Number(claimCount.count), 1);
});

test("verification market jobs and claims cannot be rewritten or deleted", async () => {
  const row = await database.prepare("SELECT id FROM verification_market_jobs LIMIT 1").first();
  await assert.rejects(
    database.prepare("UPDATE verification_market_jobs SET reward_weight = 99 WHERE id = ?").bind(row.id).run(),
    /verification market jobs are immutable/,
  );
  await assert.rejects(
    database.prepare("DELETE FROM verification_market_job_claims").run(),
    /verification market job claims cannot be deleted/,
  );
});

async function seedMarketFixture(d1) {
  await d1.batch([
    personStatement(d1, "person:market-owner", "market-owner", "Market Owner"),
    personStatement(d1, "person:market-reviewer", "market-reviewer", "Market Reviewer"),
    personStatement(d1, "person:market-reviewer-two", "market-reviewer-two", "Market Reviewer Two"),
    personStatement(d1, "person:no-review-agent", "no-review-agent", "No Review Agent"),
    d1.prepare(
      "INSERT INTO agent_attempts (id, person_id, problem_revision_id, agent_label, idempotency_key, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind("attempt:verification-market", "person:market-owner", problemRevisionId, "Market Prover", "verification-market", "2026-07-15T07:00:00Z"),
    d1.prepare(
      "INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)",
    ).bind(manifestHash, `bundles/sha256/${"a".repeat(64)}/bundle.json`, 2, "application/json"),
    d1.prepare(
      `INSERT INTO artifact_bundles (
         id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
         canonical_manifest, agent_event_id, agent_event_payload_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "bundle:verification-market",
      "attempt:verification-market",
      problemRevisionId,
      manifestHash,
      `bundles/sha256/${"a".repeat(64)}/bundle.json`,
      "{}",
      "agent-event:verification-market",
      sha("c"),
    ),
  ]);
  await seedReviewDelegation(d1, "market-reviewer", "person:market-reviewer", "1");
  await seedReviewDelegation(d1, "market-reviewer-two", "person:market-reviewer-two", "2");
}

async function seedSecondBundle(d1, hash) {
  await d1.batch([
    d1.prepare(
      "INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)",
    ).bind(hash, `bundles/sha256/${hash.slice("sha256:".length)}/bundle.json`, 2, "application/json"),
    d1.prepare(
      `INSERT INTO artifact_bundles (
         id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
         canonical_manifest, agent_event_id, agent_event_payload_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "bundle:verification-market-draft",
      "attempt:verification-market",
      problemRevisionId,
      hash,
      `bundles/sha256/${hash.slice("sha256:".length)}/bundle.json`,
      "{}",
      "agent-event:verification-market-draft",
      sha("d"),
    ),
  ]);
  return hash;
}

async function seedReviewDelegation(d1, suffix, personId, fingerprintCharacter) {
  const publicKey = `agent-public-key-${suffix}`;
  await d1.batch([
    d1.prepare(
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
    ).bind(`agent:${suffix}`, personId, suffix, publicKey, sha(fingerprintCharacter)),
    d1.prepare(
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
    ).bind(`person-key:${suffix}`, personId, `person-public-key-${suffix}`, sha(fingerprintCharacter === "1" ? "3" : "4")),
    d1.prepare(
      `INSERT INTO delegation_certificates (
         id, owner_person_id, agent_id, person_key_id, agent_public_key,
         scopes_json, valid_from, valid_until, beneficiary_person_id,
         protocol_version, payload_hash, canonical_payload, person_signature
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `delegation:${suffix}`,
      personId,
      `agent:${suffix}`,
      `person-key:${suffix}`,
      publicKey,
      '["review"]',
      "2026-07-01T00:00:00Z",
      "2027-07-01T00:00:00Z",
      personId,
      "pw-delegation-v1",
      sha(fingerprintCharacter === "1" ? "5" : "6"),
      "{}",
      "signature",
    ),
  ]);
}

async function activatePool(d1) {
  const payload = {
    protocolVersion: "pw-credit-pool-event-v1",
    poolId,
    sequence: 2,
    eventType: "activated",
    occurredAt: "2026-07-15T08:00:00Z",
  };
  await d1.prepare(
    `INSERT INTO problem_credit_pool_events (
       id, pool_id, sequence, event_type, payload_hash, canonical_payload, occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    "pool-event:verification-market:activated",
    poolId,
    2,
    "activated",
    await sha256Canonical(payload),
    canonicalJson(payload),
    payload.occurredAt,
  ).run();
}

function personStatement(d1, id, subject, displayName) {
  return d1.prepare(
    "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(id, "proofweave", subject, displayName, "2026-07-15T07:00:00Z");
}

async function applyMigrations(d1) {
  const filenames = (await readdir(migrationsRoot)).filter((filename) => filename.endsWith(".sql")).sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await d1.prepare(statement).run();
    }
  }
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
