import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import {
  contributionReceiptHash,
  createContributionReceipt,
  verifyContributionReceiptSignature,
} from "../packages/protocol/contribution-receipt.mjs";
import { verifyContributionReceiptLifecycleEventSignature } from "../packages/protocol/contribution-receipt-lifecycle.mjs";
import { D1ContributionReceiptIssuerKeyStore } from "../services/receipts/d1-contribution-receipt-issuer-key-store.mjs";
import { D1ContributionReceiptStore } from "../services/receipts/d1-contribution-receipt-store.mjs";
import { D1ReceiptCreditSettlement } from "../services/credits/d1-receipt-credit-settlement.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
const bundleHash = sha("a");
const runRequestHash = sha("b");
const runResultHash = sha("c");
let miniflare;
let database;
let issuerPair;
let issuerPublicKey;
let issuerKeys;
let upstreamReceipt;
let upstreamReceiptHash;

before(async () => {
  issuerPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  issuerPublicKey = base64Url(await crypto.subtle.exportKey("raw", issuerPair.publicKey));
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  issuerKeys = new D1ContributionReceiptIssuerKeyStore(database);
  await issuerKeys.registerInitial({
    id: "issuer:closed-alpha-1",
    publicKey: issuerPublicKey,
    activatedAt: "2026-07-13T00:00:00Z",
  });
  await seedReceiptEvidence(database);
});

after(async () => {
  await miniflare?.dispose();
});

