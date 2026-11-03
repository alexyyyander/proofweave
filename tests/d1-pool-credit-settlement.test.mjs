import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { D1PoolCreditSettlement } from "../services/credits/d1-pool-credit-settlement.mjs";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { createContributionReceipt } from "../packages/protocol/contribution-receipt.mjs";

// Synthetic fixture: these tests exercise real SQL snapshots, immutable event
// insertion and arithmetic while replacing evidence verification. They do not
// claim to validate real Runner, Receipt, or independent review signatures.
async function syntheticFixture() {
  const db = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  for (const sql of [
    "CREATE TABLE problem_revisions (id TEXT PRIMARY KEY, target_key TEXT, project_id TEXT, source_snapshot_id TEXT)",
    "CREATE TABLE projects (id TEXT PRIMARY KEY, visibility TEXT)", "CREATE TABLE source_snapshots (id TEXT PRIMARY KEY)",
    "CREATE TABLE verification_claims (problem_revision_id TEXT)",
    "CREATE TABLE declarations (problem_revision_id TEXT, qualified_name TEXT, is_primary INTEGER)",
    "CREATE TABLE problem_credit_pools (id TEXT PRIMARY KEY, problem_revision_id TEXT, total_credits INTEGER, policy_version TEXT, unit TEXT, sponsor_label TEXT, created_at TEXT)",
    "CREATE TABLE problem_credit_pool_events (id TEXT PRIMARY KEY, pool_id TEXT, sequence INTEGER, event_type TEXT, payload_hash TEXT, canonical_payload TEXT, occurred_at TEXT, UNIQUE(pool_id, sequence))",
    "CREATE TABLE verification_attestations (artifact_bundle_manifest_hash TEXT)",
    "CREATE TABLE contribution_receipt_lifecycle_events (id TEXT, receipt_id TEXT, event_type TEXT)",
    "CREATE TABLE contribution_receipt_publications (receipt_id TEXT, record_class TEXT, visibility TEXT)",
    "CREATE TABLE delegation_revocations (id TEXT)", "CREATE TABLE person_key_revocations (id TEXT)",
    "CREATE TABLE contribution_receipt_issuer_key_events (id TEXT)", "CREATE TABLE agents (id TEXT, status TEXT, public_key TEXT, owner_person_id TEXT)",
    "CREATE TABLE person_keys (id TEXT, public_key TEXT, revoked_at TEXT)", "CREATE TABLE delegation_certificates (id TEXT, person_key_id TEXT)", "CREATE TABLE runner_keys (id TEXT, public_key TEXT, fingerprint TEXT, status TEXT, revoked_at TEXT)",
    "CREATE TABLE verification_assignments (id TEXT PRIMARY KEY, status TEXT, completed_at TEXT)",
    "CREATE TABLE verification_market_jobs (id TEXT, problem_revision_id TEXT, pool_id TEXT, claim_type TEXT, reward_weight INTEGER, policy_version TEXT, artifact_bundle_manifest_hash TEXT, published_at TEXT)",
    "CREATE TABLE verification_market_job_claims (job_id TEXT, assignment_id TEXT, verifier_person_id TEXT, claimed_at TEXT)",
    "CREATE TABLE verification_market_job_events (job_id TEXT, sequence INTEGER, event_type TEXT, payload_hash TEXT, canonical_payload TEXT, occurred_at TEXT)",
  ]) await db.prepare(sql).run();
  const bundleHash = `sha256:${"a".repeat(64)}`;
  const poolId = "pool:synthetic";
  await db.prepare("INSERT INTO projects VALUES ('project:synthetic', 'public')").run();
  await db.prepare("INSERT INTO agents VALUES ('agent:owner', 'active', 'key:owner', 'person:owner')").run();
  await db.prepare("INSERT INTO person_keys VALUES ('person-key:owner', 'person-public:owner', NULL)").run();
  await db.prepare("INSERT INTO delegation_certificates VALUES ('delegation:owner', 'person-key:owner')").run();
  await db.prepare("INSERT INTO source_snapshots VALUES ('snapshot:synthetic')").run();
  await db.prepare("INSERT INTO problem_revisions VALUES (?, ?, ?, ?)").bind("revision:synthetic", "Synthetic.target", "project:synthetic", "snapshot:synthetic").run();
  await db.prepare("INSERT INTO verification_claims VALUES ('revision:synthetic')").run();
  await db.prepare("INSERT INTO declarations VALUES (?, ?, 1)").bind("revision:synthetic", "Synthetic.target").run();
  await db.prepare("INSERT INTO problem_credit_pools VALUES (?, ?, ?, ?, ?, ?, ?)").bind(poolId, "revision:synthetic", 1000, "pw-credit-market-v1", "non_transferable_research_credit", "Synthetic test", "2026-07-01T00:00:00Z").run();
  for (const [index, eventType] of ["created", "activated"].entries()) {
    const event = { protocolVersion: "pw-credit-pool-event-v1", poolId, sequence: index + 1, eventType, occurredAt: "2026-07-01T00:00:00Z", ...(eventType === "created" ? { problemRevisionId: "revision:synthetic", policyVersion: "pw-credit-market-v1", unit: "non_transferable_research_credit", totalCredits: 1000, sponsorLabel: "Synthetic test" } : {}) };
    await db.prepare("INSERT INTO problem_credit_pool_events VALUES (?, ?, ?, ?, ?, ?, ?)").bind(`event:${index}`, poolId, event.sequence, eventType, await sha256Canonical(event), canonicalJson(event), event.occurredAt).run();
  }
  await db.prepare("INSERT INTO contribution_receipt_publications VALUES (?, 'research', 'public')").bind("receipt:synthetic").run();
  const attestations = [];
  for (const [index, claimType] of ["bundle_reproducible", "kernel_accepted", "project_accepted", "statement_faithful"].entries()) {
    const item = {
      id: `attestation:${index}`, assignmentId: `assignment:${index}`, artifactBundleHash: bundleHash,
      verifierPersonId: "person:reviewer", claimType, decision: "attested", evidenceHash: `sha256:${"b".repeat(64)}`,
      attestedAt: "2026-07-01T00:00:03Z",
    };
    attestations.push(item);
    await db.prepare("INSERT INTO verification_attestations VALUES (?)").bind(bundleHash).run();
    await db.prepare("INSERT INTO verification_assignments VALUES (?, 'completed', ?)").bind(item.assignmentId, item.attestedAt).run();
    if (index < 2) {
      const jobHash = await sha256Canonical({ protocolVersion: "pw-verification-market-v1", poolId, artifactBundleManifestHash: bundleHash, claimType });
      const jobId = `verification-job:${jobHash.slice(7)}`;
      await db.prepare("INSERT INTO verification_market_jobs VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(jobId, "revision:synthetic", poolId, claimType, index === 0 ? 1 : 2, "pw-verification-market-v1", bundleHash, "2026-07-01T00:00:00Z").run();
      await db.prepare("INSERT INTO verification_market_job_claims VALUES (?, ?, ?, ?)").bind(jobId, item.assignmentId, item.verifierPersonId, "2026-07-01T00:00:01Z").run();
      await insertMarketEvents(db, { jobId, poolId, bundleHash, claimType, rewardWeight: index === 0 ? 1 : 2, assignmentId: item.assignmentId, personId: item.verifierPersonId });
    }
  }
  const claims = await Promise.all(attestations.slice(0, 3).map(async (item) => ({
    claimType: item.claimType, verificationAttestationId: item.id, verificationAttestationHash: await sha256Canonical(item),
    artifactBundleHash: bundleHash, reviewerPersonId: item.verifierPersonId, reviewerAgentId: "agent:reviewer",
    reviewerDelegationCertificateId: "delegation:reviewer", decision: "attested",
  })));
  const key = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const issuerPublicKey = Buffer.from(await crypto.subtle.exportKey("raw", key.publicKey)).toString("base64url");
  const receipt = await createContributionReceipt({ issuerPrivateKey: key.privateKey, receipt: {
    protocolVersion: "pw-contribution-receipt-v1", id: "receipt:synthetic", kind: "proof_patch",
    attempt: { id: "attempt:synthetic", personId: "person:owner", agentId: "agent:owner", delegationCertificateId: "delegation:owner", problemRevisionId: "revision:synthetic" },
    beneficiary: { personId: "person:owner", agentId: "agent:owner", delegationCertificateId: "delegation:owner" },
    target: { declaration: "Synthetic.target", statementHash: `sha256:${"e".repeat(64)}` }, artifactBundleHash: bundleHash,
    bundle: { manifestHash: bundleHash, dependencyReceipts: [] },
    run: { id: "run:synthetic", resultHash: `sha256:${"c".repeat(64)}`, requestHash: `sha256:${"d".repeat(64)}`, status: "succeeded", kernelStatus: "accepted" }, claims,
    issuedAt: "2026-07-01T00:00:04Z", policyVersion: "pw-receipt-policy-v1", issuerKeyId: "issuer:synthetic", issuerPublicKey,
  } });
  const settlement = new D1PoolCreditSettlement(db, { now: () => new Date("2026-07-02T00:00:00Z") });
  settlement.market.hasInspectablePublicTarget = async () => true;
  settlement.receipts = {
    async loadVerifiedReceipt(id) { assert.equal(id, receipt.id); return receipt; },
    async loadReviewEvidence() { return attestations; },
    async loadEffectiveReviewEvidence() { return new Map(attestations.map((item) => [item.claimType, item])); },
  };
  settlement.verifyRun = async () => {};
  settlement.verifyBundle = async () => ({ agentId: "agent:owner", personId: "person:owner", publicKey: "key:owner", certificateId: "delegation:owner", signerKeyId: "person-key:owner", signerPublicKey: "person-public:owner" });
  settlement.verifyReviewAttestation = async () => {};
  return { db, settlement, poolId, receipt, attestations, bundleHash };
}

test("synthetic SQL lock freezes an allocation, preserves reserves, and is retry-safe", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  const preview = await settlement.preview(poolId, receipt.id);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 2);
  assert.deepEqual(preview.plan.reserved, { verified_dependencies: 400, independent_verification: 0, challenge_reserve: 100 });
  assert.equal(preview.plan.entries.reduce((sum, item) => sum + item.units, 0), 500);
  await assert.rejects(settlement.lock(poolId, receipt.id), /reviewed allocation plan hash/);
  await assert.rejects(settlement.lock(poolId, receipt.id, { expectedPlanHash: `sha256:${"0".repeat(64)}` }), /differs from the reviewed plan/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 2);
  const locked = await settlement.lock(poolId, receipt.id, { expectedPlanHash: preview.plan.payloadHash });
  assert.equal(locked.created, true);
  assert.equal(locked.state, "locked");
  assert.deepEqual(locked.allocation, preview.plan);
  const retry = await settlement.lock(poolId, receipt.id, { expectedPlanHash: preview.plan.payloadHash });
  assert.equal(retry.created, false);
  assert.equal(retry.eventHash, locked.eventHash);
  await assert.rejects(settlement.lock(poolId, receipt.id, { expectedPlanHash: `sha256:${"0".repeat(64)}` }), /different reviewed plan/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 3);
});

