import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { delegationPayloadHash, delegationSigningPayload } from "../packages/domain/delegation.mjs";
import { verificationAttestationPayloadHash, verificationAttestationSigningPayload } from "../packages/protocol/verification-attestation.mjs";
import { canonicalVerificationReplayEvidence, normalizeVerificationReplayEvidence, verificationReplayEvidenceHash } from "../packages/protocol/verification-replay-evidence.mjs";
import { signLeanRunnerResult } from "../packages/protocol/lean-runner.mjs";
import { runnerKeyFingerprint } from "../packages/protocol/runner-key-registry.mjs";
import { artifactBundleHash, artifactBundleSigningPayload, artifactBundleSigningPayloadHash } from "../packages/protocol/artifact-bundle.mjs";
import { D1ContributionReceiptIssuerKeyStore } from "../services/receipts/d1-contribution-receipt-issuer-key-store.mjs";
import { D1ContributionReceiptStore } from "../services/receipts/d1-contribution-receipt-store.mjs";
import { D1VerificationStore } from "../services/verification/d1-verification-store.mjs";
import { D1VerificationMarketStore } from "../services/verification/d1-verification-market-store.mjs";
import { D1PoolCreditSettlement } from "../services/credits/d1-pool-credit-settlement.mjs";
const migrationsRoot = new URL("../drizzle/", import.meta.url);
const runRequestHash = sha("b");
let bundleHash, signedBundle, runResultHash, issuerPair, issuerPublicKey, reviewerPairs, runnerPair;