test("D1 Receipt store derives, signs, retries, and freezes a certified contribution receipt", async () => {
  const store = new D1ContributionReceiptStore(database);
  const input = receiptInput({ id: "receipt:alice-lemma", kind: "lemma" });
  const first = await store.issue(input);
  const retry = await store.issue(input);

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(first.receipt.beneficiary.personId, "person:alice");
  assert.equal(first.receipt.claims.length, 3);
  assert.equal(await verifyContributionReceiptSignature(first.receipt), true);
  assert.deepEqual(await store.get("receipt:alice-lemma"), first.receipt);

  const edges = await database
    .prepare(
      `SELECT downstream_receipt_id, upstream_receipt_id, upstream_receipt_hash,
              declared_by_bundle_manifest_hash, recorded_at
       FROM contribution_receipt_dependency_edges
       WHERE downstream_receipt_id = ?`,
    )
    .bind("receipt:alice-lemma")
    .all();
  assert.deepEqual(edges.results, [{
    downstream_receipt_id: "receipt:alice-lemma",
    upstream_receipt_id: upstreamReceipt.id,
    upstream_receipt_hash: upstreamReceiptHash,
    declared_by_bundle_manifest_hash: bundleHash,
    recorded_at: "2026-07-13T00:01:00Z",
  }]);

  await assert.rejects(
    database.prepare("UPDATE contribution_receipts SET kind = ? WHERE id = ?").bind("formalization", "receipt:alice-lemma").run(),
    /contribution receipts are immutable/,
  );
  await assert.rejects(
    database.prepare("DELETE FROM contribution_receipts WHERE id = ?").bind("receipt:alice-lemma").run(),
    /contribution receipts cannot be deleted/,
  );
  await assert.rejects(
    database.prepare("UPDATE contribution_receipt_dependency_edges SET recorded_at = ? WHERE downstream_receipt_id = ?").bind("2026-07-14T00:00:00Z", "receipt:alice-lemma").run(),
    /contribution receipt dependency edges are immutable/,
  );
  await assert.rejects(
    database.prepare("DELETE FROM contribution_receipt_dependency_edges WHERE downstream_receipt_id = ?").bind("receipt:alice-lemma").run(),
    /contribution receipt dependency edges cannot be deleted/,
  );
  await assert.rejects(
    store.loadDependencyEvidence({
      downstreamReceiptId: "receipt:missing-upstream-check",
      artifactBundleManifestHash: bundleHash,
      issuedAt: "2026-07-13T00:01:00Z",
      declaredDependencies: [{ receiptId: "receipt:not-issued", receiptHash: sha("0") }],
    }),
    /was not found/,
  );
  await assert.rejects(
    store.loadDependencyEvidence({
      downstreamReceiptId: "receipt:wrong-hash-check",
      artifactBundleManifestHash: bundleHash,
      issuedAt: "2026-07-13T00:01:00Z",
      declaredDependencies: [{ receiptId: upstreamReceipt.id, receiptHash: sha("0") }],
    }),
    /did not pass hash, signature, and policy verification/,
  );
  await assert.rejects(
    store.loadDependencyEvidence({
      downstreamReceiptId: upstreamReceipt.id,
      artifactBundleManifestHash: bundleHash,
      issuedAt: "2026-07-13T00:01:00Z",
      declaredDependencies: [{ receiptId: upstreamReceipt.id, receiptHash: upstreamReceiptHash }],
    }),
    /cannot declare itself/,
  );

  const replacement = await store.issue(receiptInput({
    id: "receipt:alice-lemma-correction",
    kind: "proof_patch",
    issuedAt: "2026-07-13T00:02:00Z",
  }));
  const correction = await store.recordLifecycleEvent({
    id: "receipt-event:alice-lemma-corrected",
    receiptId: first.receipt.id,
    eventType: "corrected",
    replacementReceiptId: replacement.receipt.id,
    reasonHash: sha("b"),
    occurredAt: "2026-07-13T00:03:00Z",
    issuerKeyId: "issuer:closed-alpha-1",
    issuerPublicKey,
    issuerPrivateKey: issuerPair.privateKey,
  });
  const correctionRetry = await store.recordLifecycleEvent({
    id: "receipt-event:alice-lemma-corrected",
    receiptId: first.receipt.id,
    eventType: "corrected",
    replacementReceiptId: replacement.receipt.id,
    reasonHash: sha("b"),
    occurredAt: "2026-07-13T00:03:00Z",
    issuerKeyId: "issuer:closed-alpha-1",
    issuerPublicKey,
    issuerPrivateKey: issuerPair.privateKey,
  });
  assert.equal(correction.created, true);
  assert.equal(correctionRetry.created, false);
  assert.equal(await verifyContributionReceiptLifecycleEventSignature(correction.event), true);
  const rogueIssuer = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  await assert.rejects(
    store.recordLifecycleEvent({
      id: "receipt-event:replacement-wrong-issuer",
      receiptId: replacement.receipt.id,
      eventType: "retracted",
      reasonHash: sha("c"),
      occurredAt: "2026-07-13T00:03:00Z",
      issuerKeyId: "issuer:rogue",
      issuerPublicKey: base64Url(await crypto.subtle.exportKey("raw", rogueIssuer.publicKey)),
      issuerPrivateKey: rogueIssuer.privateKey,
    }),
    /not registered with its embedded public key/,
  );

  const retraction = await store.recordLifecycleEvent({
    id: "receipt-event:alice-lemma-retracted",
    receiptId: first.receipt.id,
    eventType: "retracted",
    reasonHash: sha("c"),
    occurredAt: "2026-07-13T00:04:00Z",
    issuerKeyId: "issuer:closed-alpha-1",
    issuerPublicKey,
    issuerPrivateKey: issuerPair.privateKey,
  });
  assert.equal(retraction.event.replacementReceiptId, null);
  const lifecycleRows = await database
    .prepare("SELECT event_type, replacement_receipt_id FROM contribution_receipt_lifecycle_events WHERE receipt_id = ? ORDER BY occurred_at")
    .bind(first.receipt.id)
    .all();
  assert.deepEqual(lifecycleRows.results, [
    { event_type: "corrected", replacement_receipt_id: replacement.receipt.id },
    { event_type: "retracted", replacement_receipt_id: null },
  ]);
  await assert.rejects(
    store.recordLifecycleEvent({
      id: "receipt-event:alice-lemma-late-correction",
      receiptId: first.receipt.id,
      eventType: "corrected",
      replacementReceiptId: replacement.receipt.id,
      reasonHash: sha("d"),
      occurredAt: "2026-07-13T00:05:00Z",
      issuerKeyId: "issuer:closed-alpha-1",
      issuerPublicKey,
      issuerPrivateKey: issuerPair.privateKey,
    }),
    /cannot receive another lifecycle event/,
  );
  await assert.rejects(
    database.prepare("UPDATE contribution_receipt_lifecycle_events SET event_type = ? WHERE id = ?").bind("superseded", correction.event.id).run(),
    /contribution receipt lifecycle events are immutable/,
  );
  await assert.rejects(
    database.prepare("DELETE FROM contribution_receipt_lifecycle_events WHERE id = ?").bind(correction.event.id).run(),
    /contribution receipt lifecycle events cannot be deleted/,
  );
});