test("synthetic SQL lock fails closed if review evidence changes after preview", async (t) => {
  const { db, settlement, poolId, receipt, bundleHash } = await syntheticFixture();
  t.after(() => db.close());
  const preview = settlement.preview.bind(settlement);
  settlement.preview = async (...args) => {
    const result = await preview(...args);
    await db.prepare("INSERT INTO verification_attestations VALUES (?)").bind(bundleHash).run();
    return result;
  };
  const reviewed = await preview(poolId, receipt.id);
  await assert.rejects(settlement.lock(poolId, receipt.id, { expectedPlanHash: reviewed.plan.payloadHash }), /changed before the lock/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 2);
});

test("a review job belonging to another pool cannot receive this pool's credits", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  const old = await db.prepare("SELECT * FROM verification_market_jobs WHERE claim_type = 'bundle_reproducible'").first();
  const otherPool = "pool:other";
  const hash = await sha256Canonical({ protocolVersion: "pw-verification-market-v1", poolId: otherPool, artifactBundleManifestHash: old.artifact_bundle_manifest_hash, claimType: old.claim_type });
  const otherJob = `verification-job:${hash.slice(7)}`;
  await db.prepare("UPDATE verification_market_job_claims SET job_id = ? WHERE job_id = ?").bind(otherJob, old.id).run();
  await db.prepare("UPDATE verification_market_jobs SET id = ?, pool_id = ? WHERE id = ?").bind(otherJob, otherPool, old.id).run();
  await db.prepare("DELETE FROM verification_market_job_events WHERE job_id = ?").bind(old.id).run();
  await insertMarketEvents(db, { jobId: otherJob, poolId: otherPool, bundleHash: old.artifact_bundle_manifest_hash, claimType: old.claim_type, rewardWeight: old.reward_weight, assignmentId: "assignment:0", personId: "person:reviewer" });
  const preview = await settlement.preview(poolId, receipt.id);
  assert.equal(preview.plan.reviews.length, 1);
  assert.notEqual(preview.plan.reviews[0].jobId, otherJob);
  assert.equal(preview.plan.entries.filter((entry) => entry.bucket === "independent_verification").reduce((sum, entry) => sum + entry.units, 0), 200);
});