// Synthetic data, real Ed25519 signatures and the real D1 stores. This does
// not claim that the synthetic Runner executed Lean or proves any theorem.
test("signed public-market evidence previews, but cannot lock without finality adjudication", async (t) => {
  issuerPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  issuerPublicKey = base64Url(await crypto.subtle.exportKey("raw", issuerPair.publicKey));
  runnerPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  reviewerPairs = Object.fromEntries(await Promise.all(["alice", "bob", "carol"].map(async (name) => [name, await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])])));
  signedBundle = fixtureBundle(base64Url(await crypto.subtle.exportKey("raw", reviewerPairs.alice.publicKey)), null);
  signedBundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(signedBundle);
  signedBundle.agentEvent.signature = base64Url(await crypto.subtle.sign("Ed25519", reviewerPairs.alice.privateKey, new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(signedBundle)))));
  bundleHash = await artifactBundleHash(signedBundle);
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-05-22", d1Databases: ["DB"] });
  t.after(async () => mf.dispose());
  const db = await mf.getD1Database("DB");
  await applyMigrations(db);
  await new D1ContributionReceiptIssuerKeyStore(db).registerInitial({ id: "issuer:closed-alpha-1", publicKey: issuerPublicKey, activatedAt: "2026-07-13T00:00:00Z" });
  await seedReceiptEvidence(db);
  const runnerPublic = base64Url(await crypto.subtle.exportKey("raw", runnerPair.publicKey));
  await db.prepare("INSERT INTO runner_keys (id, public_key, fingerprint, status) VALUES (?, ?, ?, 'active')").bind("runner-key:receipt", runnerPublic, await runnerKeyFingerprint(runnerPublic)).run();
  const rootRow = await db.prepare("SELECT canonical_result FROM run_results WHERE run_id = ?").bind("run:receipt-fixture").first();
  await seedOutputs(db, JSON.parse(rootRow.canonical_result));
  await db.prepare("INSERT INTO declarations (id, problem_revision_id, qualified_name, source_path, source_url, source_line_start, source_line_end, source_content_hash, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)")
    .bind("declaration:receipt", "revision:receipt", "Proofweave.Receipt.target", "Fixture.lean", "https://example.test/Fixture.lean", 1, 1, sha("1")).run();
  await db.prepare("INSERT INTO verification_claims (id, problem_revision_id, claim_type, status, recorded_at) VALUES (?, ?, ?, ?, ?)")
    .bind("claim:catalog", "revision:receipt", "bundle_reproducible", "pending", "2026-07-13T00:00:00Z").run();
  await db.prepare("INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)").bind("client:bob-reviewer", "Synthetic reviewer", '["https://example.test/callback"]').run();
  await db.prepare("INSERT INTO agent_installations (id, person_id, agent_id, delegation_certificate_id, client_id, label) VALUES (?, ?, ?, ?, ?, ?)")
    .bind("installation:bob-reviewer", "person:bob", "agent:bob-reviewer", "delegation:bob-reviewer", "client:bob-reviewer", "Synthetic reviewer").run();
  const poolId = "pool:signed-e2e", createdAt = "2026-07-13T00:00:00Z";
  await db.prepare("INSERT INTO problem_credit_pools (id, problem_revision_id, policy_version, unit, total_credits, sponsor_label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(poolId, "revision:receipt", "pw-credit-market-v1", "non_transferable_research_credit", 1000, "Synthetic pool", createdAt).run();
  for (const [i, eventType] of ["created", "activated"].entries()) {
    const event = { protocolVersion: "pw-credit-pool-event-v1", poolId, sequence: i + 1, eventType, occurredAt: createdAt, ...(i === 0 ? { problemRevisionId: "revision:receipt", policyVersion: "pw-credit-market-v1", unit: "non_transferable_research_credit", totalCredits: 1000, sponsorLabel: "Synthetic pool" } : {}) };
    await db.prepare("INSERT INTO problem_credit_pool_events (id, pool_id, sequence, event_type, payload_hash, canonical_payload, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`event:${i}`, poolId, event.sequence, eventType, await sha256Canonical(event), canonicalJson(event), createdAt).run();
  }
  const market = new D1VerificationMarketStore(db), verify = new D1VerificationStore(db);
  const published = await market.publishJobsForBundle(bundleHash, "2026-07-13T00:00:03Z");
  assert.equal(published.published, true);
  const bobPublic = base64Url(await crypto.subtle.exportKey("raw", reviewerPairs.bob.publicKey));
  for (const claimType of ["bundle_reproducible", "kernel_accepted", "project_accepted", "statement_faithful"]) {
    const job = published.jobs.find((item) => item.claimType === claimType);
    assert.ok(job, claimType);
    const claim = await market.claimJob(job.id, "person:bob", "2026-07-13T00:00:10Z");
    let evidenceHash = sha("f");
    if (["bundle_reproducible", "kernel_accepted"].includes(claimType)) {
      const replay = await seedReplayEvidence(db, { assignmentId: claim.assignment.id, bundleHash, tag: claimType, requestedAt: "2026-07-13T00:00:10Z", startedAt: "2026-07-13T00:00:11Z", finishedAt: "2026-07-13T00:00:11.500Z", recordedAt: "2026-07-13T00:00:11.500Z" });
      evidenceHash = replay.evidenceHash;
    }
    await verify.recordAttestation(await fixtureAttestation({ id: `attestation:${claimType}`, assignmentId: claim.assignment.id, claimType, reviewer: "bob", agent: "agent:bob-reviewer", delegation: "delegation:bob-reviewer", publicKey: bobPublic, privateKey: reviewerPairs.bob.privateKey, evidenceHash }));
  }
  const laterJob = published.jobs.find((item) => item.claimType === "novelty_reviewed");
  const laterClaim = await market.claimJob(laterJob.id, "person:bob", "2026-07-13T00:00:10Z");
  const issued = await new D1ContributionReceiptStore(db).issue({ id: "receipt:signed-e2e", kind: "proof_patch", artifactBundleManifestHash: bundleHash, runId: "run:receipt-fixture", issuedAt: "2026-07-13T00:01:00Z", issuerKeyId: "issuer:closed-alpha-1", issuerPublicKey, issuerPrivateKey: issuerPair.privateKey });
  assert.equal(issued.created, true);
  const settlement = new D1PoolCreditSettlement(db, { now: () => new Date("2026-07-13T00:02:00Z") });
  const invalidDelegationDb = {
    prepare(sql) { const statement = db.prepare(sql); return { bind(...args) { const bound = statement.bind(...args); return { async first() { const row = await bound.first(); return { ...row, person_signature: base64Url(new Uint8Array(64)) }; } }; } }; },
    batch: async () => [],
  };
  await assert.rejects(new D1PoolCreditSettlement(invalidDelegationDb).verifyBundle(issued.receipt), /valid signed owner delegation/);
  const forgedBundle = structuredClone(signedBundle);
  forgedBundle.agentEvent.signature = base64Url(new Uint8Array(64));
  const forgedHash = await artifactBundleHash(forgedBundle);
  const forgedRow = { canonical_manifest: canonicalJson(forgedBundle), attempt_id: "attempt:receipt", problem_revision_id: "revision:receipt", public_key: signedBundle.agentEvent.agentPublicKey, owner_person_id: "person:alice" };
  const forgedDb = { prepare: () => ({ bind: () => ({ first: async () => forgedRow }) }), batch: async () => [] };
  await assert.rejects(new D1PoolCreditSettlement(forgedDb).verifyBundle({ ...issued.receipt, artifactBundleHash: forgedHash }), /Signed Artifact Bundle does not match/);
  const preview = await settlement.preview(poolId, issued.receipt.id);
  assert.equal(preview.plan.reviews.length, 4);
  assert.deepEqual(preview.plan.reserved, { verified_dependencies: 400, independent_verification: 0, challenge_reserve: 100 });
  const results = await Promise.allSettled([settlement.lock(poolId, issued.receipt.id, { expectedPlanHash: preview.plan.payloadHash }), settlement.lock(poolId, issued.receipt.id, { expectedPlanHash: preview.plan.payloadHash })]);
  assert.ok(results.every((item) => item.status === "rejected" && /adjudication is required/.test(item.reason.message)));
  await verify.recordAttestation(await fixtureAttestation({ id: "attestation:late-novelty", assignmentId: laterClaim.assignment.id, claimType: "novelty_reviewed", reviewer: "bob", agent: "agent:bob-reviewer", delegation: "delegation:bob-reviewer", publicKey: bobPublic, privateKey: reviewerPairs.bob.privateKey, evidenceHash: sha("f"), attestedAt: "2026-07-13T00:03:00Z" }));
  assert.deepEqual((await settlement.preview(poolId, issued.receipt.id)).plan, preview.plan);
  await assert.rejects(settlement.lock(poolId, issued.receipt.id, { expectedPlanHash: preview.plan.payloadHash }), /adjudication is required/);
  assert.equal(Number(await db.prepare("SELECT COUNT(*) AS n FROM problem_credit_pool_events WHERE pool_id = ? AND event_type = 'locked'").bind(poolId).first("n")), 0);
});