test("Receipt credit settlement derives immutable author, reviewer, and downstream entries exactly once", async () => {
  const receiptStore = new D1ContributionReceiptStore(database);
  await receiptStore.issue(receiptInput({ id: "receipt:alice-credit", kind: "infrastructure", issuedAt: "2026-07-13T00:04:00Z" }));
  const credits = new D1ReceiptCreditSettlement(database);
  const first = await credits.settleReceipt("receipt:alice-credit");
  const retry = await credits.settleReceipt("receipt:alice-credit");

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(first.totalUnits, 6);
  assert.equal(first.peopleCredited, 3);
  assert.deepEqual(first.categoryUnits, [
    { category: "certified_receipt", units: 1 },
    { category: "downstream_impact", units: 1 },
    { category: "infrastructure", units: 1 },
    { category: "verification", units: 3 },
  ]);
  const balances = await database.prepare(
    `SELECT person_id, SUM(units) AS units FROM receipt_credit_entries
     WHERE receipt_id = ? GROUP BY person_id ORDER BY person_id`,
  ).bind("receipt:alice-credit").all();
  assert.deepEqual(balances.results, [
    { person_id: "person:alice", units: 3 },
    { person_id: "person:bob", units: 2 },
    { person_id: "person:carol", units: 1 },
  ]);
  await assert.rejects(
    database.prepare("UPDATE receipt_credit_entries SET units = 2 WHERE receipt_id = ?").bind("receipt:alice-credit").run(),
    /receipt credit entries are immutable/,
  );
  await assert.rejects(
    database.prepare("DELETE FROM receipt_credit_settlements WHERE receipt_id = ?").bind("receipt:alice-credit").run(),
    /receipt credit settlements cannot be deleted/,
  );
});

test("verification receipt credits the review Agent present in immutable attestation evidence", async () => {
  const store = new D1ContributionReceiptStore(database);
  const receipt = await store.issue({
    ...receiptInput({ id: "receipt:bob-verification", kind: "verification" }),
    beneficiary: {
      personId: "person:bob",
      agentId: "agent:bob-reviewer",
      delegationCertificateId: "delegation:bob-reviewer",
    },
  });
  assert.equal(receipt.created, true);
  assert.equal(receipt.receipt.beneficiary.personId, "person:bob");

  await assert.rejects(
    store.issue({
      ...receiptInput({ id: "receipt:carol-verification", kind: "verification" }),
      beneficiary: {
        personId: "person:carol",
        agentId: "agent:carol-curator",
        delegationCertificateId: "delegation:carol-curator",
      },
    }),
    /must cover an attestation made by its credited review Agent/,
  );
});