test("synthetic SQL lock rejects a runner key swap even if the active key count is unchanged", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  await db.prepare("INSERT INTO runner_keys VALUES (?, ?, ?, 'active', NULL)").bind("runner:one", "key-one", "fingerprint-one").run();
  const preview = settlement.preview.bind(settlement);
  const reviewed = await preview(poolId, receipt.id);
  settlement.preview = async (...args) => {
    const result = await preview(...args);
    await db.prepare("UPDATE runner_keys SET public_key = ?, fingerprint = ? WHERE id = ?").bind("key-two", "fingerprint-two", "runner:one").run();
    return result;
  };
  await assert.rejects(settlement.lock(poolId, receipt.id, { expectedPlanHash: reviewed.plan.payloadHash }), /changed before the lock/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 2);
});

test("the lock rejects a Bundle Agent key change after preview", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  const preview = settlement.preview.bind(settlement);
  const reviewed = await preview(poolId, receipt.id);
  settlement.preview = async (...args) => {
    const result = await preview(...args);
    await db.prepare("UPDATE agents SET public_key = 'key:other' WHERE id = 'agent:owner'").run();
    return result;
  };
  await assert.rejects(settlement.lock(poolId, receipt.id, { expectedPlanHash: reviewed.plan.payloadHash }), /changed before the lock/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 2);
});