async function seedOutputs(db, result) {
  for (const [role, hash] of [["stdout", result.artifacts.stdoutHash], ["stderr", result.artifacts.stderrHash]]) {
    await db.prepare("INSERT INTO runner_output_artifacts (id, run_id, role, content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(`output:${result.jobId}:${role}`, result.jobId, role, hash, `synthetic/${result.jobId}/${role}`, 0, "text/plain").run();
  }
}

async function seedReceiptEvidence(d1) {
  const publicKeys = {
    alice: base64Url(await crypto.subtle.exportKey("raw", reviewerPairs.alice.publicKey)),
    bob: base64Url(await crypto.subtle.exportKey("raw", reviewerPairs.bob.publicKey)),
    carol: base64Url(await crypto.subtle.exportKey("raw", reviewerPairs.carol.publicKey)),
  };
  const fingerprints = Object.fromEntries(await Promise.all(
    Object.entries(publicKeys).map(async ([name, publicKey]) => [
      name,
      await keyFingerprint(publicKey),
    ]),
  ));
  const manifest = signedBundle;
  const unsigned = fixtureRunnerResult();
  delete unsigned.runnerSignature;
  const runnerResult = await signLeanRunnerResult({ result: unsigned, runnerPrivateKey: runnerPair.privateKey });
  runResultHash = await sha256Canonical(runnerResult);
  const statements = [
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:alice", "proofweave", "alice", "Alice", "2026-07-13T00:00:00Z"]],
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:bob", "proofweave", "bob", "Bob", "2026-07-13T00:00:00Z"]],
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:carol", "proofweave", "carol", "Carol", "2026-07-13T00:00:00Z"]],
    [
      `INSERT INTO source_snapshots (id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at, content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:receipt", "fixture", "https://example.test/source", "v1", "abc123", "2026-07-13T00:00:00Z", sha("1"), sha("2"), "MIT", "leanprover/lean4:v4.27.0", "a3a10db0e9d6"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:receipt", "receipt", "frontier", "Receipt", "Fixture"]],
    [
      `INSERT INTO problem_revisions (id, project_id, source_snapshot_id, target_key, slug, revision_number, title, domain, research_status, informal_statement, lean_statement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:receipt", "project:receipt", "snapshot:receipt", "receipt-target", "receipt-target", 1, "Receipt target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial"],
    ],
    ...["alice", "bob", "carol"].flatMap((name) => [
      ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", [`person-key:${name}`, `person:${name}`, publicKeys[name], fingerprints[name]]],
    ]),
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["agent:alice-prover", "person:alice", "Alice prover", publicKeys.alice, fingerprints.alice, "2026-07-01T00:00:00Z"]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["agent:bob-reviewer", "person:bob", "Bob reviewer", publicKeys.bob, fingerprints.bob, "2026-07-01T00:00:00Z"]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["agent:carol-curator", "person:carol", "Carol curator", publicKeys.carol, fingerprints.carol, "2026-07-01T00:00:00Z"]],
    ...await delegationStatements(publicKeys),
    [
      `INSERT INTO agent_attempts (id, person_id, problem_revision_id, agent_id, delegation_certificate_id, delegation_scope, agent_label, idempotency_key, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:receipt", "person:alice", "revision:receipt", "agent:alice-prover", "delegation:alice-prover", "prove", "Alice prover", "attempt-receipt", "2026-07-13T00:00:00Z"],
    ],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [bundleHash, `bundles/sha256/${bundleHash.slice(7)}/bundle.json`, 2, "application/json"]],
    ...["d", "e", "f"].map((character) => ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [sha(character), `bundles/sha256/${character.repeat(64)}/review.json`, 2, "application/json"]]),
    [
      `INSERT INTO artifact_bundles (id, attempt_id, problem_revision_id, manifest_hash, manifest_key, canonical_manifest, agent_event_id, agent_event_payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["bundle:receipt", "attempt:receipt", "revision:receipt", bundleHash, `bundles/sha256/${bundleHash.slice(7)}/bundle.json`, canonicalJson(manifest), "agent-event:receipt", manifest.agentEvent.payloadHash],
    ],
    [
      `INSERT INTO runs (id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state, queued_at, started_at, finished_at, runner_result_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["run:receipt-fixture", "attempt:receipt", bundleHash, runRequestHash, "run-receipt", "succeeded", "2026-07-13T00:00:00Z", "2026-07-13T00:00:01Z", "2026-07-13T00:00:02Z", runResultHash, "2026-07-13T00:00:02Z"],
    ],
    ["INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)", ["run:receipt-fixture", runResultHash, canonicalJson(runnerResult), "2026-07-13T00:00:02Z"]],
  ];
  for (const [statement, values] of statements) await d1.prepare(statement).bind(...values).run();
}

async function delegationStatements(publicKeys) {
  return Promise.all([
    ["alice", "agent:alice-prover", "prove"],
    ["bob", "agent:bob-reviewer", "review"],
    ["carol", "agent:carol-curator", "review"],
  ].map(async ([person, agent, scope]) => {
    const id = `delegation:${person}-${person === "alice" ? "prover" : person === "bob" ? "reviewer" : "curator"}`;
    const certificate = {
      id,
      ownerPersonId: `person:${person}`,
      agentId: agent,
      agentPublicKey: publicKeys[person],
      scopes: [scope],
      validFrom: "2026-07-01T00:00:00Z",
      validUntil: "2027-07-01T00:00:00Z",
      attributionPolicy: {
        beneficiaryPersonId: `person:${person}`,
        mode: "agent_delegated",
      },
    };
    return [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, `person:${person}`, agent, `person-key:${person}`, publicKeys[person],
        JSON.stringify([scope]), certificate.validFrom, certificate.validUntil,
        `person:${person}`, "pw-delegation-v1",
        await delegationPayloadHash(certificate),
        canonicalJson(delegationSigningPayload(certificate)),
        base64Url(await crypto.subtle.sign(
          "Ed25519",
          reviewerPairs[person].privateKey,
          new TextEncoder().encode(canonicalJson(delegationSigningPayload(certificate))),
        )),
      ],
    ];
  }));
}

function fixtureBundle(publicKey, dependencyReceipt) {
  return {
    protocolVersion: "pw-artifact-bundle-v1",
    id: "bundle:receipt",
    attemptId: "attempt:receipt",
    problemRevisionId: "revision:receipt",
    target: { declaration: "Proofweave.Receipt.target", statementHash: sha("0") },
    source: {
      archiveKey: `bundles/sha256/${"1".repeat(64)}/source.tar.zst`, archiveHash: sha("1"), treeHash: sha("2"),
      patchKey: `bundles/sha256/${"3".repeat(64)}/normalized.patch`, patchHash: sha("3"),
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0", lakeManifestKey: `bundles/sha256/${"4".repeat(64)}/lake-manifest.json`,
      lakeManifestHash: sha("4"), mathlibRevision: "a3a10db0e9d6",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Receipt.lean"],
    dependencyReceipts: dependencyReceipt ? [dependencyReceipt] : [],
    agentEvent: { eventId: "agent-event:receipt", occurredAt: "2026-07-13T00:00:00Z", payloadHash: sha("6"), agentPublicKey: publicKey, signature: base64Url(new Uint8Array(64)) },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}

function fixtureRunnerEnvironment() {
  return {
    imageDigest: `ghcr.io/proofweave/lean-runner@sha256:${"c".repeat(64)}`,
    leanToolchain: "leanprover/lean4:v4.27.0",
    mathlibRevision: "a3a10db0e9d6",
    templateId: "template_proofweave:reviewed_runtime",
    templateBuildId: "9420e83e-3c6d-48b8-94fe-a73807af5797",
  };
}

function fixtureRunnerResult() {
  return {
    protocolVersion: "pw-lean-runner-v1", jobId: "run:receipt-fixture", attemptId: "attempt:receipt", requestHash: runRequestHash,
    runnerKeyId: "runner-key:receipt", runnerSignature: base64Url(new Uint8Array(64)), status: "succeeded", exitCode: 0,
    startedAt: "2026-07-13T00:00:01Z", finishedAt: "2026-07-13T00:00:02Z", kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: { manifestHash: bundleHash, stdoutHash: sha("8"), stderrHash: sha("9") },
    environment: fixtureRunnerEnvironment(),
  };
}

async function fixtureAttestation({
  id,
  assignmentId,
  claimType,
  reviewer,
  agent,
  delegation,
  publicKey,
  privateKey,
  evidenceHash,
  decision = "attested",
  attestedAt = "2026-07-13T00:00:12Z",
}) {
  const draft = {
    protocolVersion: "pw-verification-attestation-v1", id, assignmentId, artifactBundleHash: bundleHash, claimType,
    verifierPersonId: `person:${reviewer}`, verifierAgentId: agent, delegationCertificateId: delegation,
    verifierAgentPublicKey: publicKey, decision, evidenceHash, attestedAt,
  };
  const payloadHash = await verificationAttestationPayloadHash({
    ...draft,
    payloadHash: sha("0"),
    signature: base64Url(new Uint8Array(64)),
  });
  const signed = {
    ...draft,
    payloadHash,
    signature: base64Url(await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload({
        ...draft,
        payloadHash,
        signature: base64Url(new Uint8Array(64)),
      }))),
    )),
  };
  return signed;
}

async function seedReplayEvidence(d1, {
  assignmentId,
  bundleHash,
  tag,
  requesterPersonId = "person:bob",
  requesterAgentId = "agent:bob-reviewer",
  delegationCertificateId = "delegation:bob-reviewer",
  installationId = "installation:bob-reviewer",
  allowMalformedResult = false,
  requestedAt = "2026-07-13T01:00:01Z",
  startedAt = "2026-07-13T01:00:01Z",
  finishedAt = "2026-07-13T01:00:01Z",
  recordedAt = "2026-07-13T01:00:01Z",
  runStartedAt,
  runFinishedAt,
}) {
  const runId = `run:verification-replay:${tag}`;
  const replayId = `verification-replay:${tag}`;
  const baseResult = {
    protocolVersion: "pw-lean-runner-v1",
    jobId: runId,
    attemptId: "attempt:receipt",
    requestHash: await sha256Canonical({ fixture: "replay-request", tag }),
    runnerKeyId: "runner-key:receipt",
    runnerSignature: base64Url(new Uint8Array(64)),
    status: "succeeded",
    exitCode: 0,
    startedAt,
    finishedAt,
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: {
      manifestHash: bundleHash,
      stdoutHash: await sha256Canonical({ fixture: "stdout", tag }),
      stderrHash: await sha256Canonical({ fixture: "stderr", tag }),
    },
  };
  delete baseResult.runnerSignature;
  const runnerResult = await signLeanRunnerResult({ result: baseResult, runnerPrivateKey: runnerPair.privateKey });
  const runnerResultHash = await sha256Canonical(runnerResult);
  const rawEvidence = {
    protocolVersion: "pw-verification-replay-evidence-v1",
    id: `verification-replay-evidence:${tag}`,
    replayId,
    assignmentId,
    runId,
    artifactBundleHash: bundleHash,
    runnerResultHash,
    runnerResult,
    recordedAt,
  };
  const evidence = allowMalformedResult
    ? rawEvidence
    : await normalizeVerificationReplayEvidence(rawEvidence);
  const canonicalEvidence = allowMalformedResult
    ? canonicalJson(evidence)
    : await canonicalVerificationReplayEvidence(evidence);
  const evidenceHash = allowMalformedResult
    ? await sha256Canonical(evidence)
    : await verificationReplayEvidenceHash(evidence);
  await d1.batch([
    d1
      .prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
      .bind(
        evidenceHash,
        `bundles/sha256/${evidenceHash.slice("sha256:".length)}/verification-replay-evidence.json`,
        new TextEncoder().encode(canonicalEvidence).byteLength,
        "application/vnd.proofweave.verification-replay-evidence+json",
      ),
    d1
      .prepare(
        `INSERT INTO runs (
          id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key,
          state, queued_at, started_at, finished_at, runner_result_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        runId,
        "attempt:receipt",
        bundleHash,
        runnerResult.requestHash,
        `verification-replay:${tag}`,
        runnerResult.status,
        requestedAt,
        runStartedAt ?? runnerResult.startedAt,
        runFinishedAt ?? runnerResult.finishedAt,
        runnerResultHash,
        runnerResult.finishedAt,
      ),
    d1
      .prepare("INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)")
      .bind(runId, runnerResultHash, canonicalJson(runnerResult), recordedAt),
    d1
      .prepare(
        `INSERT INTO verification_replays (
          id, assignment_id, run_id, artifact_bundle_manifest_hash,
          requester_person_id, requester_agent_id, delegation_certificate_id,
          agent_installation_id, idempotency_key, requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        replayId,
        assignmentId,
        runId,
        bundleHash,
        requesterPersonId,
        requesterAgentId,
        delegationCertificateId,
        installationId,
        `verification-replay:${tag}`,
        requestedAt,
      ),
    d1
      .prepare(
        `INSERT INTO verification_replay_evidence (
          id, replay_id, assignment_id, run_id, artifact_bundle_manifest_hash,
          runner_result_hash, evidence_hash, canonical_evidence, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        evidence.id,
        replayId,
        assignmentId,
        runId,
        bundleHash,
        runnerResultHash,
        evidenceHash,
        canonicalEvidence,
        recordedAt,
      ),
  ]);
  await seedOutputs(d1, runnerResult);
  return Object.freeze({ evidenceHash, replayId, runId, runnerResultHash });
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

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function keyFingerprint(publicKey) {
  return sha256Canonical({ algorithm: "ed25519", public_key: publicKey });
}