test("retiring a receipt issuer key preserves historical evidence but moves issuance and lifecycle authority to its successor", async () => {
  const successorPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const successorPublicKey = base64Url(await crypto.subtle.exportKey("raw", successorPair.publicKey));
  const rotation = await issuerKeys.rotate({
    previousKeyId: "issuer:closed-alpha-1",
    id: "issuer:closed-alpha-2",
    publicKey: successorPublicKey,
    rotatedAt: "2026-07-13T00:05:00Z",
  });
  assert.equal(rotation.previousKey.status, "retired");
  assert.equal(rotation.key.status, "active");
  await issuerKeys.assertHistoricallyTrusted({
    issuerKeyId: "issuer:closed-alpha-1",
    issuerPublicKey,
    occurredAt: "2026-07-13T00:01:00Z",
  });
  await assert.rejects(
    issuerKeys.assertCanIssue({
      issuerKeyId: "issuer:closed-alpha-1",
      issuerPublicKey,
      issuedAt: "2026-07-13T00:06:00Z",
    }),
    /current active issuer key/,
  );

  const store = new D1ContributionReceiptStore(database);
  await assert.rejects(
    store.issue({
      ...receiptInput({ id: "receipt:old-key-after-rotation", kind: "synthesis", issuedAt: "2026-07-13T00:06:00Z" }),
    issuerPrivateKey: issuerPair.privateKey,
    issuerPublicKey,
  }),
    /current active issuer key/,
  );
  const successorReceipt = await store.issue({
    ...receiptInput({ id: "receipt:successor-key", kind: "synthesis", issuedAt: "2026-07-13T00:06:00Z" }),
    issuerKeyId: "issuer:closed-alpha-2",
    issuerPublicKey: successorPublicKey,
    issuerPrivateKey: successorPair.privateKey,
  });
  assert.equal(successorReceipt.created, true);
  assert.equal(successorReceipt.receipt.issuerKeyId, "issuer:closed-alpha-2");

  const lifecycle = await store.recordLifecycleEvent({
    id: "receipt-event:bob-verification-successor-retracted",
    receiptId: "receipt:bob-verification",
    eventType: "retracted",
    reasonHash: sha("d"),
    occurredAt: "2026-07-13T00:07:00Z",
    issuerKeyId: "issuer:closed-alpha-2",
    issuerPublicKey: successorPublicKey,
    issuerPrivateKey: successorPair.privateKey,
  });
  assert.equal(lifecycle.created, true);
  assert.equal(lifecycle.event.issuerKeyId, "issuer:closed-alpha-2");
  assert.equal(await verifyContributionReceiptLifecycleEventSignature(lifecycle.event), true);
});

function receiptInput({ id, kind, issuedAt = "2026-07-13T00:01:00Z" }) {
  return {
    id,
    kind,
    artifactBundleManifestHash: bundleHash,
    runId: "run:receipt-fixture",
    issuedAt,
    issuerKeyId: "issuer:closed-alpha-1",
    issuerPublicKey,
    issuerPrivateKey: issuerPair.privateKey,
  };
}