test("the lock rejects an owner signing key change after preview", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  const preview = settlement.preview.bind(settlement);
  const reviewed = await preview(poolId, receipt.id);
  settlement.preview = async (...args) => {
    const result = await preview(...args);
    await db.prepare("UPDATE person_keys SET public_key = 'person-public:other' WHERE id = 'person-key:owner'").run();
    return result;
  };
  await assert.rejects(settlement.lock(poolId, receipt.id, { expectedPlanHash: reviewed.plan.payloadHash }), /changed before the lock/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 2);
});

test("non-public market targets cannot receive the review bucket", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  settlement.market.hasInspectablePublicTarget = async () => false;
  const preview = await settlement.preview(poolId, receipt.id);
  assert.equal(preview.plan.reviews.length, 0);
  assert.equal(preview.plan.reserved.independent_verification, 200);
});

test("market credit requires intact publication and claim events", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  await db.prepare("UPDATE verification_market_job_events SET canonical_payload = '{}' WHERE sequence = 1").run();
  await assert.rejects(settlement.preview(poolId, receipt.id), /canonical published and claimed events/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 2);
});

test("the lock rejects a target becoming private after its snapshot", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  const preview = settlement.preview.bind(settlement);
  const reviewed = await preview(poolId, receipt.id);
  settlement.preview = async (...args) => {
    const result = await preview(...args);
    await db.prepare("UPDATE projects SET visibility = 'private' WHERE id = 'project:synthetic'").run();
    return result;
  };
  await assert.rejects(settlement.lock(poolId, receipt.id, { expectedPlanHash: reviewed.plan.payloadHash }), /changed before the lock/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events").first("count"), 2);
});

test("retry recovers an allocation committed before readback fails", async (t) => {
  const { db, settlement, poolId, receipt } = await syntheticFixture();
  t.after(() => db.close());
  const preview = await settlement.preview(poolId, receipt.id);
  const readLocked = settlement.readLocked.bind(settlement);
  let reads = 0;
  settlement.readLocked = async (...args) => {
    reads += 1;
    if (reads === 2) throw new Error("synthetic readback failure");
    return readLocked(...args);
  };
  await assert.rejects(settlement.lock(poolId, receipt.id, { expectedPlanHash: preview.plan.payloadHash }), /synthetic readback failure/);
  assert.equal(await db.prepare("SELECT COUNT(*) AS count FROM problem_credit_pool_events WHERE event_type = 'locked'").first("count"), 1);
  settlement.readLocked = readLocked;
  const retry = await settlement.lock(poolId, receipt.id, { expectedPlanHash: preview.plan.payloadHash });
  assert.equal(retry.created, false);
  assert.deepEqual(retry.allocation, preview.plan);
});

async function insertMarketEvents(db, { jobId, poolId, bundleHash, claimType, rewardWeight, assignmentId, personId }) {
  for (const event of [
    { protocolVersion: "pw-verification-market-job-event-v1", jobId, sequence: 1, eventType: "published", occurredAt: "2026-07-01T00:00:00Z", poolId, artifactBundleManifestHash: bundleHash, claimType, rewardWeight },
    { protocolVersion: "pw-verification-market-job-event-v1", jobId, sequence: 2, eventType: "claimed", occurredAt: "2026-07-01T00:00:01Z", assignmentId, verifierPersonId: personId },
  ]) await db.prepare("INSERT INTO verification_market_job_events VALUES (?, ?, ?, ?, ?, ?)").bind(jobId, event.sequence, event.eventType, await sha256Canonical(event), canonicalJson(event), event.occurredAt).run();
}