async function seedReceiptEvidence(d1) {
  const publicKeys = {
    alice: fixturePublicKey(1),
    bob: fixturePublicKey(2),
    carol: fixturePublicKey(3),
  };
  upstreamReceipt = await fixtureUpstreamReceipt();
  upstreamReceiptHash = await contributionReceiptHash(upstreamReceipt);
  const manifest = fixtureBundle(publicKeys.alice, {
    receiptId: upstreamReceipt.id,
    receiptHash: upstreamReceiptHash,
  });
  const runnerResult = fixtureRunnerResult();
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
      ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", [`person-key:${name}`, `person:${name}`, publicKeys[name], sha(`${name === "alice" ? "3" : name === "bob" ? "4" : "5"}`)]],
    ]),
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:alice-prover", "person:alice", "Alice prover", publicKeys.alice, sha("6")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:bob-reviewer", "person:bob", "Bob reviewer", publicKeys.bob, sha("7")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:carol-curator", "person:carol", "Carol curator", publicKeys.carol, sha("8")]],
    ...delegationStatements(publicKeys),
    [
      `INSERT INTO agent_attempts (id, person_id, problem_revision_id, agent_id, delegation_certificate_id, delegation_scope, agent_label, idempotency_key, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:receipt", "person:alice", "revision:receipt", "agent:alice-prover", "delegation:alice-prover", "prove", "Alice prover", "attempt-receipt", "2026-07-13T00:00:00Z"],
    ],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [bundleHash, `bundles/sha256/${"a".repeat(64)}/bundle.json`, 2, "application/json"]],
    ...["d", "e", "f"].map((character) => ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [sha(character), `bundles/sha256/${character.repeat(64)}/review.json`, 2, "application/json"]]),
    [
      `INSERT INTO artifact_bundles (id, attempt_id, problem_revision_id, manifest_hash, manifest_key, canonical_manifest, agent_event_id, agent_event_payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["bundle:receipt", "attempt:receipt", "revision:receipt", bundleHash, `bundles/sha256/${"a".repeat(64)}/bundle.json`, canonicalJson(manifest), "agent-event:receipt", sha("9")],
    ],
    [
      `INSERT INTO runs (id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state, queued_at, started_at, finished_at, runner_result_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["run:receipt-fixture", "attempt:receipt", bundleHash, runRequestHash, "run-receipt", "succeeded", "2026-07-13T00:00:00Z", "2026-07-13T00:00:01Z", "2026-07-13T00:00:02Z", runResultHash, "2026-07-13T00:00:02Z"],
    ],
    ["INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)", ["run:receipt-fixture", runResultHash, canonicalJson(runnerResult), "2026-07-13T00:00:02Z"]],
    ...assignmentAndAttestationStatements(bundleHash, publicKeys),
  ];
  for (const [statement, values] of statements) await d1.prepare(statement).bind(...values).run();
  await d1
    .prepare(
      `INSERT INTO contribution_receipts (
        id, kind, beneficiary_person_id, beneficiary_agent_id,
        beneficiary_delegation_certificate_id, attempt_id, problem_revision_id,
        artifact_bundle_manifest_hash, run_id, receipt_hash, canonical_receipt,
        payload_hash, issuer_key_id, issuer_public_key, issuer_signature, issued_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      upstreamReceipt.id, upstreamReceipt.kind, upstreamReceipt.beneficiary.personId,
      upstreamReceipt.beneficiary.agentId, upstreamReceipt.beneficiary.delegationCertificateId,
      upstreamReceipt.attempt.id, upstreamReceipt.attempt.problemRevisionId,
      upstreamReceipt.artifactBundleHash, upstreamReceipt.run.id, upstreamReceiptHash,
      canonicalJson(upstreamReceipt), upstreamReceipt.payloadHash,
      upstreamReceipt.issuerKeyId, upstreamReceipt.issuerPublicKey,
      upstreamReceipt.issuerSignature, upstreamReceipt.issuedAt,
    )
    .run();
}

function delegationStatements(publicKeys) {
  return [
    ["alice", "agent:alice-prover", "prove"],
    ["bob", "agent:bob-reviewer", "review"],
    ["carol", "agent:carol-curator", "review"],
  ].map(([person, agent, scope]) => [
    `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`delegation:${person}-${person === "alice" ? "prover" : person === "bob" ? "reviewer" : "curator"}`, `person:${person}`, agent, `person-key:${person}`, publicKeys[person], JSON.stringify([scope]), "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", `person:${person}`, "pw-delegation-v1", sha(person === "alice" ? "a" : person === "bob" ? "b" : "c"), "{}", "signature"],
  ]);
}

function assignmentAndAttestationStatements(manifestHash, publicKeys) {
  const entries = [
    ["bundle_reproducible", "bob", "d"],
    ["kernel_accepted", "bob", "e"],
    ["project_accepted", "carol", "f"],
  ];
  return entries.flatMap(([claimType, reviewer, evidenceCharacter]) => {
    const suffix = claimType.replaceAll("_", "-");
    const agent = reviewer === "bob" ? "agent:bob-reviewer" : "agent:carol-curator";
    const delegation = reviewer === "bob" ? "delegation:bob-reviewer" : "delegation:carol-curator";
    const attestation = fixtureAttestation({ id: `attestation:${suffix}`, assignmentId: `assignment:${suffix}`, claimType, reviewer, agent, delegation, publicKey: publicKeys[reviewer], evidenceHash: sha(evidenceCharacter) });
    return [
      [
        `INSERT INTO verification_assignments (id, artifact_bundle_manifest_hash, claim_type, attempt_owner_person_id, verifier_person_id, status, assigned_at, accepted_at, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [`assignment:${suffix}`, manifestHash, claimType, "person:alice", `person:${reviewer}`, "completed", "2026-07-13T00:00:10Z", "2026-07-13T00:00:11Z", "2026-07-13T00:00:12Z", "2026-07-13T00:00:12Z"],
      ],
      [
        `INSERT INTO verification_attestations (id, assignment_id, artifact_bundle_manifest_hash, claim_type, verifier_person_id, verifier_agent_id, delegation_certificate_id, verifier_agent_public_key, decision, evidence_hash, canonical_payload, payload_hash, signature, attested_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [attestation.id, attestation.assignmentId, manifestHash, claimType, `person:${reviewer}`, agent, delegation, publicKeys[reviewer], "attested", sha(evidenceCharacter), canonicalJson(attestation), attestation.payloadHash, attestation.signature, attestation.attestedAt],
      ],
    ];
  });
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
    dependencyReceipts: [dependencyReceipt],
    agentEvent: { eventId: "agent-event:receipt", occurredAt: "2026-07-13T00:00:00Z", payloadHash: sha("6"), agentPublicKey: publicKey, signature: base64Url(new Uint8Array(64)) },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}

async function fixtureUpstreamReceipt() {
  return createContributionReceipt({
    receipt: {
      protocolVersion: "pw-contribution-receipt-v1",
      id: "receipt:upstream",
      kind: "formalization",
      beneficiary: {
        personId: "person:alice",
        agentId: "agent:alice-prover",
        delegationCertificateId: "delegation:alice-prover",
      },
      attempt: {
        id: "attempt:receipt",
        personId: "person:alice",
        agentId: "agent:alice-prover",
        delegationCertificateId: "delegation:alice-prover",
        problemRevisionId: "revision:receipt",
      },
      target: { declaration: "Proofweave.Receipt.target", statementHash: sha("0") },
      artifactBundleHash: bundleHash,
      bundle: { manifestHash: bundleHash, dependencyReceipts: [] },
      run: {
        id: "run:receipt-fixture",
        requestHash: runRequestHash,
        resultHash: runResultHash,
        status: "succeeded",
        kernelStatus: "accepted",
      },
      claims: [
        fixtureReceiptClaim("bundle_reproducible", "bob"),
        fixtureReceiptClaim("kernel_accepted", "bob"),
        fixtureReceiptClaim("project_accepted", "carol"),
      ],
      issuedAt: "2026-07-13T00:00:00Z",
      policyVersion: "pw-receipt-policy-v1",
      issuerKeyId: "issuer:closed-alpha-1",
      issuerPublicKey,
    },
    issuerPrivateKey: issuerPair.privateKey,
  });
}

function fixtureReceiptClaim(claimType, reviewer) {
  const agent = reviewer === "bob" ? "agent:bob-reviewer" : "agent:carol-curator";
  const delegation = reviewer === "bob" ? "delegation:bob-reviewer" : "delegation:carol-curator";
  return {
    claimType,
    verificationAttestationId: `attestation:${claimType}`,
    verificationAttestationHash: sha(claimType === "bundle_reproducible" ? "d" : claimType === "kernel_accepted" ? "e" : "f"),
    artifactBundleHash: bundleHash,
    reviewerPersonId: `person:${reviewer}`,
    reviewerAgentId: agent,
    reviewerDelegationCertificateId: delegation,
    decision: "attested",
  };
}

function fixtureRunnerResult() {
  return {
    protocolVersion: "pw-lean-runner-v1", jobId: "run:receipt-fixture", attemptId: "attempt:receipt", requestHash: runRequestHash,
    runnerKeyId: "runner-key:receipt", runnerSignature: base64Url(new Uint8Array(64)), status: "succeeded", exitCode: 0,
    startedAt: "2026-07-13T00:00:01Z", finishedAt: "2026-07-13T00:00:02Z", kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: { manifestHash: sha("7"), stdoutHash: sha("8"), stderrHash: sha("9") },
  };
}

function fixtureAttestation({ id, assignmentId, claimType, reviewer, agent, delegation, publicKey, evidenceHash }) {
  return {
    protocolVersion: "pw-verification-attestation-v1", id, assignmentId, artifactBundleHash: bundleHash, claimType,
    verifierPersonId: `person:${reviewer}`, verifierAgentId: agent, delegationCertificateId: delegation,
    verifierAgentPublicKey: publicKey, decision: "attested", evidenceHash, attestedAt: "2026-07-13T00:00:12Z",
    payloadHash: sha(claimType === "bundle_reproducible" ? "a" : claimType === "kernel_accepted" ? "b" : "c"), signature: base64Url(new Uint8Array(64)),
  };
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

function fixturePublicKey(marker) {
  const bytes = new Uint8Array(32);
  bytes[31] = marker;
  return base64Url(bytes);
}
