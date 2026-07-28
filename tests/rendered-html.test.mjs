import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { delegationPayloadHash, delegationSigningPayload } from "../packages/domain/delegation.mjs";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { verificationReplayEvidenceHash } from "../packages/protocol/verification-replay-evidence.mjs";
import { personKeyProofChallengeSigningPayload } from "../packages/protocol/person-key-proof.mjs";
import {
  artifactBundleHash,
  canonicalArtifactBundle,
} from "../packages/protocol/artifact-bundle.mjs";
import {
  contributionReceiptHash,
  createContributionReceipt,
} from "../packages/protocol/contribution-receipt.mjs";
import { createContributionReceiptLifecycleEvent } from "../packages/protocol/contribution-receipt-lifecycle.mjs";
import {
  contributionReceiptVerificationBundleHash,
  verifyContributionReceiptVerificationBundle,
} from "../packages/protocol/contribution-receipt-verification-bundle.mjs";
import { signLeanRunnerResult } from "../packages/protocol/lean-runner.mjs";
import { D1VerificationStore } from "../services/verification/d1-verification-store.mjs";
import { closedAlphaAttemptLimits } from "../packages/domain/attempt-policy.mjs";
import { classifyReceiptPublication } from "../services/receipts/receipt-publication-policy.mjs";

const repositoryRoot = new URL("../", import.meta.url);
const migrationsRoot = new URL("../drizzle/", import.meta.url);
const workerRoot = new URL("../dist/server/", import.meta.url);
let miniflare;
let database;
let signedReceiptFixture;
let controlledEvidenceFixture;

before(async () => {
  const entrypoint = fileURLToPath(new URL("index.js", workerRoot));
  const modules = await listJavaScriptModules(workerRoot);

  miniflare = new Miniflare({
    modules: [
      { type: "ESModule", path: entrypoint },
      ...modules
        .filter((modulePath) => modulePath !== entrypoint)
        .map((modulePath) => ({ type: "ESModule", path: modulePath })),
    ],
    modulesRoot: fileURLToPath(workerRoot),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    bindings: {
      PROOFWEAVE_DEMO_AUTH_ENABLED: "true",
      PROOFWEAVE_DEMO_PERSON_LABEL: "Build Week Test Person",
    },
    serviceBindings: {
      ASSETS: async () => new Response("Not found", { status: 404 }),
    },
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
});

after(async () => {
  await miniflare?.dispose();
});

async function render(pathname = "/", init = {}) {
  return miniflare.dispatchFetch(
    `http://localhost${pathname}`,
    {
      ...init,
      headers: { accept: "text/html", ...(init.headers ?? {}) },
    },
  );
}

test("publishes one reachable Sites-safe MCP resource URL", async () => {
  const metadataResponse = await miniflare.dispatchFetch("https://localhost/.well-known/oauth-protected-resource", {
    headers: { accept: "application/json" },
  });
  assert.equal(metadataResponse.status, 200);
  const metadata = await metadataResponse.json();
  assert.equal(metadata.resource, "https://localhost/api/mcp");

  const challenge = await miniflare.dispatchFetch("https://localhost/api/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "route-test", version: "1" } },
    }),
  });
  assert.equal(challenge.status, 401);
  assert.match(challenge.headers.get("www-authenticate") ?? "", /oauth-protected-resource/);
});

test("publishes a public Connector compatibility contract", async () => {
  const response = await miniflare.dispatchFetch("https://localhost/api/mcp/capabilities", {
    headers: { accept: "application/json" },
  });
  assert.equal(response.status, 503);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  const contract = await response.json();
  assert.equal(contract.protocolVersion, "pw-local-connector-v1");
  assert.equal(contract.toolSchemaVersion, 1);
  assert.equal(contract.minimumConnectorApiVersion, 1);
  assert.equal(contract.recommendedConnectorApiVersion, 1);
  assert.equal(
    contract.distributionManifestUrl,
    "https://localhost/downloads/proofweave-research-marketplace.json",
  );
  assert.ok(contract.capabilities.includes("stable_attempt_handoff"));
  assert.deepEqual(contract.releaseDiagnostics, {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "degraded",
    authority: "sites_d1",
    databaseFingerprint: null,
    ledgerHead: null,
    sourceRevision: null,
    sitesVersion: null,
    siteProjectId: "appgprj_6a54400d01a8819199224b722afae056",
    failureCode: "release_identity_missing",
  });
  assert.deepEqual(contract.controlPlaneOperations, {
    schemaVersion: "pw-control-plane-operation-state-v1",
    mode: "read_write",
    writesEnabled: true,
    explicitlyConfigured: false,
  });
  assert.deepEqual(Object.keys(contract.releaseDiagnostics).sort(), [
    "authority",
    "databaseFingerprint",
    "failureCode",
    "ledgerHead",
    "schemaVersion",
    "siteProjectId",
    "sitesVersion",
    "sourceRevision",
    "state",
  ]);
  assert.doesNotMatch(JSON.stringify(contract.releaseDiagnostics), /token|password|private|libsql:\/\//i);
  assert.ok(contract.updatePolicy.liveWithoutRestart.includes("attempt_lifecycle"));
  assert.ok(contract.updatePolicy.restartCodexAfterPluginUpdate.includes("mcp_tool_input_schemas"));

  const ignoredOverride = await miniflare.dispatchFetch(
    "https://localhost/api/mcp/capabilities?distributionManifestUrl=https%3A%2F%2Fattacker.example%2Fplugin.json",
    { headers: { accept: "application/json" } },
  );
  assert.equal(ignoredOverride.status, 503);
  assert.equal(
    (await ignoredOverride.json()).distributionManifestUrl,
    "https://localhost/downloads/proofweave-research-marketplace.json",
  );
});

async function applyMigrations(d1, onlySeed = false) {
  const filenames = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(".sql"))
    .filter((filename) => !onlySeed || filename.includes("seed_formal_conjectures"))
    .sort();

  for (const filename of filenames) {
    const migration = await readFile(new URL(filename, migrationsRoot), "utf8");
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await d1.prepare(statement).run();
    }
  }
}

async function insertSignedReceiptFixture() {
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const issuerPublicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  ).toString("base64url");
  const hash = (character) => `sha256:${character.repeat(64)}`;
  const baseReceipt = {
    protocolVersion: "pw-contribution-receipt-v1",
    beneficiary: {
      personId: "person:fixture-owner",
      agentId: "agent:fixture-prover",
      delegationCertificateId: "delegation:fixture-prover",
    },
    attempt: {
      id: "attempt:fixture-public",
      personId: "person:fixture-owner",
      agentId: "agent:fixture-prover",
      delegationCertificateId: "delegation:fixture-prover",
      problemRevisionId: "revision:fixture-public",
    },
    target: { declaration: "Fixture.PublicLemma", statementHash: hash("a") },
    artifactBundleHash: hash("b"),
    run: {
      id: "run:fixture-public",
      requestHash: hash("c"),
      resultHash: hash("d"),
      status: "succeeded",
      kernelStatus: "accepted",
    },
    claims: [
      fixtureClaim("bundle_reproducible", "attestation:fixture-bundle", "agent:fixture-reviewer", "delegation:fixture-reviewer", hash("b"), hash("e")),
      fixtureClaim("kernel_accepted", "attestation:fixture-kernel", "agent:fixture-reviewer", "delegation:fixture-reviewer", hash("b"), hash("f")),
      fixtureClaim("project_accepted", "attestation:fixture-project", "agent:fixture-curator", "delegation:fixture-curator", hash("b"), hash("0")),
    ],
    policyVersion: "pw-receipt-policy-v1",
    issuerKeyId: "issuer:fixture",
    issuerPublicKey,
  };
  const upstreamReceipt = await createContributionReceipt({
    receipt: {
      ...baseReceipt,
      id: "receipt:upstream-public-fixture",
      kind: "formalization",
      bundle: { manifestHash: hash("b"), dependencyReceipts: [] },
      issuedAt: "2026-07-12T23:59:00Z",
    },
    issuerPrivateKey: keyPair.privateKey,
  });
  const upstreamReceiptHash = await contributionReceiptHash(upstreamReceipt);
  const receipt = await createContributionReceipt({
    receipt: {
      ...baseReceipt,
      id: "receipt:public-fixture",
      kind: "lemma",
      bundle: {
        manifestHash: hash("b"),
        dependencyReceipts: [{ receiptId: upstreamReceipt.id, receiptHash: upstreamReceiptHash }],
      },
      issuedAt: "2026-07-13T00:00:00Z",
    },
    issuerPrivateKey: keyPair.privateKey,
  });
  const receiptHash = await contributionReceiptHash(receipt);
  const smokeReceipt = await createContributionReceipt({
    receipt: {
      ...baseReceipt,
      id: "receipt:cloud-smoke-fixture",
      kind: "proof_patch",
      target: { declaration: "ProofweaveCloudSmoke.true_is_inhabited", statementHash: hash("8") },
      bundle: { manifestHash: hash("b"), dependencyReceipts: [] },
      issuedAt: "2026-07-13T00:00:30Z",
    },
    issuerPrivateKey: keyPair.privateKey,
  });
  const smokeReceiptHash = await contributionReceiptHash(smokeReceipt);
  const lifecycleEvent = await createContributionReceiptLifecycleEvent({
    event: {
      protocolVersion: "pw-contribution-receipt-lifecycle-event-v1",
      id: "receipt-event:public-fixture-retracted",
      receiptId: receipt.id,
      eventType: "retracted",
      reasonHash: hash("9"),
      occurredAt: "2026-07-13T00:01:00Z",
      issuerKeyId: receipt.issuerKeyId,
      issuerPublicKey: receipt.issuerPublicKey,
    },
    issuerPrivateKey: keyPair.privateKey,
  });

  await seedReceiptEvidenceFixture({ receipt, receiptHash, upstreamReceipt, upstreamReceiptHash, smokeReceipt, smokeReceiptHash, lifecycleEvent, hash });

  return { receipt, receiptHash, upstreamReceipt, upstreamReceiptHash, smokeReceipt, smokeReceiptHash, lifecycleEvent };
}

async function getSignedReceiptFixture() {
  signedReceiptFixture ??= insertSignedReceiptFixture();
  return signedReceiptFixture;
}

async function getControlledEvidenceFixture() {
  controlledEvidenceFixture ??= insertControlledEvidenceFixture();
  return controlledEvidenceFixture;
}

async function insertControlledEvidenceFixture() {
  const now = "2026-07-13T02:00:00Z";
  const rejectedAt = "2026-07-13T02:00:01Z";
  const ownerHeaders = {
    "oai-authenticated-user-email": "evidence-owner@example.test",
    "oai-authenticated-user-full-name": "Evidence%20Owner",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const reviewerHeaders = {
    "oai-authenticated-user-email": "evidence-reviewer@example.test",
    "oai-authenticated-user-full-name": "Evidence%20Reviewer",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const ownerProfile = await render("/api/me/delegation", { headers: ownerHeaders });
  const reviewerProfile = await render("/api/me/delegation", { headers: reviewerHeaders });
  const { profile: owner } = await ownerProfile.json();
  const { profile: reviewer } = await reviewerProfile.json();
  const archive = await putEvidenceObject("archive fixture bytes", "source.tar.zst", "application/zstd");
  const patch = await putEvidenceObject("--- a/Proofweave/Evidence.lean\n+++ b/Proofweave/Evidence.lean\n", "normalized.patch", "text/plain; charset=utf-8");
  const lakeManifest = await putEvidenceObject('{"packages":[]}', "lake-manifest.json", "application/json");
  const hash = (character) => `sha256:${character.repeat(64)}`;
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v1",
    id: "bundle:controlled-evidence",
    attemptId: "attempt:controlled-evidence",
    problemRevisionId: "revision:controlled-evidence",
    target: { declaration: "Proofweave.Evidence.target", statementHash: hash("a") },
    source: {
      archiveKey: archive.objectKey,
      archiveHash: archive.contentHash,
      treeHash: hash("b"),
      patchKey: patch.objectKey,
      patchHash: patch.contentHash,
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0",
      lakeManifestKey: lakeManifest.objectKey,
      lakeManifestHash: lakeManifest.contentHash,
      mathlibRevision: "fixture-evidence",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Evidence.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:controlled-evidence",
      occurredAt: now,
      payloadHash: hash("c"),
      agentPublicKey: base64Url(crypto.getRandomValues(new Uint8Array(32))),
      signature: base64Url(crypto.getRandomValues(new Uint8Array(64))),
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  const canonicalManifest = canonicalArtifactBundle(bundle);
  const manifestHash = await artifactBundleHash(bundle);
  const manifest = await putEvidenceObject(canonicalManifest, "bundle.json", "application/json", manifestHash);
  const rejectedBundle = {
    ...bundle,
    id: "bundle:controlled-evidence-rejected",
    agentEvent: {
      ...bundle.agentEvent,
      eventId: "agent-event:controlled-evidence-rejected",
      occurredAt: rejectedAt,
      payloadHash: hash("6"),
    },
  };
  const rejectedCanonicalManifest = canonicalArtifactBundle(rejectedBundle);
  const rejectedManifestHash = await artifactBundleHash(rejectedBundle);
  const rejectedManifest = await putEvidenceObject(
    rejectedCanonicalManifest,
    "bundle.json",
    "application/json",
    rejectedManifestHash,
  );
  const stdout = await putRunnerOutput("kernel accepted\n", "stdout");
  const stderr = await putRunnerOutput("", "stderr");
  const rejectedStdout = await putRunnerOutput("bundle B rejected\n", "stdout");
  const reviewerReplayPublicKey = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const replayRunnerResult = {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:controlled-fresh-replay",
    attemptId: bundle.attemptId,
    requestHash: hash("1"),
    runnerKeyId: "runner-key:controlled-evidence",
    runnerSignature: base64Url(crypto.getRandomValues(new Uint8Array(64))),
    status: "succeeded",
    exitCode: 0,
    startedAt: now,
    finishedAt: now,
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: { manifestHash: manifest.contentHash, stdoutHash: stdout.contentHash, stderrHash: stderr.contentHash },
  };
  const replayRunnerResultHash = await sha256Canonical(replayRunnerResult);
  const ownerRunnerResult = {
    ...replayRunnerResult,
    jobId: "run:controlled-evidence",
    requestHash: hash("f"),
    artifacts: { manifestHash: manifest.contentHash, stdoutHash: stdout.contentHash, stderrHash: stderr.contentHash },
  };
  const ownerRunnerResultHash = await sha256Canonical(ownerRunnerResult);
  const poolCreatedPayload = {
    protocolVersion: "pw-credit-pool-event-v1",
    poolId: "pool:controlled-evidence",
    sequence: 1,
    eventType: "created",
    occurredAt: "2026-07-13T01:59:58Z",
  };
  const poolActivatedPayload = {
    protocolVersion: "pw-credit-pool-event-v1",
    poolId: "pool:controlled-evidence",
    sequence: 2,
    eventType: "activated",
    occurredAt: "2026-07-13T01:59:59Z",
  };
  const replayEvidence = {
    protocolVersion: "pw-verification-replay-evidence-v1",
    id: "verification-replay-evidence:verification-replay:controlled-evidence",
    replayId: "verification-replay:controlled-evidence",
    assignmentId: "assignment:controlled-evidence-replay",
    runId: replayRunnerResult.jobId,
    artifactBundleHash: manifest.contentHash,
    runnerResultHash: replayRunnerResultHash,
    runnerResult: replayRunnerResult,
    recordedAt: now,
  };
  const canonicalReplayEvidence = canonicalJson(replayEvidence);
  const replayEvidenceHash = await verificationReplayEvidenceHash(replayEvidence);
  const replayEvidenceObject = await putEvidenceObject(
    canonicalReplayEvidence,
    "verification-replay-evidence.json",
    "application/vnd.proofweave.verification-replay-evidence+json",
    replayEvidenceHash,
  );

  const rows = [
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:controlled-evidence", "fixture", "https://example.test/evidence", "v1", "evidence-fixture", now, hash("d"), hash("e"), "MIT", "leanprover/lean4:v4.27.0", "fixture-evidence"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:controlled-evidence", "controlled-evidence", "frontier", "Controlled evidence", "Fixture project"]],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:controlled-evidence", "project:controlled-evidence", "snapshot:controlled-evidence", "Proofweave.Evidence.target", "controlled-evidence-target", 1, "Controlled evidence target", "logic", "research_open", "fixture", "theorem target : True := by trivial"],
    ],
    [
      `INSERT INTO declarations (
        id, problem_revision_id, qualified_name, declaration_kind,
        source_path, source_url, source_line_start, source_line_end,
        source_content_hash, is_primary
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "declaration:controlled-evidence", "revision:controlled-evidence",
        "Proofweave.Evidence.target", "theorem", "Proofweave/Evidence.lean",
        "https://example.test/evidence/Proofweave/Evidence.lean#L1", 1, 1, hash("d"), 1,
      ],
    ],
    [
      `INSERT INTO verification_claims (
        id, problem_revision_id, claim_type, status, evidence_url, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "claim:controlled-evidence:bundle", "revision:controlled-evidence",
        "bundle_reproducible", "not_submitted", null, now,
      ],
    ],
    [
      "INSERT INTO problem_credit_pools (id, problem_revision_id, policy_version, total_credits, sponsor_label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["pool:controlled-evidence", "revision:controlled-evidence", "pw-credit-market-v1", 5_000, "Controlled evidence pilot", poolCreatedPayload.occurredAt],
    ],
    [
      "INSERT INTO problem_credit_pool_events (id, pool_id, sequence, event_type, payload_hash, canonical_payload, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["pool-event:controlled-evidence:created", "pool:controlled-evidence", 1, "created", await sha256Canonical(poolCreatedPayload), canonicalJson(poolCreatedPayload), poolCreatedPayload.occurredAt],
    ],
    [
      "INSERT INTO problem_credit_pool_events (id, pool_id, sequence, event_type, payload_hash, canonical_payload, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ["pool-event:controlled-evidence:activated", "pool:controlled-evidence", 2, "activated", await sha256Canonical(poolActivatedPayload), canonicalJson(poolActivatedPayload), poolActivatedPayload.occurredAt],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_label, status, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:controlled-evidence", owner.person.id, "revision:controlled-evidence", "Controlled evidence Agent", "submitted", "controlled-evidence-attempt", now, now],
    ],
    [
      `INSERT INTO artifact_bundles (
        id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
        canonical_manifest, agent_event_id, agent_event_payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [bundle.id, bundle.attemptId, bundle.problemRevisionId, manifest.contentHash, manifest.objectKey, canonicalManifest, bundle.agentEvent.eventId, bundle.agentEvent.payloadHash],
    ],
    [
      `INSERT INTO artifact_bundles (
        id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
        canonical_manifest, agent_event_id, agent_event_payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        rejectedBundle.id, rejectedBundle.attemptId, rejectedBundle.problemRevisionId,
        rejectedManifest.contentHash, rejectedManifest.objectKey, rejectedCanonicalManifest,
        rejectedBundle.agentEvent.eventId, rejectedBundle.agentEvent.payloadHash,
      ],
    ],
    [
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state,
        queued_at, started_at, finished_at, runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["run:controlled-evidence", bundle.attemptId, manifest.contentHash, hash("f"), "controlled-evidence-run", "succeeded", now, now, now, ownerRunnerResultHash, now],
    ],
    ["INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)", ["run:controlled-evidence", ownerRunnerResultHash, canonicalJson(ownerRunnerResult), now]],
    ["INSERT INTO runner_output_artifacts (id, run_id, role, content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?, ?, ?, ?)", ["runner-output:controlled-evidence:stdout", "run:controlled-evidence", "stdout", stdout.contentHash, stdout.objectKey, stdout.byteLength, stdout.contentType]],
    ["INSERT INTO runner_output_artifacts (id, run_id, role, content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?, ?, ?, ?)", ["runner-output:controlled-evidence:stderr", "run:controlled-evidence", "stderr", stderr.contentHash, stderr.objectKey, stderr.byteLength, stderr.contentType]],
    [
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state,
        queued_at, started_at, finished_at, runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "run:controlled-evidence-rejected", rejectedBundle.attemptId,
        rejectedManifest.contentHash, hash("7"), "controlled-evidence-rejected-run",
        "failed", rejectedAt, rejectedAt, rejectedAt, null, rejectedAt,
      ],
    ],
    [
      "INSERT INTO runner_output_artifacts (id, run_id, role, content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [
        "runner-output:controlled-evidence-rejected:stdout",
        "run:controlled-evidence-rejected", "stdout", rejectedStdout.contentHash,
        rejectedStdout.objectKey, rejectedStdout.byteLength, rejectedStdout.contentType,
      ],
    ],
    [
      `INSERT INTO verification_assignments (
        id, artifact_bundle_manifest_hash, claim_type, attempt_owner_person_id,
        verifier_person_id, status, assigned_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["assignment:controlled-evidence", manifest.contentHash, "kernel_accepted", owner.person.id, reviewer.person.id, "assigned", now, now],
    ],
    ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", ["person-key:controlled-evidence-reviewer", reviewer.person.id, reviewerReplayPublicKey, hash("2")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:controlled-evidence-reviewer", reviewer.person.id, "Controlled evidence reviewer", reviewerReplayPublicKey, hash("3")]],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json,
        valid_from, valid_until, beneficiary_person_id, protocol_version,
        payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "delegation:controlled-evidence-reviewer", reviewer.person.id, "agent:controlled-evidence-reviewer", "person-key:controlled-evidence-reviewer", reviewerReplayPublicKey, '["review"]',
        "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", reviewer.person.id,
        "pw-delegation-v1", hash("4"), "{}", "fixture-signature",
      ],
    ],
    ["INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)", ["client:controlled-evidence-reviewer", "Controlled evidence reviewer", '["https://codex.example.test/callback"]']],
    ["INSERT INTO agent_installations (id, person_id, agent_id, delegation_certificate_id, client_id, label) VALUES (?, ?, ?, ?, ?, ?)", ["installation:controlled-evidence-reviewer", reviewer.person.id, "agent:controlled-evidence-reviewer", "delegation:controlled-evidence-reviewer", "client:controlled-evidence-reviewer", "Controlled evidence reviewer"]],
    [
      `INSERT INTO verification_attestations (
        id, assignment_id, artifact_bundle_manifest_hash, claim_type,
        verifier_person_id, verifier_agent_id, delegation_certificate_id,
        verifier_agent_public_key, decision, evidence_hash, canonical_payload,
        payload_hash, signature, attested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "attestation:controlled-evidence-integrity", "assignment:controlled-evidence", manifest.contentHash, "kernel_accepted",
        reviewer.person.id, "agent:controlled-evidence-reviewer", "delegation:controlled-evidence-reviewer",
        reviewerReplayPublicKey, "integrity_flagged", patch.contentHash, '{"decision":"integrity_flagged"}', hash("5"), "fixture-signature", now,
      ],
    ],
    ["UPDATE verification_assignments SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?", ["completed", now, now, "assignment:controlled-evidence"]],
    [
      `INSERT INTO verification_assignments (
        id, artifact_bundle_manifest_hash, claim_type, attempt_owner_person_id,
        verifier_person_id, status, assigned_at, accepted_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["assignment:controlled-evidence-replay", manifest.contentHash, "bundle_reproducible", owner.person.id, reviewer.person.id, "accepted", now, now, now],
    ],
    [
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state,
        queued_at, started_at, finished_at, runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [replayRunnerResult.jobId, bundle.attemptId, manifest.contentHash, replayRunnerResult.requestHash, "controlled-evidence-fresh-replay", "succeeded", now, now, now, replayRunnerResultHash, now],
    ],
    ["INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)", [replayRunnerResult.jobId, replayRunnerResultHash, canonicalJson(replayRunnerResult), now]],
    [
      `INSERT INTO verification_replays (
        id, assignment_id, run_id, artifact_bundle_manifest_hash,
        requester_person_id, requester_agent_id, delegation_certificate_id,
        agent_installation_id, idempotency_key, requested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        replayEvidence.replayId, replayEvidence.assignmentId, replayEvidence.runId, manifest.contentHash,
        reviewer.person.id, "agent:controlled-evidence-reviewer", "delegation:controlled-evidence-reviewer",
        "installation:controlled-evidence-reviewer", "controlled-evidence-fresh-workspace", now,
      ],
    ],
    [
      `INSERT INTO verification_replay_evidence (
        id, replay_id, assignment_id, run_id, artifact_bundle_manifest_hash,
        runner_result_hash, evidence_hash, canonical_evidence, recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        replayEvidence.id, replayEvidence.replayId, replayEvidence.assignmentId, replayEvidence.runId,
        manifest.contentHash, replayRunnerResultHash, replayEvidenceObject.contentHash, canonicalReplayEvidence, now,
      ],
    ],
  ];
  for (const [query, bindings] of rows) await database.prepare(query).bind(...bindings).run();
  return {
    ownerHeaders, reviewerHeaders, owner, reviewer,
    attemptId: bundle.attemptId,
    manifestHash: manifest.contentHash,
    rejectedManifestHash: rejectedManifest.contentHash,
    rejectedOutputArtifactId: "run:run:controlled-evidence-rejected:stdout",
    integrityFlagEvidenceHash: patch.contentHash,
    replayEvidenceHash: replayEvidenceObject.contentHash,
    replayArtifactId: `replay:${replayEvidence.replayId}:evidence`,
  };
}

async function putEvidenceObject(value, filename, contentType, expectedHash = null) {
  const bytes = new TextEncoder().encode(value);
  const contentHash = await sha256Bytes(bytes);
  assert.equal(expectedHash ?? contentHash, contentHash);
  const objectKey = `bundles/sha256/${contentHash.slice("sha256:".length)}/${filename}`;
  await putInlineObject({ objectKey, contentHash, bytes, contentType });
  await database.prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)").bind(contentHash, objectKey, bytes.byteLength, contentType).run();
  return { contentHash, objectKey, byteLength: bytes.byteLength, contentType };
}

async function putRunnerOutput(value, role) {
  const bytes = new TextEncoder().encode(value);
  const contentHash = await sha256Bytes(bytes);
  const objectKey = `runner-results/sha256/${contentHash.slice("sha256:".length)}/${role}.log`;
  const contentType = "text/plain; charset=utf-8";
  await putInlineObject({ objectKey, contentHash, bytes, contentType });
  return { contentHash, objectKey, byteLength: bytes.byteLength, contentType };
}

async function putInlineObject({ objectKey, contentHash, bytes, contentType }) {
  await database
    .prepare("INSERT INTO inline_artifact_bytes (object_key, content_hash, byte_length, content_type, bytes) VALUES (?, ?, ?, ?, ?)")
    .bind(objectKey, contentHash, bytes.byteLength, contentType, bytes)
    .run();
}

async function insertPublicDelegationFixture() {
  const now = "2026-07-13T00:00:00Z";
  const ownerKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const agentKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const ownerPublicKey = base64Url(await crypto.subtle.exportKey("raw", ownerKeys.publicKey));
  const agentPublicKey = base64Url(await crypto.subtle.exportKey("raw", agentKeys.publicKey));
  const certificate = {
    id: "delegation:public-fixture",
    ownerPersonId: "person:public-delegation",
    agentId: "agent:public-delegation",
    agentPublicKey,
    scopes: ["prove", "formalize"],
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    attributionPolicy: {
      beneficiaryPersonId: "person:public-delegation",
      mode: "agent_delegated",
    },
  };
  const canonicalPayload = canonicalJson(delegationSigningPayload(certificate));
  const personSignature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      ownerKeys.privateKey,
      new TextEncoder().encode(canonicalPayload),
    ),
  );
  const payloadHash = await delegationPayloadHash(certificate);

  const rows = [
    [
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
      [certificate.ownerPersonId, "proofweave", "public-delegation", "Private fixture display name", now],
    ],
    [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      ["person-key:public-delegation", certificate.ownerPersonId, ownerPublicKey, "sha256:public-delegation-key"],
    ],
    [
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      [certificate.agentId, certificate.ownerPersonId, "Private fixture agent label", agentPublicKey, "sha256:public-delegation-agent-key"],
    ],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json,
        valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash,
        canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        certificate.id, certificate.ownerPersonId, certificate.agentId,
        "person-key:public-delegation", certificate.agentPublicKey,
        JSON.stringify(["formalize", "prove"]), certificate.validFrom,
        certificate.validUntil, certificate.attributionPolicy.beneficiaryPersonId,
        "pw-delegation-v1", payloadHash, canonicalPayload, personSignature,
      ],
    ],
  ];

  for (const [query, bindings] of rows) {
    await database.prepare(query).bind(...bindings).run();
  }
  return { certificate, canonicalPayload, ownerPublicKey, payloadHash, personSignature };
}

async function seedReceiptEvidenceFixture({ receipt, receiptHash, upstreamReceipt, upstreamReceiptHash, smokeReceipt, smokeReceiptHash, lifecycleEvent, hash }) {
  const now = "2026-07-13T00:00:00Z";
  const rows = [
    [
      `INSERT INTO source_snapshots (
        id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at,
        content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:fixture-public", "fixture", "https://example.test/fixture", "v1", "fixture-public", now, hash("1"), hash("2"), "MIT", "leanprover/lean4:v4.27.0", "fixture"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:fixture-public", "fixture-public", "frontier", "Fixture", "Fixture"]],
    [
      `INSERT INTO problem_revisions (
        id, project_id, source_snapshot_id, target_key, slug, revision_number,
        title, domain, research_status, informal_statement, lean_statement
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt.attempt.problemRevisionId, "project:fixture-public", "snapshot:fixture-public", "fixture-target", "fixture-target", 1, "Fixture target", "logic", "research_open", "fixture", "theorem public_fixture : True := by trivial"],
    ],
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", [receipt.beneficiary.personId, "proofweave", "fixture-owner", "Fixture owner", now]],
    ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", ["person-key:fixture-owner", receipt.beneficiary.personId, "fixture-person-key", hash("3")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", [receipt.beneficiary.agentId, receipt.beneficiary.personId, "Fixture prover", "fixture-agent-key", hash("4")]],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json,
        valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash,
        canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt.beneficiary.delegationCertificateId, receipt.beneficiary.personId, receipt.beneficiary.agentId, "person-key:fixture-owner", "fixture-agent-key", '["formalize","prove"]', now, "2027-07-13T00:00:00Z", receipt.beneficiary.personId, "pw-delegation-v1", hash("5"), "{}", "fixture-signature"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        agent_label, status, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt.attempt.id, receipt.attempt.personId, receipt.attempt.problemRevisionId, receipt.attempt.agentId, receipt.attempt.delegationCertificateId, "Fixture prover", "active", "fixture-attempt", now, now],
    ],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [receipt.artifactBundleHash, "bundles/fixture-public.json", 1, "application/json"]],
    [
      `INSERT INTO artifact_bundles (
        id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
        canonical_manifest, agent_event_id, agent_event_payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["bundle:fixture-public", receipt.attempt.id, receipt.attempt.problemRevisionId, receipt.artifactBundleHash, "bundles/fixture-public.json", "{}", "agent-event:fixture-public", hash("6")],
    ],
    [
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state,
        queued_at, finished_at, runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receipt.run.id, receipt.attempt.id, receipt.artifactBundleHash, receipt.run.requestHash, "fixture-run", "succeeded", now, now, receipt.run.resultHash, now],
    ],
    ["INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)", [receipt.run.id, receipt.run.resultHash, "{}", now]],
  ];

  for (const [query, bindings] of rows) {
    await database.prepare(query).bind(...bindings).run();
  }
  await database
    .prepare(
      `INSERT INTO contribution_receipt_issuer_keys (
        id, public_key, status, valid_from, retired_at, revoked_at
      ) VALUES (?, ?, 'active', ?, NULL, NULL)`,
    )
    .bind(upstreamReceipt.issuerKeyId, upstreamReceipt.issuerPublicKey, upstreamReceipt.issuedAt)
    .run();
  await database
    .prepare(
      `INSERT INTO contribution_receipt_issuer_key_events (
        id, key_id, event_type, related_key_id, occurred_at
      ) VALUES (?, ?, 'activated', NULL, ?)`,
    )
    .bind(`issuer-key-event:activated:${upstreamReceipt.issuerKeyId}`, upstreamReceipt.issuerKeyId, upstreamReceipt.issuedAt)
    .run();
  for (const [record, recordHash] of [[upstreamReceipt, upstreamReceiptHash], [receipt, receiptHash], [smokeReceipt, smokeReceiptHash]]) {
    await database
      .prepare(
        `INSERT INTO contribution_receipts (
          id, kind, beneficiary_person_id, beneficiary_agent_id,
          beneficiary_delegation_certificate_id, attempt_id, problem_revision_id,
          artifact_bundle_manifest_hash, run_id, receipt_hash, canonical_receipt,
          payload_hash, issuer_key_id, issuer_public_key, issuer_signature, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        record.id, record.kind, record.beneficiary.personId, record.beneficiary.agentId,
        record.beneficiary.delegationCertificateId, record.attempt.id,
        record.attempt.problemRevisionId, record.artifactBundleHash, record.run.id,
        recordHash, canonicalJson(record), record.payloadHash, record.issuerKeyId,
        record.issuerPublicKey, record.issuerSignature, record.issuedAt,
      )
      .run();
    const publication = classifyReceiptPublication(record);
    await database.prepare(
      `INSERT INTO contribution_receipt_publications (
        receipt_id, record_class, visibility, policy_version,
        classification_reason, classified_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      record.id, publication.recordClass, publication.visibility,
      publication.policyVersion, publication.reason, publication.classifiedAt,
    ).run();
  }
  await database
    .prepare(
      `INSERT INTO contribution_receipt_dependency_edges (
        downstream_receipt_id, upstream_receipt_id, upstream_receipt_hash,
        declared_by_bundle_manifest_hash, recorded_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      receipt.id, upstreamReceipt.id, upstreamReceiptHash,
      receipt.artifactBundleHash, receipt.issuedAt,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO contribution_receipt_lifecycle_events (
        id, receipt_id, event_type, replacement_receipt_id, reason_hash,
        occurred_at, issuer_key_id, issuer_public_key, canonical_payload,
        payload_hash, issuer_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      lifecycleEvent.id, lifecycleEvent.receiptId, lifecycleEvent.eventType,
      lifecycleEvent.replacementReceiptId, lifecycleEvent.reasonHash,
      lifecycleEvent.occurredAt, lifecycleEvent.issuerKeyId,
      lifecycleEvent.issuerPublicKey, canonicalJson(lifecycleEvent),
      lifecycleEvent.payloadHash, lifecycleEvent.issuerSignature,
    )
    .run();
}

function fixtureClaim(
  claimType,
  verificationAttestationId,
  reviewerAgentId,
  reviewerDelegationCertificateId,
  artifactBundleHash,
  verificationAttestationHash,
) {
  return {
    claimType,
    verificationAttestationId,
    verificationAttestationHash,
    artifactBundleHash,
    reviewerPersonId: "person:fixture-reviewer",
    reviewerAgentId,
    reviewerDelegationCertificateId,
    decision: "attested",
  };
}

async function listJavaScriptModules(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedModules = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        return listJavaScriptModules(new URL(`${entry.name}/`, directory));
      }

      return entry.name.endsWith(".js")
        ? [fileURLToPath(new URL(entry.name, directory))]
        : [];
    }),
  );

  return nestedModules.flat();
}

test("server-renders the Proofweave welcome page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(
    html,
    /<title>Proofweave — Advance mathematics through your agent<\/title>/i,
  );
  assert.match(html, /Advance mathematics through your Agent/i);
  assert.match(html, /Public alpha/i);
  assert.match(html, /Executable verified demo/i);
  assert.match(html, /Watch the proof journey/i);
  assert.match(html, /Contribution records/i);
  assert.match(html, /brand-mark/i);
  assert.doesNotMatch(html, /proof-paper-mark/i);
  assert.match(html, /One theorem[\s\S]*Six evidence moments/i);
  assert.match(html, /id="proof-journey"/i);
  assert.match(html, /Not one Agent solving alone/i);
});

test("guides a public visitor through the first accountable contribution path", async () => {
  const page = await render("/start?target=erdos-865-k2", { redirect: "manual" });
  assert.equal(page.status, 307);
  assert.match(page.headers.get("location") ?? "", /\/workbench\?target=erdos-865-k2#research-launcher$/i);
});

test("serves the public research paths", async () => {
  const expectedPageContent = new Map([
    ["/showcase", /See a proof become[\s\S]*public contribution/i],
    ["/demo", /Watch one Lean proof become/i],
    ["/history", /From one Erdős problem to the Jacobian frontier/i],
    ["/explore", /Find where your Agent can make a useful contribution/i],
    ["/explore/erdos-865", /Erdős Problem 865/i],
    ["/how-it-works", /One shared frontier\. One useful step at a time/i],
    ["/how-it-works/research", /Move one bounded research task forward/i],
    ["/how-it-works/verification", /Check one exact claim, independently/i],
    ["/how-it-works/contribution-records", /Credit the proof path, not just the last submitter/i],
    ["/about", /A shared research network for people and their Agents/i],
    ["/about/principles", /Six rules that protect useful research/i],
    ["/about/catalog-standard", /Before a famous problem is presented as current/i],
    ["/about/shared-research", /One frontier map\. Many coordinated Agents/i],
    ["/privacy", /Your mathematical record can be public/i],
    ["/terms", /Contribute carefully/i],
    ["/workbench", /One private place for your Agent's research/i],
    ["/settings", /Manage your research Agent/i],
    ["/integrations", /Keep your research Agent on your computer/i],
    ["/receipt/abc-l1", /Receipt not issued/i],
    ["/delegations/abc-l1", /Delegation not found/i],
  ]);

  for (const [pathname, expectedContent] of expectedPageContent) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should respond with 200`);
    assert.match(
      await response.text(),
      expectedContent,
      `${pathname} should render its heading`,
    );
  }

  const settings = await render("/settings");
  const settingsHtml = await settings.text();
  assert.match(settingsHtml, /Choose a sign-in method/i);
  assert.match(settingsHtml, /\/sign-in\?return_to=/);
  assert.match(settingsHtml, />Sign in</i);

  const signIn = await render("/sign-in");
  const signInHtml = await signIn.text();
  assert.equal(signIn.status, 200);
  assert.match(signInHtml, /Continue with Google/i);
  assert.match(signInHtml, /Continue with ChatGPT/i);
  assert.match(signInHtml, /One Person, multiple sign-in methods/i);

  const privateProfile = await render("/profile", { redirect: "manual" });
  assert.ok(
    [302, 303, 307, 308].includes(privateProfile.status),
    `expected an auth redirect, received ${privateProfile.status} with location ${privateProfile.headers.get("location") ?? "none"}`,
  );
  assert.match(privateProfile.headers.get("location") ?? "", /\/sign-in.*profile/i);

  const workbench = await render("/workbench");
  const workbenchHtml = await workbench.text();
  assert.match(workbenchHtml, /One private place for your Agent's research/i);
  assert.match(workbenchHtml, /Empty dashboards stay hidden/i);
  const anonymousWorkspaceSummary = await render("/api/me/workspace-summary");
  assert.equal(anonymousWorkspaceSummary.status, 401);

  const detail = await render("/explore/erdos-865");
  const detailHtml = await detail.text();
  assert.match(detailHtml, /See what has been tried\. Continue what matters\./i);
  assert.match(detailHtml, /Reward the proof path, not just the finish\./i);
  assert.match(detailHtml, /Policy first\. Pool second\./i);
  assert.match(detailHtml, /Token or compute spend never mints mathematical credit/i);
  assert.match(detailHtml, /No public research checkpoint yet/i);
  assert.match(detailHtml, /Start an Attempt/i);
  assert.match(detailHtml, /workbench\?target=erdos-865/i);

  const explore = await render("/explore");
  const exploreHtml = await explore.text();
  assert.match(exploreHtml, /Find where your Agent can make a useful contribution/i);
  assert.match(exploreHtml, /What can your Agent contribute now/i);
  assert.match(exploreHtml, /Formalize known mathematics/i);
  assert.match(exploreHtml, /Advance an open branch/i);
  assert.match(exploreHtml, /Verify submitted work/i);
  assert.match(exploreHtml, /Founding Challenges/i);
  assert.match(exploreHtml, /Grand Challenges/i);
  assert.match(exploreHtml, /Recommended now · first contribution/i);
  assert.match(exploreHtml, /Begin with bounded formalization/i);
  assert.match(exploreHtml, /Start this contribution/i);
  assert.match(exploreHtml, /workbench\?target=erdos-865-k2/i);
  assert.match(exploreHtml, /Choose the next useful action/i);
  assert.match(exploreHtml, /Formalize known results/i);
  assert.match(exploreHtml, /Bounded milestones/i);
  assert.match(exploreHtml, /Start an Attempt/i);
  assert.doesNotMatch(exploreHtml, /Show Lean/i);
  assert.match(exploreHtml, /Hadwiger–Nelson Problem/i);
  assert.match(exploreHtml, /Navier–Stokes Existence and Smoothness/i);
  assert.match(exploreHtml, /P versus NP/i);
  assert.match(exploreHtml, /Smooth Poincaré conjecture in dimension four/i);
  assert.match(exploreHtml, /Number theory/i);
  assert.match(exploreHtml, /Computer science/i);
  assert.match(exploreHtml, />MSC /i);
  assert.match(exploreHtml, /Known result · Lean proof wanted/i);

  const curatedDetail = await render("/explore/sunflower-conjecture");
  assert.equal(curatedDetail.status, 200);
  const curatedDetailHtml = await curatedDetail.text();
  assert.match(curatedDetailHtml, /Erdős–Rado Sunflower Conjecture/i);
  assert.match(curatedDetailHtml, /Combinatorics/i);
  assert.match(curatedDetailHtml, /curated-focus-v1-lean4\.27\.0/i);
  assert.match(curatedDetailHtml, /b2e608fc52d765510915a244bb69b1a2741acc3c/i);
  assert.match(curatedDetailHtml, /workbench\?target=sunflower-conjecture/i);
  assert.match(curatedDetailHtml, /Why prior work and freshness are required/i);

  const expandedDetail = await render("/explore/p-vs-np");
  assert.equal(expandedDetail.status, 200);
  const expandedDetailHtml = await expandedDetail.text();
  assert.match(expandedDetailHtml, /P versus NP/i);
  assert.match(expandedDetailHtml, /curated-expansion-v1-lean4\.27\.0/i);
  assert.match(expandedDetailHtml, /Open conjecture/i);

  const knownResultDetail = await render("/explore/catalan-mihailescu-theorem");
  assert.equal(knownResultDetail.status, 200);
  assert.match(await knownResultDetail.text(), /Known result · Lean proof wanted/i);

  const about = await render("/about");
  const aboutHtml = await about.text();
  assert.match(aboutHtml, /Research coordination, evidence, and attribution/i);
  assert.match(aboutHtml, /Proofweave was initiated and built by Alex Yu/i);
  assert.match(aboutHtml, /github\.com\/alexyyyander\/proofweave-open-catalog/i);

  const catalogStandard = await render("/about/catalog-standard");
  const catalogStandardHtml = await catalogStandard.text();
  assert.match(catalogStandardHtml, /Before a famous problem is presented as current/i);
  assert.match(catalogStandardHtml, /many records are source-pinned imports and explicitly remain frontier-unreviewed/i);
  assert.match(catalogStandardHtml, /github\.com\/alexyyyander\/proofweave-open-catalog/i);

  const sharedResearch = await render("/about/shared-research");
  const sharedResearchHtml = await sharedResearch.text();
  assert.match(sharedResearchHtml, /One frontier map\. Many coordinated Agents/i);
  assert.match(sharedResearchHtml, /Read the shared state/i);

  const integrations = await render("/integrations");
  const integrationsHtml = await integrations.text();
  assert.match(integrationsHtml, /Install from a local marketplace once/i);
  assert.match(integrationsHtml, /Approve your local Codex once/i);
  assert.match(integrationsHtml, /No GitHub account or repository access is required/i);
  assert.match(integrationsHtml, /local install; no GitHub account required/i);
  assert.match(integrationsHtml, /shasum -a 256 -c proofweave-research-marketplace\.tar\.sha256/i);
  assert.match(integrationsHtml, /codex plugin marketplace add/i);
  assert.match(integrationsHtml, /Normal service updates/i);
  assert.match(integrationsHtml, /Continue this task/i);
  assert.match(integrationsHtml, /Published plugin update/i);
  assert.match(integrationsHtml, /Review checksum and commands/i);
  assert.match(integrationsHtml, /After an approved reinstall/i);
  assert.match(integrationsHtml, /Restart Codex/i);
  assert.match(integrationsHtml, /fixed same-origin distribution manifest/i);
  assert.match(integrationsHtml, /available update is advice only/i);
  assert.match(integrationsHtml, /ask again before reinstalling/i);
  assert.doesNotMatch(integrationsHtml, /GitHub repository access is currently required/i);
  assert.doesNotMatch(integrationsHtml, /marketplace add alexyyyander\/proofweave/i);
  assert.doesNotMatch(integrationsHtml, /https:\/\/mcp\.proofweave\.org\/mcp/i);

  const selectedIntegration = await render("/integrations?target=erdos-865-k2&return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher");
  const selectedIntegrationHtml = await selectedIntegration.text();
  assert.match(selectedIntegrationHtml, /Erdős Problem 865: k = 2 variant/i);
  assert.match(selectedIntegrationHtml, /Your target remains selected during connection/i);

  const selectedWorkbench = await render("/workbench?target=erdos-865-k2");
  const selectedWorkbenchHtml = await selectedWorkbench.text();
  assert.match(selectedWorkbenchHtml, /Erdős Problem 865: k = 2 variant/i);
  assert.match(selectedWorkbenchHtml, /exact target and source revision stay selected after sign-in/i);
});

test("uses Explore as the stable parent for public research work", async () => {
  for (const pathname of ["/receipts", "/reviews"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should respond with 200`);
    const html = await response.text();
    assert.match(html, /class="breadcrumb"><a href="\/explore">Explore<\/a>/i);
    assert.doesNotMatch(html, /<a href="\/explore">Research frontier<\/a>/i);
  }
});

test("keeps information hubs content-driven across viewport heights", async () => {
  const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  assert.match(
    globals,
    /\/\* Final cross-page density pass[\s\S]*?\.information-hub-hero \{ min-height: 0; padding-bottom: 48px; padding-top: 52px; \}/,
  );
  assert.match(
    globals,
    /@media \(max-width: 620px\)[\s\S]*?\.information-hub-hero \{ padding-bottom: 42px; padding-top: 48px; \}/,
  );
});

test("keeps the public directory separate from the personal workspace", async () => {
  const page = await render("/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Open Proofweave directory/i);
  assert.match(html, /Proofweave public directory/i);
  assert.match(html, /An open network for personally delegated formal mathematics research/i);
  assert.match(html, /href="\/explore"[^>]*>Explore<\/a>[\s\S]*href="\/reviews"[^>]*>Verify<\/a>[\s\S]*href="\/receipts"[^>]*>Contributions<\/a>[\s\S]*href="\/how-it-works"[^>]*>How it works<\/a>/i);
  assert.match(html, /Participate[\s\S]*Verification market[\s\S]*Contribution receipts/i);
  assert.match(html, /Learn[\s\S]*AI mathematics record[\s\S]*Proof journey[\s\S]*Executable verified demo/i);
  assert.match(html, /Trust[\s\S]*Design principles[\s\S]*Catalog standard/i);
  assert.doesNotMatch(html, /<strong>Workspace<\/strong>/i);
  assert.match(html, /href="\/workbench"[^>]*>Workspace<\/a>/i);
  assert.doesNotMatch(html, /aria-label="Footer navigation"/i);
});

test("publishes a sourced AI mathematics record without flattening evidence states", async () => {
  const response = await render("/history");
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(html, /one accelerating frontier/i);
  assert.match(html, /Follow the record across 2026/i);
  assert.match(html, /Clustered nodes show activity accelerating—not stronger evidence/i);
  assert.match(html, /role="tablist"/i);
  assert.match(html, /AI mathematics milestones from January to July 2026/i);
  assert.match(html, /role="tab"/i);
  assert.match(html, /aria-selected="true"/i);
  assert.match(html, /role="tabpanel"/i);
  assert.match(html, /Latest entry/i);
  assert.doesNotMatch(html, />\s*Live\s*</i);
  assert.match(html, /Erdős Problem #728/i);
  assert.match(html, /Erdős Problem #650/i);
  assert.match(html, /Erdős Problem #1196/i);
  assert.match(html, /planar unit-distance conjecture/i);
  assert.match(html, /AlphaProof Nexus scales the search/i);
  assert.match(html, /Cycle Double Cover Conjecture/i);
  assert.match(html, /GPT-5\.6 Sol Ultra \+ Codex/i);
  assert.match(html, /Lean kernel-checked artifact/i);
  assert.match(html, /github\.com\/openai\/cdc-lean/i);
  assert.match(html, /cdc_proof\.pdf/i);
  assert.match(html, /three-dimensional Jacobian counterexample is announced/i);
  assert.match(html, /det JF = −2/i);
  assert.match(html, /3 inputs → \(−¼, 0, 0\)/i);
  assert.match(html, /F₁ = \(1 \+ xy\)³z \+ y²\(1 \+ xy\)\(4 \+ 3xy\)/i);
  assert.match(html, /\(0, 0, −¼\), \(1, −3\/2, 13\/2\), and \(−1, 3\/2, 13\/2\)/i);
  assert.match(html, /Journal review and a formal Proofweave receipt are not yet recorded/i);
  assert.match(html, /two-dimensional Jacobian Conjecture remains open/i);
  assert.match(html, /arxiv\.org\/abs\/2601\.07421/i);
  assert.match(html, /openai\.com\/index\/model-disproves-discrete-geometry-conjecture/i);
  assert.match(html, /mathoverflow\.net\/questions\/130777/i);
  assert.doesNotMatch(html, /peer-reviewed Jacobian counterexample/i);
});

test("keeps public verification and contribution records outside personal workspace chrome", async () => {
  const headers = {
    "oai-authenticated-user-email": "public-boundary@example.test",
    "oai-authenticated-user-full-name": "Public%20Boundary",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };

  const reviews = await render("/reviews", { headers });
  assert.equal(reviews.status, 200);
  const reviewsHtml = await reviews.text();
  assert.match(reviewsHtml, /aria-label="Verification page"/i);
  assert.match(reviewsHtml, /id="open-review-work"/i);
  assert.match(reviewsHtml, /id="my-review-work"/i);
  assert.doesNotMatch(reviewsHtml, /aria-label="Personal workspace context"/i);

  const receipts = await render("/receipts", { headers });
  assert.equal(receipts.status, 200);
  const receiptsHtml = await receipts.text();
  assert.match(receiptsHtml, /aria-label="Contribution records"/i);
  assert.match(receiptsHtml, /id="receipt-index"/i);
  assert.doesNotMatch(receiptsHtml, /aria-label="Personal workspace context"/i);

  const profile = await render("/profile", { headers });
  assert.equal(profile.status, 200);
  assert.match(await profile.text(), /aria-label="Personal workspace context"/i);
});

test("records an attributed problem proposal without promoting it to a theorem or Credit", async () => {
  const headers = {
    "oai-authenticated-user-email": "proposer@example.test",
    "oai-authenticated-user-full-name": "Problem%20Proposer",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const anonymousPage = await render("/propose", { redirect: "manual" });
  assert.equal(anonymousPage.status, 307);
  assert.match(anonymousPage.headers.get("location") ?? "", /\/sign-in\?return_to=%2Fpropose/);

  const page = await render("/propose", { headers });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Bring a mathematical question into Proofweave/i);

  const input = {
    title: "A source-pinned test proposal",
    domain: "Combinatorics · MSC 05",
    informalStatement: "For every finite object satisfying the stated hypotheses, the proposed invariant is nonnegative.",
    motivation: "This tests the authenticated catalog intake and immutable proposal ledger without claiming a proof.",
    sourceUrl: "https://example.test/mathematics/source",
    idempotencyKey: "proposal-rendered-test-0001",
  };
  const created = await render("/api/me/problem-proposals", {
    method: "POST",
    headers: { ...headers, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(created.status, 201);
  const createdPayload = await created.json();
  assert.equal(createdPayload.proposal.status, "submitted");
  assert.equal(createdPayload.idempotentReplay, false);
  assert.match(createdPayload.note, /No mathematical claim or credit/i);

  const replayed = await render("/api/me/problem-proposals", {
    method: "POST",
    headers: { ...headers, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(replayed.status, 200);
  const replayedPayload = await replayed.json();
  assert.equal(replayedPayload.proposal.id, createdPayload.proposal.id);
  assert.equal(replayedPayload.idempotentReplay, true);

  const conflict = await render("/api/me/problem-proposals", {
    method: "POST",
    headers: { ...headers, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ ...input, title: "Different content with the same key" }),
  });
  assert.equal(conflict.status, 409);

  const listing = await render("/api/me/problem-proposals", { headers: { ...headers, accept: "application/json" } });
  assert.equal(listing.status, 200);
  const listingPayload = await listing.json();
  assert.equal(listingPayload.proposals.length, 1);
  assert.equal(listingPayload.proposals[0].id, createdPayload.proposal.id);
  assert.match(listingPayload.note, /not yet a public target/i);

  await assert.rejects(
    database.prepare("UPDATE problem_proposals SET title = ? WHERE id = ?").bind("mutated", createdPayload.proposal.id).run(),
    /problem proposals are immutable/i,
  );
});

test("presents the verified reference as a dedicated visual proof journey", async () => {
  const page = await render("/showcase");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /One theorem · six evidence moments/i);
  assert.match(html, /Private · this computer/i);
  assert.match(html, /Public · minimum evidence/i);
  assert.match(html, /Frontier question/i);
  assert.match(html, /Independent review/i);
  assert.match(html, /Contribution Receipt/i);
  assert.match(html, /Verify the complete chain/i);
  assert.match(html, /Inspect the executable demo/i);
});

test("uses a Google app session for the same stable Person and private account boundary", async () => {
  const email = "linked-google@example.test";
  const chatGPTHeaders = {
    "oai-authenticated-user-email": email,
    "oai-authenticated-user-full-name": "Linked%20Researcher",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const initial = await render("/api/me/delegation", { headers: chatGPTHeaders });
  assert.equal(initial.status, 200);
  const { profile: chatGPTProfile } = await initial.json();
  const token = "rendered-google-app-session";
  const now = "2026-07-16T00:00:00Z";
  await database.prepare(
    `INSERT INTO person_identities (
       id, person_id, provider, provider_subject, email, email_normalized,
       display_name, email_verified_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    "identity:rendered-google",
    chatGPTProfile.person.id,
    "google",
    "google-subject-rendered",
    email,
    email,
    "Linked Researcher",
    now,
    now,
  ).run();
  await database.prepare(
    `INSERT INTO app_sessions (
       id, person_id, identity_id, token_hash, expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    "session:rendered-google",
    chatGPTProfile.person.id,
    "identity:rendered-google",
    await sha256(token),
    "2099-07-16T00:00:00Z",
    now,
  ).run();

  const googleHeaders = { cookie: `__Host-pw_session=${encodeURIComponent(token)}` };
  const googleProfileResponse = await render("/api/me/delegation", { headers: googleHeaders });
  assert.equal(googleProfileResponse.status, 200);
  const { profile: googleProfile } = await googleProfileResponse.json();
  assert.equal(googleProfile.person.id, chatGPTProfile.person.id);

  const page = await render("/profile", { headers: googleHeaders });
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Google(?:<!-- -->)? account/i);
  assert.match(html, /linked-google@example\.test/i);
  assert.match(html, /Active Attempts/i);
  assert.match(html, /Pending Reviews/i);
  assert.match(html, /Staged Evidence/i);
  assert.match(html, new RegExp(chatGPTProfile.person.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("creates an isolated, rate-limited temporary Demo Person without an external account", async () => {
  const signIn = await render("/sign-in?return_to=%2Fprofile");
  assert.equal(signIn.status, 200);
  assert.match(await signIn.text(), /Continue with a temporary Demo Person/);

  const created = await render("/auth/demo/start", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "origin": "http://localhost",
      "cf-connecting-ip": "203.0.113.20",
    },
    body: "return_to=%2Fprofile",
    redirect: "manual",
  });
  assert.equal(created.status, 303);
  assert.equal(created.headers.get("location"), "http://localhost/profile");
  assert.equal(created.headers.get("cache-control"), "no-store");
  const cookie = created.headers.get("set-cookie")?.split(";", 1)[0];
  assert.match(cookie ?? "", /^__Host-pw_session=/);

  const profile = await render("/profile", { headers: { cookie } });
  assert.equal(profile.status, 200);
  const html = await profile.text();
  assert.match(html, /Build Week Test Person/);
  assert.match(html, /Authenticated as/);
  assert.match(html, /Demo/);
  assert.match(html, /explicitly demo-only/);

  const crossOrigin = await render("/auth/demo/start", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "origin": "https://attacker.example",
      "cf-connecting-ip": "203.0.113.21",
    },
    body: "return_to=%2Fprofile",
  });
  assert.equal(crossOrigin.status, 403);
});

test("keeps the public local-Agent pairing ingress bounded and rate limited", async () => {
  const payload = {
    agentId: "urn:pw:agent:public-pairing-test",
    agentLabel: "Public pairing test Agent",
    agentPublicKey: "a".repeat(43),
    oauthState: "public-pairing-state",
    codeChallenge: "b".repeat(43),
    connectionMode: "research",
  };
  const request = (address, body = JSON.stringify(payload), contentType = "application/json") => render("/api/connect/sessions", {
    method: "POST",
    headers: { "cf-connecting-ip": address, "content-type": contentType },
    body,
  });

  const unsupported = await request("203.0.113.10", "not-json", "text/plain");
  assert.equal(unsupported.status, 415);
  assert.equal(unsupported.headers.get("cache-control"), "no-store");

  const oversized = await request("203.0.113.11", JSON.stringify({ padding: "x".repeat(17_000) }));
  assert.equal(oversized.status, 413);

  const pairingUrls = [];
  for (let index = 0; index < 8; index += 1) {
    const accepted = await request("203.0.113.12", JSON.stringify({ ...payload, oauthState: `public-pairing-state-${index}` }));
    assert.equal(accepted.status, 201);
    assert.equal(accepted.headers.get("cache-control"), "no-store");
    const pairing = await accepted.json();
    assert.match(pairing.connectionUrl, /\/connect\/codex\?pairing=/);
    assert.equal(typeof pairing.clientId, "string");
    pairingUrls.push(new URL(pairing.connectionUrl));
  }
  const limited = await request("203.0.113.12");
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("retry-after") ?? "", /^\d+$/);

  const pendingPairing = pairingUrls[0];
  const pendingStatus = await render(`/api/connect/sessions/${encodeURIComponent(pendingPairing.searchParams.get("pairing"))}?secret=${encodeURIComponent(pendingPairing.searchParams.get("secret"))}`);
  assert.equal(pendingStatus.status, 200);
  assert.equal((await pendingStatus.json()).pairing.status, "pending");
  await database.prepare("UPDATE local_codex_pairing_sessions SET approved_at = ? WHERE id = ?")
    .bind("2026-07-20T00:00:00Z", pendingPairing.searchParams.get("pairing"))
    .run();
  const approvedStatus = await render(`/api/connect/sessions/${encodeURIComponent(pendingPairing.searchParams.get("pairing"))}?secret=${encodeURIComponent(pendingPairing.searchParams.get("secret"))}`);
  assert.equal(approvedStatus.status, 200);
  assert.equal((await approvedStatus.json()).pairing.status, "approved");

  const expiredPairing = pairingUrls[1];
  await database.prepare("UPDATE local_codex_pairing_sessions SET expires_at = ? WHERE id = ?")
    .bind("2020-01-01T00:00:00Z", expiredPairing.searchParams.get("pairing"))
    .run();
  const expiredStatus = await render(`/api/connect/sessions/${encodeURIComponent(expiredPairing.searchParams.get("pairing"))}?secret=${encodeURIComponent(expiredPairing.searchParams.get("secret"))}`);
  assert.equal(expiredStatus.status, 200);
  assert.equal((await expiredStatus.json()).pairing.status, "expired");

  const operationalRows = await database
    .prepare("SELECT bucket_key FROM remote_mcp_rate_limit_buckets WHERE bucket_key LIKE 'sha256:%'")
    .all();
  assert.ok(operationalRows.results.length >= 3);
  assert.doesNotMatch(JSON.stringify(operationalRows.results), /203\.0\.113|public-pairing-test/);
});

test("publicly verifies the checked Build Week reference evidence", async () => {
  const page = await render("/demo");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /All checks passed/i);
  assert.match(html, /Verified reference · no Proofweave setup required/i);
  assert.match(html, /Mock identity · real verification/i);
  assert.match(html, /Mock owners review/i);
  assert.match(html, /The reviewers are not human participants/i);
  assert.match(html, /Separate live protocol run/i);
  assert.match(html, /Reference only|Inspect verification boundary/i);
  assert.match(html, /This demo does not claim/i);
  assert.match(html, /Re-verify signed evidence/i);
  assert.match(html, /Tamper-test a copy/i);
  assert.match(html, /Inspect computed evidence/i);
  assert.match(html, /What this control does/i);
  assert.match(html, /Lean itself is not restarted/i);
  assert.match(html, /npm run demo:e2e:check/i);
  assert.match(html, /D1 inline · no R2/i);

  const tamperPage = await render("/demo?tamper=artifact");
  assert.equal(tamperPage.status, 200);
  const tamperHtml = await tamperPage.text();
  assert.match(tamperHtml, /Tamper detected as expected/i);
  assert.match(tamperHtml, /The signed original is unchanged/i);
  assert.match(tamperHtml, /Only a temporary request copy failed artifact integrity/i);

  const response = await render("/api/demo/verify");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const verification = await response.json();
  assert.equal(verification.status, "verified");
  assert.match(verification.verificationId, /^vrf_[a-f0-9]{12}$/);
  assert.equal(verification.protocolVersion, "pw-build-week-demo-v1");
  assert.equal(verification.mode, "reference");
  assert.equal(verification.executionBoundary.signedEvidenceReverified, true);
  assert.equal(verification.executionBoundary.leanReplay, "not_run_by_this_request");
  assert.equal(typeof verification.durationMs, "number");
  assert.equal(verification.checks.length, 6);
  assert.equal(verification.checks.every((check) => check.passed), true);
  assert.equal(verification.checks.every((check) => typeof check.method === "string" && typeof check.result === "string"), true);
  assert.match(verification.checks.find((check) => check.id === "runner").result, /Lean not rerun now/i);
  assert.equal(verification.journey.length, 5);
  assert.equal(verification.journey.every((stage) => stage.passed), true);
  assert.equal(verification.mockReviewer.mode, "mock_second_account");
  assert.equal(verification.mockReviewer.independentFromResearcher, true);
  assert.equal(verification.mockReviewer.signedClaimCount, 2);
  assert.equal(verification.creditPreview.status, "receipt_derived_preview_not_settled");
  assert.equal(verification.creditPreview.transferable, false);
  assert.match(verification.record.bundleHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(verification.record.receiptHash, /^sha256:[a-f0-9]{64}$/);
  assert.match(verification.disclosure, /not a live network contribution/i);
  assert.match(verification.disclosure, /labeled deterministic mock/i);

  const tamperedResponse = await render("/api/demo/verify?tamper=artifact");
  assert.equal(tamperedResponse.status, 200);
  assert.equal(tamperedResponse.headers.get("cache-control"), "no-store");
  const tampered = await tamperedResponse.json();
  assert.equal(tampered.mode, "tampered_copy");
  assert.equal(tampered.status, "failed");
  assert.equal(tampered.checks.find((check) => check.id === "objects").passed, false);
  assert.match(tampered.checks.find((check) => check.id === "objects").result, /does not match/i);
  assert.equal(tampered.checks.filter((check) => !check.passed).length, 1);
});

test("keeps keyboard users one action away from the main content on critical pages", async () => {
  for (const pathname of ["/", "/showcase", "/demo", "/history", "/explore", "/how-it-works", "/how-it-works/research", "/about", "/about/principles", "/workbench", "/integrations", "/evidence", "/reviews", "/receipts"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should render its keyboard navigation`);
    const html = await response.text();
    assert.match(html, /href="#main-content"[^>]*>Skip to main content/i, `${pathname} should include a skip link`);
    assert.match(html, /<main id="main-content" tabindex="-1"/i, `${pathname} should expose a focusable main landmark`);
    assert.equal((html.match(/id="main-content"/g) ?? []).length, 1, `${pathname} should have exactly one main-content landmark`);
  }
});

test("does not present a receipt preview as signed public evidence", async () => {
  const response = await render("/api/receipts/abc-l1");
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "not_found", message: "Contribution Receipt not found." },
  });
  const dependencies = await render("/api/receipts/abc-l1/dependencies");
  assert.equal(dependencies.status, 404);
  assert.deepEqual(await dependencies.json(), {
    error: { code: "not_found", message: "Contribution Receipt not found." },
  });
  const lifecycle = await render("/api/receipts/abc-l1/lifecycle");
  assert.equal(lifecycle.status, 404);
  assert.deepEqual(await lifecycle.json(), {
    error: { code: "not_found", message: "Contribution Receipt not found." },
  });
  const verificationBundle = await render("/api/receipts/abc-l1/verification-bundle");
  assert.equal(verificationBundle.status, 404);
  assert.deepEqual(await verificationBundle.json(), {
    error: { code: "not_found", message: "Contribution Receipt not found." },
  });
});

test("imports the pinned catalog idempotently and serves provenance through the API", async () => {
  await applyMigrations(database, true);

  const counts = await database
    .prepare(
      "SELECT (SELECT COUNT(*) FROM problem_revisions) AS problems, (SELECT COUNT(*) FROM verification_claims) AS claims, (SELECT COUNT(*) FROM catalog_imports) AS imports",
    )
    .first();
  assert.deepEqual(counts, { problems: 40, claims: 200, imports: 5 });

  const catalogResponse = await render("/api/catalog");
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.records.length, 40);
  assert.equal(catalog.records[0].slug, "erdos-865");
  assert.equal(catalog.records[0].source.revisionTag, "bench-v1-lean4.27.0");
  assert.equal(catalog.records[0].source.leanToolchain, "leanprover/lean4:v4.27.0");
  assert.equal(catalog.records[0].claims.length, 5);
  assert.equal(catalog.records[0].subjects[0].name, "Number theory");
  assert.equal(catalog.records[0].collections[0].title, "Founding Challenges");
  assert.ok(catalog.records[0].displayStatuses.includes("No Proofweave attestation"));

  const recordResponse = await render("/api/catalog/erdos-865");
  assert.equal(recordResponse.status, 200);
  const { record } = await recordResponse.json();
  assert.equal(record.declaration.qualifiedName, "Erdos865.erdos_865");
  assert.match(record.declaration.sourceContentHash, /^sha256:[a-f0-9]{64}$/);

  const jacobianAuditResponse = await render(
    "/api/catalog/jacobian-counterexample-algebraic-audit",
  );
  assert.equal(jacobianAuditResponse.status, 200);
  const { record: jacobianAudit } = await jacobianAuditResponse.json();
  assert.equal(
    jacobianAudit.declaration.qualifiedName,
    "ProofweaveJacobian.jacobian_counterexample_audit",
  );
  assert.equal(
    jacobianAudit.declaration.sourceContentHash,
    "sha256:05557171f31ff0beefccdfa346ac83069ec7b63c0ecf6997e895fd62bc29ee26",
  );

  const graphResponse = await render("/api/catalog/erdos-865/research-graph");
  assert.equal(graphResponse.status, 200);
  const graphPayload = await graphResponse.json();
  assert.equal(graphPayload.problem.slug, "erdos-865");
  assert.deepEqual(graphPayload.graph.nodes, []);
  assert.deepEqual(graphPayload.graph.edges, []);
  assert.deepEqual(graphPayload.graph.externalWorks, []);
  assert.match(graphPayload.note, /not Lean verification/i);

  const marketResponse = await render("/api/catalog/erdos-865/credit-market");
  assert.equal(marketResponse.status, 200);
  const marketPayload = await marketResponse.json();
  assert.equal(marketPayload.problem.slug, "erdos-865");
  assert.equal(marketPayload.market.policy.version, "pw-credit-market-v1");
  assert.equal(marketPayload.market.pool, null);
  assert.equal(marketPayload.market.policy.buckets.reduce((sum, bucket) => sum + bucket.basisPoints, 0), 10_000);
  assert.equal(marketPayload.market.policy.boundaries.computeSpendCreatesCredit, false);
  assert.equal(marketPayload.market.activity.sharedCheckpoints, 0);
  assert.match(marketPayload.note, /non-transferable, non-financial/i);

  const pilotMarketResponse = await render("/api/catalog/erdos-865-k2/credit-market");
  assert.equal(pilotMarketResponse.status, 200);
  const pilotMarketPayload = await pilotMarketResponse.json();
  assert.equal(pilotMarketPayload.market.pool.state, "active");
  assert.equal(pilotMarketPayload.market.pool.totalCredits, 10_000);
  assert.equal(pilotMarketPayload.market.pool.sponsorLabel, "Proofweave pilot");
  assert.deepEqual(
    pilotMarketPayload.market.policy.buckets.map((bucket) => bucket.credits),
    [3_000, 4_000, 2_000, 1_000],
  );

  const reviewJobsResponse = await render("/api/review-jobs");
  assert.equal(reviewJobsResponse.status, 200);
  const reviewJobsPayload = await reviewJobsResponse.json();
  assert.deepEqual(reviewJobsPayload.jobs, []);
  assert.match(reviewJobsPayload.note, /not reserved credits/i);

  const marketTables = await database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('problem_credit_pools','problem_credit_pool_events','verification_market_jobs','verification_market_job_claims','verification_market_job_events') ORDER BY name",
  ).all();
  assert.deepEqual((marketTables.results ?? []).map((row) => row.name), [
    "problem_credit_pool_events",
    "problem_credit_pools",
    "verification_market_job_claims",
    "verification_market_job_events",
    "verification_market_jobs",
  ]);
});

test("renders only a hash-checked, issuer-signed receipt from D1", async () => {
  const { receipt, receiptHash, upstreamReceipt, upstreamReceiptHash, smokeReceipt, lifecycleEvent } = await getSignedReceiptFixture();

  const response = await render(`/api/receipts/${receipt.id}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /immutable/i);
  assert.deepEqual(await response.json(), { receipt, receiptHash });

  const page = await render(`/receipt/${receipt.id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Reusable lemma/i);
  assert.match(html, new RegExp(receiptHash));
  assert.match(html, /Open verified JSON/i);
  assert.match(html, /Upstream evidence used by this contribution/i);
  assert.match(html, new RegExp(upstreamReceipt.target.declaration));
  assert.match(html, /Open dependency JSON/i);
  assert.match(html, /This receipt was retracted; the original evidence remains inspectable/i);
  assert.match(html, /Open lifecycle JSON/i);
  assert.match(html, /Download verification bundle/i);

  const index = await render("/api/receipts");
  assert.equal(index.status, 200);
  assert.match(index.headers.get("cache-control") ?? "", /max-age=120/i);
  assert.doesNotMatch(index.headers.get("cache-control") ?? "", /immutable/i);
  const indexBody = await index.json();
  assert.deepEqual(indexBody.receipts.map((entry) => [entry.id, entry.lifecycleStatus]), [
    [receipt.id, "retracted"],
    [upstreamReceipt.id, "issued"],
  ]);
  assert.doesNotMatch(JSON.stringify(indexBody), /ProofweaveCloudSmoke|cloud-smoke-fixture/i);
  const hiddenSmokeApi = await render(`/api/receipts/${smokeReceipt.id}`);
  assert.equal(hiddenSmokeApi.status, 404);
  const hiddenSmokePage = await render(`/receipt/${smokeReceipt.id}`);
  assert.equal(hiddenSmokePage.status, 200);
  const hiddenSmokeHtml = await hiddenSmokePage.text();
  assert.match(hiddenSmokeHtml, /Receipt not issued/i);
  assert.doesNotMatch(hiddenSmokeHtml, /ProofweaveCloudSmoke\.true_is_inhabited/i);
  const indexPage = await render("/receipts");
  assert.equal(indexPage.status, 200);
  const indexHtml = await indexPage.text();
  assert.match(indexHtml, /Verified contributions, not activity counts/i);
  assert.match(indexHtml, new RegExp(`/people/${encodeURIComponent(receipt.beneficiary.personId)}`));

  const personPage = await render(`/people/${encodeURIComponent(receipt.beneficiary.personId)}`);
  assert.equal(personPage.status, 200);
  const personHtml = await personPage.text();
  assert.match(personHtml, /Fixture owner/i);
  assert.match(personHtml, /Public mathematical contribution record/i);
  assert.match(personHtml, /Signed Contribution Receipts/i);
  assert.match(personHtml, new RegExp(receipt.target.declaration));
  assert.doesNotMatch(personHtml, /@example\.test|provider_subject|canonical_receipt/i);

  const issuerKeys = await render("/api/receipts/issuer-keys");
  assert.equal(issuerKeys.status, 200);
  assert.deepEqual(await issuerKeys.json(), {
    issuerKeys: [{
      id: receipt.issuerKeyId,
      publicKey: receipt.issuerPublicKey,
      status: "active",
      validFrom: upstreamReceipt.issuedAt,
      retiredAt: null,
      revokedAt: null,
    }],
  });

  const dependencies = await render(`/api/receipts/${receipt.id}/dependencies`);
  assert.equal(dependencies.status, 200);
  assert.match(dependencies.headers.get("cache-control") ?? "", /immutable/i);
  assert.deepEqual(await dependencies.json(), {
    receiptId: receipt.id,
    dependencies: [{
      receiptId: upstreamReceipt.id,
      receiptHash: upstreamReceiptHash,
      kind: upstreamReceipt.kind,
      target: upstreamReceipt.target,
      issuedAt: upstreamReceipt.issuedAt,
      recordedAt: receipt.issuedAt,
    }],
  });

  const lifecycle = await render(`/api/receipts/${receipt.id}/lifecycle`);
  assert.equal(lifecycle.status, 200);
  assert.match(lifecycle.headers.get("cache-control") ?? "", /immutable/i);
  assert.deepEqual(await lifecycle.json(), {
    receiptId: receipt.id,
    events: [lifecycleEvent],
  });

  const verificationBundle = await render(`/api/receipts/${receipt.id}/verification-bundle`);
  assert.equal(verificationBundle.status, 200);
  assert.match(verificationBundle.headers.get("content-type") ?? "", /^application\/json/i);
  assert.match(verificationBundle.headers.get("content-disposition") ?? "", /attachment/i);
  assert.doesNotMatch(verificationBundle.headers.get("cache-control") ?? "", /immutable/i);
  const downloadedBundle = await verificationBundle.json();
  assert.equal(downloadedBundle.rootReceiptId, receipt.id);
  assert.deepEqual(downloadedBundle.receipts.map((entry) => entry.receipt.id).sort(), [receipt.id, upstreamReceipt.id].sort());
  assert.equal((await verifyContributionReceiptVerificationBundle(downloadedBundle)).rootReceiptId, receipt.id);
  assert.equal(
    verificationBundle.headers.get("x-proofweave-verification-bundle-hash"),
    await contributionReceiptVerificationBundleHash(downloadedBundle),
  );
});

test("scopes closed-alpha review assignments to the assigned Person and preserves decisions", async () => {
  const { receipt } = await getSignedReceiptFixture();
  const reviewerHeaders = {
    "oai-authenticated-user-email": "reviewer@example.test",
    "oai-authenticated-user-full-name": "Review%20Person",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  const profileResponse = await render("/api/me/delegation", { headers: reviewerHeaders });
  assert.equal(profileResponse.status, 200);
  const { profile } = await profileResponse.json();

  await new D1VerificationStore(database).assign({
    id: "assignment:rendered-review",
    artifactBundleManifestHash: receipt.artifactBundleHash,
    claimType: "kernel_accepted",
    verifierPersonId: profile.person.id,
    assignedAt: "2026-07-13T00:00:00Z",
  });

  assert.equal((await render("/api/me/review-assignments")).status, 401);
  const listResponse = await render("/api/me/review-assignments", { headers: reviewerHeaders });
  assert.equal(listResponse.status, 200);
  const { assignments } = await listResponse.json();
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].id, "assignment:rendered-review");
  assert.equal(assignments[0].attempt.id, receipt.attempt.id);
  assert.doesNotMatch(JSON.stringify(assignments[0]), /person:fixture-owner|Fixture owner/i);

  const detailResponse = await render("/api/me/review-assignments/assignment:rendered-review", { headers: reviewerHeaders });
  assert.equal(detailResponse.status, 200);
  const { review: detail } = await detailResponse.json();
  assert.deepEqual(detail.events.map((event) => event.eventType), ["assignment_created"]);

  const page = await render("/reviews", { headers: reviewerHeaders });
  assert.equal(page.status, 200);
  const pageHtml = await page.text();
  assert.match(pageHtml, /Verify evidence\. Become eligible for review credit\./i);
  assert.match(pageHtml, /Open verification work/i);
  assert.match(pageHtml, /Open review workspace/i);
  assert.match(pageHtml, /Open account menu for Review Person/i);
  assert.match(pageHtml, />My profile/i);

  const reviewWorkspace = await render("/reviews/assignment:rendered-review", { headers: reviewerHeaders });
  assert.equal(reviewWorkspace.status, 200);
  const reviewWorkspaceHtml = await reviewWorkspace.text();
  assert.match(reviewWorkspaceHtml, /Accept this bounded review/i);
  assert.match(reviewWorkspaceHtml, /Evidence brief/i);
  assert.match(reviewWorkspaceHtml, /Immutable history/i);
  assert.match(reviewWorkspaceHtml, /Accept review/i);

  const signedOutWorkspace = await render("/reviews/assignment:rendered-review");
  assert.equal(signedOutWorkspace.status, 200);
  assert.match(await signedOutWorkspace.text(), /Sign in to open this review workspace/i);

  const profilePage = await render("/profile", { headers: reviewerHeaders });
  assert.equal(profilePage.status, 200);
  const profileHtml = await profilePage.text();
  assert.match(profileHtml, /Your research identity at a glance/i);
  assert.match(profileHtml, /Review Person/i);
  assert.match(profileHtml, /reviewer@example\.test/i);
  assert.match(profileHtml, new RegExp(profile.person.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(profileHtml, new RegExp(`/people/${encodeURIComponent(profile.person.id)}`));

  const acceptResponse = await render("/api/me/review-assignments/assignment:rendered-review/accept", {
    method: "POST",
    headers: reviewerHeaders,
  });
  assert.equal(acceptResponse.status, 200);
  const { review: accepted } = await acceptResponse.json();
  assert.equal(accepted.assignment.status, "accepted");
  assert.deepEqual(accepted.events.map((event) => event.eventType), ["assignment_created", "assignment_accepted"]);

  const repeatedAccept = await render("/api/me/review-assignments/assignment:rendered-review/accept", {
    method: "POST",
    headers: reviewerHeaders,
  });
  assert.equal(repeatedAccept.status, 200);
  assert.equal((await repeatedAccept.json()).review.assignment.status, "accepted");

  const acceptedWorkspace = await render("/reviews/assignment:rendered-review", { headers: reviewerHeaders });
  assert.equal(acceptedWorkspace.status, 200);
  assert.match(await acceptedWorkspace.text(), /Connect a review-scoped Agent/i);

  const declineAfterAccept = await render("/api/me/review-assignments/assignment:rendered-review/decline", {
    method: "POST",
    headers: reviewerHeaders,
  });
  assert.equal(declineAfterAccept.status, 409);

  const signedDecision = await completeRenderedReviewWithRequestChanges({
    assignmentId: "assignment:rendered-review",
    personId: profile.person.id,
    artifactBundleHash: receipt.artifactBundleHash,
  });
  const completedResponse = await render("/api/me/review-assignments/assignment:rendered-review", { headers: reviewerHeaders });
  assert.equal(completedResponse.status, 200);
  const { review: completed } = await completedResponse.json();
  assert.equal(completed.assignment.status, "completed");
  assert.deepEqual(completed.assignment.attestation, signedDecision);
  assert.deepEqual(completed.events.map((event) => event.eventType), [
    "assignment_created",
    "assignment_accepted",
    "attestation_recorded",
  ]);
  const completedPage = await render("/reviews", { headers: reviewerHeaders });
  assert.equal(completedPage.status, 200);
  const completedHtml = await completedPage.text();
  assert.match(completedHtml, /Changes requested/i);
  assert.match(completedHtml, /Inspect review record/i);

  const completedWorkspace = await render("/reviews/assignment:rendered-review", { headers: reviewerHeaders });
  assert.equal(completedWorkspace.status, 200);
  const completedWorkspaceHtml = await completedWorkspace.text();
  assert.match(completedWorkspaceHtml, /Signed decision recorded/i);
  assert.match(completedWorkspaceHtml, /Changes requested/i);
  assert.match(completedWorkspaceHtml, new RegExp(signedDecision.evidenceHash.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const otherPersonHeaders = {
    "oai-authenticated-user-email": "other-reviewer@example.test",
  };
  const hiddenFromOtherPerson = await render("/api/me/review-assignments/assignment:rendered-review", { headers: otherPersonHeaders });
  assert.equal(hiddenFromOtherPerson.status, 404);
  const hiddenWorkspace = await render("/reviews/assignment:rendered-review", { headers: otherPersonHeaders });
  assert.equal(hiddenWorkspace.status, 404);
});

async function completeRenderedReviewWithRequestChanges({ assignmentId, personId, artifactBundleHash }) {
  const agentId = "agent:rendered-review-decision";
  const personKeyId = "person-key:rendered-review-decision";
  const delegationId = "delegation:rendered-review-decision";
  const attestationId = "attestation:rendered-review-request-changes";
  const evidenceHash = await sha256Bytes(new TextEncoder().encode("request changes evidence fixture"));
  const eventPayloadHash = await sha256Bytes(new TextEncoder().encode("request changes event fixture"));
  const publicKey = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const attestedAt = "2026-07-13T00:00:02Z";
  const objectKey = `bundles/sha256/${evidenceHash.slice("sha256:".length)}/request-changes.txt`;
  await database.batch([
    database.prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
      .bind(evidenceHash, objectKey, 32, "text/plain"),
    database.prepare("INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)")
      .bind(personKeyId, personId, publicKey, await sha256Bytes(new TextEncoder().encode(personKeyId))),
    database.prepare("INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)")
      .bind(agentId, personId, "Rendered review Agent", publicKey, await sha256Bytes(new TextEncoder().encode(agentId))),
    database.prepare(`INSERT INTO delegation_certificates (
      id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json,
      valid_from, valid_until, beneficiary_person_id, protocol_version,
      payload_hash, canonical_payload, person_signature
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        delegationId, personId, agentId, personKeyId, publicKey, '["review"]',
        "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", personId,
        "pw-delegation-v1", await sha256Bytes(new TextEncoder().encode(delegationId)), "{}", "fixture-signature",
      ),
    database.prepare(`INSERT INTO verification_attestations (
      id, assignment_id, artifact_bundle_manifest_hash, claim_type,
      verifier_person_id, verifier_agent_id, delegation_certificate_id,
      verifier_agent_public_key, decision, evidence_hash, canonical_payload,
      payload_hash, signature, attested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        attestationId, assignmentId, artifactBundleHash, "kernel_accepted",
        personId, agentId, delegationId, publicKey, "request_changes", evidenceHash,
        '{"decision":"request_changes"}', await sha256Bytes(new TextEncoder().encode(attestationId)), "fixture-signature", attestedAt,
      ),
    database.prepare("UPDATE verification_assignments SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .bind("completed", attestedAt, attestedAt, assignmentId),
    database.prepare(`INSERT INTO verification_assignment_events (
      id, assignment_id, sequence, event_type, status, payload_hash, canonical_payload, occurred_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        "verification-event:rendered-review:request-changes", assignmentId, 3,
        "attestation_recorded", "completed", eventPayloadHash,
        '{"decision":"request_changes"}', attestedAt,
      ),
  ]);
  return { id: attestationId, decision: "request_changes", evidenceHash, attestedAt };
}

test("limits Bundle and Runner evidence to the Attempt owner or assigned reviewer", async () => {
  const fixture = await getControlledEvidenceFixture();
  assert.equal((await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`)).status, 401);

  const ownerRecord = await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`, { headers: fixture.ownerHeaders });
  assert.equal(ownerRecord.status, 200);
  assert.match(ownerRecord.headers.get("cache-control") ?? "", /private, no-store/i);
  const { evidence: ownerEvidence } = await ownerRecord.json();
  assert.equal(ownerEvidence.summary.accessRole, "attempt_owner");
  assert.equal(ownerEvidence.bundle.manifestHash, fixture.manifestHash);
  assert.deepEqual(ownerEvidence.bundle.review, {
    target: { declaration: "Proofweave.Evidence.target", statementHash: `sha256:${"a".repeat(64)}` },
    environment: { leanToolchain: "leanprover/lean4:v4.27.0", mathlibRevision: "fixture-evidence" },
    entryCommand: ["lake", "env", "lean", "Proofweave/Evidence.lean"],
    policy: { requireNoSorry: true, allowedAxioms: [] },
  });
  assert.deepEqual(ownerEvidence.bundle.artifacts.map((artifact) => artifact.id), ["bundle-manifest", "sourceArchive", "sourcePatch", "lakeManifest"]);
  assert.deepEqual(ownerEvidence.runs[0].outputs.map((artifact) => artifact.id), [
    "run:run:controlled-evidence:stderr",
    "run:run:controlled-evidence:stdout",
  ]);
  assert.equal(ownerEvidence.replays.length, 0);
  assert.deepEqual(ownerEvidence.reviewOutcomes, [{
    assignmentId: "assignment:controlled-evidence",
    claimType: "kernel_accepted",
    decision: "integrity_flagged",
    evidenceHash: fixture.integrityFlagEvidenceHash,
    attestedAt: "2026-07-13T02:00:00Z",
  }]);
  assert.doesNotMatch(JSON.stringify(ownerEvidence), new RegExp(fixture.owner.person.id));

  const ownerWorkbenchRunsResponse = await render("/api/me/attempts", { headers: fixture.ownerHeaders });
  assert.equal(ownerWorkbenchRunsResponse.status, 200);
  const { runs: ownerWorkbenchRuns } = await ownerWorkbenchRunsResponse.json();
  assert.equal(ownerWorkbenchRuns.some((run) => run.id === "run:controlled-evidence"), true);
  assert.equal(ownerWorkbenchRuns.some((run) => run.id === "run:controlled-fresh-replay"), false);

  const ownerIndex = await render("/evidence", { headers: fixture.ownerHeaders });
  assert.equal(ownerIndex.status, 200);
  assert.match(await ownerIndex.text(), /Your Attempt/i);
  const ownerPage = await render(`/evidence/${encodeURIComponent(fixture.manifestHash)}`, { headers: fixture.ownerHeaders });
  assert.equal(ownerPage.status, 200);
  const ownerHtml = await ownerPage.text();
  assert.match(ownerHtml, /Independent review outcomes/i);
  assert.match(ownerHtml, /Send this exact Bundle to independent review/i);
  assert.match(ownerHtml, /Integrity flag/i);
  assert.doesNotMatch(ownerHtml, /Controlled evidence reviewer/i);

  const reviewerSubmit = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/submit-review`,
    { method: "POST", headers: fixture.reviewerHeaders },
  );
  assert.equal(reviewerSubmit.status, 403);
  const ownerSubmit = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/submit-review`,
    { method: "POST", headers: fixture.ownerHeaders },
  );
  assert.equal(ownerSubmit.status, 200);
  assert.match(ownerSubmit.headers.get("cache-control") ?? "", /private, no-store/i);
  const ownerSubmitPayload = await ownerSubmit.json();
  assert.equal(ownerSubmitPayload.reviewMarket.published, true);
  assert.deepEqual(ownerSubmitPayload.reviewMarket.status, {
    totalJobs: 5,
    openJobs: 5,
    claimedJobs: 0,
    completedJobs: 0,
    jobs: [
      { claimType: "bundle_reproducible", rewardWeight: 1, state: "open" },
      { claimType: "kernel_accepted", rewardWeight: 2, state: "open" },
      { claimType: "novelty_reviewed", rewardWeight: 2, state: "open" },
      { claimType: "project_accepted", rewardWeight: 2, state: "open" },
      { claimType: "statement_faithful", rewardWeight: 2, state: "open" },
    ],
  });
  const ownerSubmitAgain = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/submit-review`,
    { method: "POST", headers: fixture.ownerHeaders },
  );
  assert.equal(ownerSubmitAgain.status, 200);
  assert.equal((await ownerSubmitAgain.json()).reviewMarket.status.totalJobs, 5);
  const ownerPublishedPage = await render(`/evidence/${encodeURIComponent(fixture.manifestHash)}`, { headers: fixture.ownerHeaders });
  const ownerPublishedHtml = await ownerPublishedPage.text();
  assert.match(ownerPublishedHtml, /Independent review work is open/i);
  assert.match(ownerPublishedHtml, /5(?:<!-- -->)? jobs/i);

  const ownerPatch = await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/sourcePatch`, { headers: fixture.ownerHeaders });
  assert.equal(ownerPatch.status, 200);
  assert.match(ownerPatch.headers.get("content-disposition") ?? "", /normalized\.patch/i);
  assert.match(ownerPatch.headers.get("cache-control") ?? "", /private, no-store/i);
  assert.equal(await ownerPatch.text(), "--- a/Proofweave/Evidence.lean\n+++ b/Proofweave/Evidence.lean\n");

  const reviewerRecord = await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`, { headers: fixture.reviewerHeaders });
  assert.equal(reviewerRecord.status, 200);
  const { evidence: reviewerEvidence } = await reviewerRecord.json();
  assert.equal(reviewerEvidence.summary.accessRole, "assigned_reviewer");
  assert.equal(reviewerEvidence.replays.length, 1);
  assert.deepEqual(reviewerEvidence.reviewOutcomes, []);
  assert.equal(reviewerEvidence.replays[0].evidenceHash, fixture.replayEvidenceHash);
  assert.equal(reviewerEvidence.replays[0].artifact.id, fixture.replayArtifactId);
  const freshRunnerResult = reviewerEvidence.runs.find((run) => run.id === "run:controlled-fresh-replay")?.result?.summary;
  assert.deepEqual(freshRunnerResult, {
    status: "succeeded",
    exitCode: 0,
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
  });
  assert.doesNotMatch(JSON.stringify(reviewerEvidence), new RegExp(fixture.owner.person.id));
  assert.doesNotMatch(JSON.stringify(reviewerEvidence), /Evidence Owner/i);
  const reviewerIndex = await render("/evidence", { headers: fixture.reviewerHeaders });
  assert.equal(reviewerIndex.status, 200);
  const reviewerIndexHtml = await reviewerIndex.text();
  assert.match(reviewerIndexHtml, /Assigned independent review/i);
  assert.doesNotMatch(reviewerIndexHtml, /Evidence Owner/i);
  const reviewerLog = await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/${encodeURIComponent("run:run:controlled-evidence:stdout")}`, { headers: fixture.reviewerHeaders });
  assert.equal(reviewerLog.status, 200);
  assert.equal(await reviewerLog.text(), "kernel accepted\n");

  const reviewerReplayEvidence = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/${encodeURIComponent(fixture.replayArtifactId)}`,
    { headers: fixture.reviewerHeaders },
  );
  assert.equal(reviewerReplayEvidence.status, 200);
  assert.match(reviewerReplayEvidence.headers.get("content-disposition") ?? "", /verification-replay-evidence\.json/i);
  assert.match(await reviewerReplayEvidence.text(), /pw-verification-replay-evidence-v1/);
  const ownerReplayEvidence = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/${encodeURIComponent(fixture.replayArtifactId)}`,
    { headers: fixture.ownerHeaders },
  );
  assert.equal(ownerReplayEvidence.status, 404);

  const reviewerPage = await render(`/evidence/${encodeURIComponent(fixture.manifestHash)}`, { headers: fixture.reviewerHeaders });
  assert.equal(reviewerPage.status, 200);
  const reviewerHtml = await reviewerPage.text();
  assert.match(reviewerHtml, /Assigned review · controlled evidence/i);
  assert.match(reviewerHtml, /Downloading an object does not perform a fresh runner replay/i);
  assert.match(reviewerHtml, /Fresh review replay evidence/i);
  assert.match(reviewerHtml, /Terminal replay recorded/i);
  assert.match(reviewerHtml, /Review facts/i);
  assert.match(reviewerHtml, /Preview source diff/i);
  assert.match(reviewerHtml, /Lean toolchain/i);
  assert.match(reviewerHtml, /Build status/i);
  assert.match(reviewerHtml, /Kernel/i);
  assert.doesNotMatch(reviewerHtml, /Independent review outcomes/i);
  assert.doesNotMatch(reviewerHtml, new RegExp(fixture.owner.person.id));
  assert.doesNotMatch(reviewerHtml, /Evidence Owner/i);

  const otherHeaders = { "oai-authenticated-user-email": "evidence-other@example.test" };
  assert.equal((await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`, { headers: otherHeaders })).status, 404);
  assert.equal((await render(`/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/sourcePatch`, { headers: otherHeaders })).status, 404);
});

test("scopes Runs, outputs, and review eligibility to one Bundle within a shared Attempt", async () => {
  const fixture = await getControlledEvidenceFixture();
  const acceptedResponse = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}`,
    { headers: fixture.ownerHeaders },
  );
  assert.equal(acceptedResponse.status, 200);
  const { evidence: acceptedEvidence } = await acceptedResponse.json();
  assert.deepEqual(
    acceptedEvidence.runs.map((run) => run.id),
    ["run:controlled-evidence", "run:controlled-fresh-replay"],
  );
  assert.equal(
    acceptedEvidence.runs.some((run) => run.id === "run:controlled-evidence-rejected"),
    false,
  );

  const rejectedResponse = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.rejectedManifestHash)}`,
    { headers: fixture.ownerHeaders },
  );
  assert.equal(rejectedResponse.status, 200);
  const { evidence: rejectedEvidence } = await rejectedResponse.json();
  assert.equal(rejectedEvidence.summary.attemptId, fixture.attemptId);
  assert.equal(rejectedEvidence.summary.artifactBundleManifestHash, fixture.rejectedManifestHash);
  assert.equal(rejectedEvidence.summary.latestRunState, "failed");
  assert.deepEqual(rejectedEvidence.runs.map((run) => run.id), ["run:controlled-evidence-rejected"]);
  assert.deepEqual(
    rejectedEvidence.runs[0].outputs.map((artifact) => artifact.id),
    [fixture.rejectedOutputArtifactId],
  );
  assert.equal(rejectedEvidence.runs[0].result, null);
  assert.doesNotMatch(JSON.stringify(rejectedEvidence), /run:controlled-fresh-replay/);

  const rejectedOutput = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.rejectedManifestHash)}/artifacts/${encodeURIComponent(fixture.rejectedOutputArtifactId)}`,
    { headers: fixture.ownerHeaders },
  );
  assert.equal(rejectedOutput.status, 200);
  assert.equal(await rejectedOutput.text(), "bundle B rejected\n");
  assert.equal(
    (await render(
      `/api/me/evidence/bundles/${encodeURIComponent(fixture.manifestHash)}/artifacts/${encodeURIComponent(fixture.rejectedOutputArtifactId)}`,
      { headers: fixture.ownerHeaders },
    )).status,
    404,
  );
  assert.equal(
    (await render(
      `/api/me/evidence/bundles/${encodeURIComponent(fixture.rejectedManifestHash)}/artifacts/${encodeURIComponent("run:run:controlled-evidence:stdout")}`,
      { headers: fixture.ownerHeaders },
    )).status,
    404,
  );

  const rejectedPage = await render(
    `/evidence/${encodeURIComponent(fixture.rejectedManifestHash)}`,
    { headers: fixture.ownerHeaders },
  );
  assert.equal(rejectedPage.status, 200);
  const rejectedHtml = await rejectedPage.text();
  assert.match(rejectedHtml, /Finish the isolated Lean gate first/i);
  assert.match(rejectedHtml, /Awaiting Lean acceptance/i);
  assert.doesNotMatch(rejectedHtml, /Send this exact Bundle to independent review/i);

  const rejectedSubmit = await render(
    `/api/me/evidence/bundles/${encodeURIComponent(fixture.rejectedManifestHash)}/submit-review`,
    { method: "POST", headers: fixture.ownerHeaders },
  );
  assert.equal(rejectedSubmit.status, 409);
  assert.equal((await rejectedSubmit.json()).error.code, "lean_not_accepted");

  const ownerIndex = await render("/evidence", { headers: fixture.ownerHeaders });
  assert.equal(ownerIndex.status, 200);
  const indexCards = (await ownerIndex.text()).split('<article class="evidence-index-card">').slice(1);
  const acceptedCard = indexCards.find((card) => card.includes(fixture.manifestHash));
  const rejectedCard = indexCards.find((card) => card.includes(fixture.rejectedManifestHash));
  assert.ok(acceptedCard);
  assert.ok(rejectedCard);
  assert.match(acceptedCard, />succeeded</i);
  assert.match(rejectedCard, />failed</i);
});

test("serves a privacy-minimal, signature-checked public delegation record", async () => {
  const fixture = await insertPublicDelegationFixture();

  const response = await render(`/api/delegations/${fixture.certificate.id}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /max-age=300/i);
  assert.doesNotMatch(response.headers.get("cache-control") ?? "", /immutable/i);
  const { delegation } = await response.json();
  assert.equal(delegation.protocolVersion, "pw-delegation-v1");
  assert.deepEqual(delegation.certificate, { ...fixture.certificate, scopes: ["formalize", "prove"] });
  assert.equal(delegation.signer.publicKey, fixture.ownerPublicKey);
  assert.equal(delegation.evidence.payloadHash, fixture.payloadHash);
  assert.equal(delegation.evidence.canonicalPayload, fixture.canonicalPayload);
  assert.equal(delegation.evidence.personSignature, fixture.personSignature);
  assert.equal(delegation.revocation, null);
  assert.doesNotMatch(JSON.stringify(delegation), /Private fixture (display name|agent label)/i);

  const page = await render(`/delegations/${fixture.certificate.id}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Delegation certificate/i);
  assert.match(html, /Open delegation JSON/i);
  assert.doesNotMatch(html, /Private fixture (display name|agent label)/i);

  await database
    .prepare("INSERT INTO delegation_revocations (id, delegation_certificate_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "delegation-revocation:public-fixture",
      fixture.certificate.id,
      fixture.certificate.ownerPersonId,
      "2026-07-13T12:00:00Z",
      "Agent key rotated.",
    )
    .run();
  const revoked = await render(`/api/delegations/${fixture.certificate.id}`);
  assert.deepEqual((await revoked.json()).delegation.revocation, {
    revokedAt: "2026-07-13T12:00:00Z",
    reason: "Agent key rotated.",
  });
  const revokedPage = await render(`/delegations/${fixture.certificate.id}`);
  assert.match(await revokedPage.text(), /Recorded revocation/i);

  await database
    .prepare("INSERT INTO person_key_revocations (id, person_key_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "person-key-revocation:public-fixture",
      "person-key:public-delegation",
      fixture.certificate.ownerPersonId,
      "2026-07-13T13:00:00Z",
      "Device replaced.",
    )
    .run();
  const signerKeyRevoked = await render(`/api/delegations/${fixture.certificate.id}`);
  assert.deepEqual((await signerKeyRevoked.json()).delegation.signer.keyRevocation, {
    revokedAt: "2026-07-13T13:00:00Z",
    reason: "Device replaced.",
  });
  const signerKeyRevokedPage = await render(`/delegations/${fixture.certificate.id}`);
  assert.match(await signerKeyRevokedPage.text(), /Signer key revocation/i);
});

test("retires static MCP tokens before moving to remote OAuth", async () => {
  const tokenResponse = await render("/api/v1/mcp/tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Deprecated local bridge" }),
  });
  assert.equal(tokenResponse.status, 410);
  const tokenBody = await tokenResponse.json();
  assert.equal(tokenBody.error.code, "precondition_failed");
  assert.match(tokenBody.error.message, /remote OAuth MCP gateway/i);

  const activeTokens = await database
    .prepare("SELECT COUNT(*) AS count FROM mcp_access_tokens WHERE revoked_at IS NULL")
    .first();
  assert.equal(activeTokens.count, 0);
  assert.equal((await render("/api/v1/mcp/problems")).status, 401);
});

test("persists immutable delegated-agent attribution records", async () => {
  const tables = await database
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('person_keys', 'person_key_proof_challenges', 'person_key_proof_events', 'person_key_revocations', 'agents', 'delegation_certificates', 'delegation_revocations') ORDER BY name",
    )
    .all();
  assert.deepEqual(
    tables.results.map((row) => row.name),
    ["agents", "delegation_certificates", "delegation_revocations", "person_key_proof_challenges", "person_key_proof_events", "person_key_revocations", "person_keys"],
  );

  const now = "2026-07-13T00:00:00Z";
  await database
    .prepare(
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind("person:delegation-test", "proofweave", "delegation-test", "Delegation Test", now)
    .run();
  await database
    .prepare(
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
    )
    .bind("person-key:delegation-test", "person:delegation-test", "person-key", "sha256:person-key")
    .run();
  await database
    .prepare(
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
    )
    .bind("agent:delegation-test", "person:delegation-test", "test-agent", "agent-key", "sha256:agent-key")
    .run();
  await database
    .prepare(
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key,
        scopes_json, valid_from, valid_until, beneficiary_person_id,
        protocol_version, payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "delegation:immutable-test",
      "person:delegation-test",
      "agent:delegation-test",
      "person-key:delegation-test",
      "agent-key",
      '["formalize"]',
      now,
      "2027-07-13T00:00:00Z",
      "person:delegation-test",
      "pw-delegation-v1",
      "sha256:delegation-test",
      "{}",
      "signature",
    )
    .run();
  await assert.rejects(
    database
      .prepare("UPDATE delegation_certificates SET valid_until = ? WHERE id = ?")
      .bind("2028-07-13T00:00:00Z", "delegation:immutable-test")
      .run(),
    /delegation certificates are immutable/,
  );
  await assert.rejects(
    database
      .prepare("UPDATE agents SET owner_person_id = ? WHERE id = ?")
      .bind("person:catalog-test", "agent:delegation-test")
      .run(),
    /agent owner cannot be changed/,
  );

  await database
    .prepare(
      "INSERT INTO delegation_revocations (id, delegation_certificate_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(
      "delegation-revocation:immutable-test",
      "delegation:immutable-test",
      "person:delegation-test",
      "2026-08-01T00:00:00Z",
      "Owner requested revocation.",
    )
    .run();
  await assert.rejects(
    database
      .prepare("UPDATE delegation_revocations SET reason = ? WHERE id = ?")
      .bind("changed", "delegation-revocation:immutable-test")
      .run(),
    /delegation revocations are immutable/,
  );
  await database
    .prepare("INSERT INTO person_key_revocations (id, person_key_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)")
    .bind(
      "person-key-revocation:immutable-test",
      "person-key:delegation-test",
      "person:delegation-test",
      "2026-08-01T00:00:00Z",
      "Device replaced.",
    )
    .run();
  await assert.rejects(
    database
      .prepare("UPDATE person_key_revocations SET reason = ? WHERE id = ?")
      .bind("changed", "person-key-revocation:immutable-test")
      .run(),
    /person key revocations are immutable/,
  );
});

test("registers, signs, and revokes a Person-owned Agent delegation through authenticated APIs", async () => {
  const authHeaders = {
    "oai-authenticated-user-email": "delegation-owner@example.test",
    "oai-authenticated-user-full-name": "Delegation%20Owner",
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  };
  assert.equal((await render("/api/me/delegation")).status, 401);

  const profileResponse = await render("/api/me/delegation", { headers: authHeaders });
  assert.equal(profileResponse.status, 200);
  const { profile } = await profileResponse.json();
  assert.equal(profile.person.displayName, "Delegation Owner");

  const ownerKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const ownerPublicKey = base64Url(await crypto.subtle.exportKey("raw", ownerKeys.publicKey));
  const keyResponse = await render("/api/me/keys", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ publicKey: ownerPublicKey }),
  });
  assert.equal(keyResponse.status, 201);
  const { key } = await keyResponse.json();
  assert.equal(key.possessionVerifiedAt, null);

  const challengeResponse = await render(`/api/me/keys/${encodeURIComponent(key.id)}/proof-challenge`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(challengeResponse.status, 201);
  const { challenge } = await challengeResponse.json();
  assert.equal(challenge.personKeyId, key.id);
  assert.equal(challenge.personPublicKey, ownerPublicKey);
  assert.equal(Date.parse(challenge.expiresAt) > Date.parse(challenge.issuedAt), true);

  const invalidProofResponse = await render(`/api/me/keys/${encodeURIComponent(key.id)}/proof`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      challengeId: challenge.id,
      personSignature: base64Url(crypto.getRandomValues(new Uint8Array(64))),
    }),
  });
  assert.equal(invalidProofResponse.status, 403);

  const agentPublicKey = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const agentResponse = await render("/api/me/agents", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      agentId: "urn:pw:agent:delegation-test",
      label: "Delegation test agent",
      publicKey: agentPublicKey,
    }),
  });
  assert.equal(agentResponse.status, 201);

  const certificate = {
    id: "pw:delegation:api-test",
    ownerPersonId: profile.person.id,
    agentId: "urn:pw:agent:delegation-test",
    agentPublicKey,
    scopes: ["formalize", "prove"],
    validFrom: "2026-07-13T00:00:00Z",
    validUntil: "2027-07-13T00:00:00Z",
    attributionPolicy: {
      beneficiaryPersonId: profile.person.id,
      mode: "agent_delegated",
    },
  };
  const signature = base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      ownerKeys.privateKey,
      new TextEncoder().encode(canonicalJson(delegationSigningPayload(certificate))),
    ),
  );
  const missingProofResponse = await render("/api/me/delegations", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ personKeyId: key.id, certificate, personSignature: signature }),
  });
  assert.equal(missingProofResponse.status, 403);
  assert.match((await missingProofResponse.json()).error.message, /Verify possession/i);

  const proofSignature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    ownerKeys.privateKey,
    new TextEncoder().encode(canonicalJson(personKeyProofChallengeSigningPayload(challenge))),
  ));
  const proofResponse = await render(`/api/me/keys/${encodeURIComponent(key.id)}/proof`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.id, personSignature: proofSignature }),
  });
  assert.equal(proofResponse.status, 201);
  const { proof } = await proofResponse.json();
  assert.equal(proof.personKeyId, key.id);

  const repeatedProof = await render(`/api/me/keys/${encodeURIComponent(key.id)}/proof`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ challengeId: challenge.id, personSignature: proofSignature }),
  });
  assert.equal(repeatedProof.status, 200);
  assert.equal((await repeatedProof.json()).idempotentReplay, true);

  const verifiedProfileResponse = await render("/api/me/delegation", { headers: authHeaders });
  const { profile: verifiedProfile } = await verifiedProfileResponse.json();
  assert.equal(verifiedProfile.signingKeys.find((candidate) => candidate.id === key.id).possessionVerifiedAt.length > 0, true);

  const delegationResponse = await render("/api/me/delegations", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      personKeyId: key.id,
      certificate,
      personSignature: signature,
    }),
  });
  assert.equal(delegationResponse.status, 201);
  const { delegation } = await delegationResponse.json();
  assert.equal(delegation.revokedAt, null);
  assert.deepEqual(delegation.scopes, ["formalize", "prove"]);

  // Static token issuance is retired in production. This direct fixture models
  // an already-authenticated control-plane principal so the Attempt repository
  // can prove it binds the persisted delegation rather than an Agent label.
  const testToken = "pw_mcp_delegation_integration_test";
  await database
    .prepare(
      "INSERT INTO mcp_access_tokens (id, person_id, name, token_hash, token_prefix, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      "mcp-token:delegation-integration-test",
      profile.person.id,
      "Integration fixture",
      await sha256(testToken),
      "pw_mcp_delegation",
      "2027-07-13T00:00:00Z",
    )
    .run();
  const attemptResponse = await render("/api/v1/mcp/attempts", {
    method: "POST",
    headers: { authorization: `Bearer ${testToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      problemSlug: "erdos-865-upper-bound",
      agentId: "urn:pw:agent:delegation-test",
      agentLabel: "Delegation test agent",
      delegationCertificateId: certificate.id,
      delegationScope: "prove",
      idempotencyKey: "delegation-attempt-1",
    }),
  });
  assert.equal(attemptResponse.status, 201);
  const { attempt } = await attemptResponse.json();
  assert.equal(attempt.agentId, "urn:pw:agent:delegation-test");
  assert.equal(attempt.delegationCertificateId, certificate.id);
  assert.equal(attempt.delegationScope, "prove");

  const ownerAttemptResponse = await render("/api/me/attempts", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      problemSlug: "erdos-865",
      delegationCertificateId: certificate.id,
      delegationScope: "formalize",
      idempotencyKey: "owner-opened-attempt-1",
    }),
  });
  assert.equal(ownerAttemptResponse.status, 201);
  const { attempt: ownerAttempt, note: ownerAttemptNote } = await ownerAttemptResponse.json();
  assert.equal(ownerAttempt.agentId, "urn:pw:agent:delegation-test");
  assert.equal(ownerAttempt.delegationScope, "formalize");
  assert.match(ownerAttempt.events[0].message, /opened by its owner/i);
  assert.match(ownerAttemptNote, /not an Agent-signed event/i);

  // The stage path is separately covered with a real Agent signature in the
  // Artifact Store test. This fixture exercises the owner-only read projection
  // and workbench rendering with its fully bound immutable row.
  const provisionalManifestHash = `sha256:${"1".repeat(64)}`;
  await database
    .prepare("INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)")
    .bind(provisionalManifestHash, "bundles/sha256/provisional-fixture/bundle.json", 2, "application/json")
    .run();
  await database
    .prepare(
      `INSERT INTO artifact_bundles (
        id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
        canonical_manifest, agent_event_id, agent_event_payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      "bundle:provisional-ledger-fixture",
      ownerAttempt.id,
      ownerAttempt.problemRevisionId,
      provisionalManifestHash,
      "bundles/sha256/provisional-fixture/bundle.json",
      "{}",
      "agent-event:provisional-ledger-fixture",
      `sha256:${"2".repeat(64)}`,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO provisional_contributions (
        id, kind, state, beneficiary_person_id, beneficiary_agent_id,
        beneficiary_delegation_certificate_id, attempt_id, problem_revision_id,
        artifact_bundle_manifest_hash, agent_event_id, agent_event_occurred_at,
        recorded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `provisional-evidence:${provisionalManifestHash}`,
      "evidence_bundle",
      "bundle_staged",
      profile.person.id,
      ownerAttempt.agentId,
      certificate.id,
      ownerAttempt.id,
      ownerAttempt.problemRevisionId,
      provisionalManifestHash,
      "agent-event:provisional-ledger-fixture",
      "2026-07-13T00:00:00Z",
      "2026-07-13T00:00:01Z",
    )
    .run();
  const provisionalResponse = await render("/api/me/provisional-contributions", { headers: authHeaders });
  assert.equal(provisionalResponse.status, 200);
  const { contributions: provisionalContributions, note: provisionalNote } = await provisionalResponse.json();
  assert.equal(provisionalContributions.length, 1);
  assert.equal(provisionalContributions[0].artifactBundleManifestHash, provisionalManifestHash);
  assert.equal(provisionalContributions[0].beneficiary.agentId, ownerAttempt.agentId);
  assert.match(provisionalNote, /not assert mathematical correctness/i);

  const selectedTargetAttemptResponse = await render("/api/me/attempts", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      problemSlug: "erdos-865-k2",
      delegationCertificateId: certificate.id,
      delegationScope: "prove",
      idempotencyKey: "owner-opened-selected-target-attempt-1",
    }),
  });
  assert.equal(selectedTargetAttemptResponse.status, 201);
  const { attempt: selectedTargetAttempt } = await selectedTargetAttemptResponse.json();
  assert.equal(selectedTargetAttempt.problemSlug, "erdos-865-k2");
  assert.match(selectedTargetAttempt.problemTitle, /k = 2 variant/i);

  // The owner workbench receives only a normalized, hash-bound Runner summary.
  // It must never receive the canonical signed-result payload or logs directly.
  const runnerKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const runnerPublicKey = base64Url(await crypto.subtle.exportKey("raw", runnerKeys.publicKey));
  const runnerResult = await signLeanRunnerResult({
    result: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: "run:workbench-owner-summary",
      attemptId: ownerAttempt.id,
      requestHash: `sha256:${"3".repeat(64)}`,
      runnerKeyId: "runner-key:workbench-summary",
      status: "succeeded",
      exitCode: 0,
      startedAt: "2026-07-14T00:00:00Z",
      finishedAt: "2026-07-14T00:00:01Z",
      kernelStatus: "accepted",
      checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
      artifacts: {
        manifestHash: provisionalManifestHash,
        stdoutHash: `sha256:${"4".repeat(64)}`,
        stderrHash: `sha256:${"5".repeat(64)}`,
      },
    },
    runnerPrivateKey: runnerKeys.privateKey,
  });
  const runnerResultHash = await sha256Canonical(runnerResult);
  await database.batch([
    database.prepare("INSERT INTO runner_keys (id, public_key, fingerprint) VALUES (?, ?, ?)").bind(
      runnerResult.runnerKeyId,
      runnerPublicKey,
      `sha256:${"8".repeat(64)}`,
    ),
    database.prepare(
      `INSERT INTO agent_attempt_events (
        id, attempt_id, sequence, event_type, message, idempotency_key, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "attempt-event:workbench-summary-bundle",
      ownerAttempt.id,
      2,
      "bundle_staged",
      "Fixture Bundle staged for the owner workbench Runner summary.",
      "workbench-summary-bundle",
      "2026-07-14T00:00:00Z",
    ),
    database.prepare(
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state,
        queued_at, preparing_at, started_at, finished_at, runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      runnerResult.jobId,
      ownerAttempt.id,
      provisionalManifestHash,
      runnerResult.requestHash,
      "workbench-owner-summary",
      "succeeded",
      "2026-07-14T00:00:00Z",
      "2026-07-14T00:00:00Z",
      runnerResult.startedAt,
      runnerResult.finishedAt,
      runnerResultHash,
      "2027-01-01T00:00:00Z",
    ),
    database.prepare("INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)").bind(
      runnerResult.jobId,
      runnerResultHash,
      canonicalJson(runnerResult),
      "2026-07-14T00:00:01Z",
    ),
    // This malformed historical projection proves that a row is never
    // upgraded into a Lean verdict merely because it says `succeeded`.
    database.prepare(
      `INSERT INTO runs (
        id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key, state,
        queued_at, started_at, finished_at, runner_result_hash, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "run:workbench-unreadable",
      attempt.id,
      provisionalManifestHash,
      `sha256:${"6".repeat(64)}`,
      "workbench-unreadable",
      "succeeded",
      "2026-07-13T00:00:00Z",
      "2026-07-13T00:00:00Z",
      "2026-07-13T00:00:01Z",
      `sha256:${"7".repeat(64)}`,
      "2026-07-13T00:00:01Z",
    ),
    database.prepare("INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)").bind(
      "run:workbench-unreadable",
      `sha256:${"7".repeat(64)}`,
      "{}",
      "2026-07-13T00:00:01Z",
    ),
    database.prepare("UPDATE agent_attempts SET updated_at = ? WHERE id = ?").bind("2027-01-01T00:00:00Z", ownerAttempt.id),
  ]);

  const ownerAttemptsResponse = await render("/api/me/attempts", { headers: authHeaders });
  assert.equal(ownerAttemptsResponse.status, 200);
  const { attempts: ownerAttempts, runs: ownerRuns } = await ownerAttemptsResponse.json();
  assert.equal(ownerAttempts.some((candidate) => candidate.id === ownerAttempt.id), true);
  assert.equal(ownerAttempts.some((candidate) => candidate.id === attempt.id), true);
  assert.deepEqual(ownerRuns.find((run) => run.id === runnerResult.jobId), {
    id: runnerResult.jobId,
    attemptId: ownerAttempt.id,
    artifactBundleHash: provisionalManifestHash,
    state: "succeeded",
    queuedAt: "2026-07-14T00:00:00Z",
    startedAt: "2026-07-14T00:00:00Z",
    finishedAt: "2026-07-14T00:00:01Z",
    runnerResultHash,
    evidenceState: "recorded",
    result: {
      resultHash: runnerResultHash,
      receivedAt: "2026-07-14T00:00:01Z",
      summary: {
        status: "succeeded",
        exitCode: 0,
        kernelStatus: "accepted",
        checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
      },
    },
  });
  assert.equal(ownerRuns.find((run) => run.id === "run:workbench-unreadable")?.evidenceState, "unreadable");
  assert.doesNotMatch(JSON.stringify(ownerRuns), /runnerSignature|canonicalResult|stdoutHash/i);

  const otherAttemptsResponse = await render("/api/me/attempts", {
    headers: { "oai-authenticated-user-email": "other-owner@example.test" },
  });
  assert.equal(otherAttemptsResponse.status, 200);
  const otherAttemptPayload = await otherAttemptsResponse.json();
  assert.deepEqual(otherAttemptPayload.attempts, []);
  assert.deepEqual(otherAttemptPayload.runs, []);
  const otherProvisionalResponse = await render("/api/me/provisional-contributions", {
    headers: { "oai-authenticated-user-email": "other-owner@example.test" },
  });
  assert.equal(otherProvisionalResponse.status, 200);
  assert.deepEqual((await otherProvisionalResponse.json()).contributions, []);

  const ownerWorkbench = await render("/workbench?target=erdos-865-k2", { headers: authHeaders });
  assert.equal(ownerWorkbench.status, 200);
  const ownerWorkbenchHtml = await ownerWorkbench.text();
  assert.match(ownerWorkbenchHtml, /Choose a question\. Start with your Agent\./i);
  assert.match(ownerWorkbenchHtml, /Choose research/i);
  assert.match(ownerWorkbenchHtml, /Inspect evidence/i);
  assert.match(ownerWorkbenchHtml, /Connect Codex once before starting research/i);
  assert.match(ownerWorkbenchHtml, /Erdős Problem 865: k = 2 variant/i);
  assert.match(ownerWorkbenchHtml, /Attempt opened/i);
  assert.match(ownerWorkbenchHtml, /Refresh records/i);
  assert.match(ownerWorkbenchHtml, /First evidence path/i);
  assert.match(ownerWorkbenchHtml, /One step at a time/i);
  assert.match(ownerWorkbenchHtml, /different owner must complete the reproducibility, kernel, and project-acceptance gates/i);
  assert.match(ownerWorkbenchHtml, /Staged evidence ledger/i);
  assert.doesNotMatch(ownerWorkbenchHtml, /Continue with Agent/i);
  assert.match(ownerWorkbenchHtml, /Bundle staged · provisional/i);
  assert.match(ownerWorkbenchHtml, /Lean kernel status · no Run recorded/i);
  assert.match(ownerWorkbenchHtml, /Runner required/i);
  assert.match(ownerWorkbenchHtml, /Requires a fresh runner execution with kernel, axiom, and sorry evidence/i);
  assert.doesNotMatch(ownerWorkbenchHtml, /Lean kernel status · accepted/i);
  assert.match(ownerWorkbenchHtml, /not a theorem, Lean result, novelty finding, independent review, credit award, or final Contribution Receipt/i);

  const workspaceSummaryResponse = await render("/api/me/workspace-summary", { headers: authHeaders });
  assert.equal(workspaceSummaryResponse.status, 200);
  const { summary: workspaceSummary, note: workspaceSummaryNote } = await workspaceSummaryResponse.json();
  assert.equal(workspaceSummary.counts.activeAttempts, ownerAttempts.filter((candidate) => candidate.status === "active").length);
  assert.equal(workspaceSummary.counts.provisionalContributions, 1);
  assert.ok(workspaceSummary.counts.evidence >= 1);
  assert.match(workspaceSummaryNote, /do not imply mathematical correctness/i);

  const persistedAttemptWorkbench = await render(`/workbench?attempt=${encodeURIComponent(ownerAttempt.id)}`, { headers: authHeaders });
  assert.equal(persistedAttemptWorkbench.status, 200);
  assert.match(await persistedAttemptWorkbench.text(), /Current focus<\/span><h2>Erdős Problem 865<\/h2>/i);

  const myWorkOverview = await render("/workbench", { headers: authHeaders });
  assert.equal(myWorkOverview.status, 200);
  const myWorkOverviewHtml = await myWorkOverview.text();
  assert.match(myWorkOverviewHtml, /Personal research workspace[\s\S]*<h1[^>]*>My work<\/h1>/i);
  assert.match(myWorkOverviewHtml, /Active research|Needs attention|Waiting/i);
  assert.match(myWorkOverviewHtml, /href="\/workbench\/attempts\/[^\"]+"/i);

  const attemptDetail = await render(`/workbench/attempts/${encodeURIComponent(ownerAttempt.id)}`, { headers: authHeaders });
  assert.equal(attemptDetail.status, 200);
  const attemptDetailHtml = await attemptDetail.text();
  assert.match(attemptDetailHtml, /My work[\s\S]*Current focus<\/span><h1>Erdős Problem 865<\/h1>/i);
  assert.match(attemptDetailHtml, /Manage Attempt/i);

  const evidenceWorkbench = await render("/workbench?target=erdos-865", { headers: authHeaders });
  assert.equal(evidenceWorkbench.status, 200);
  const evidenceWorkbenchHtml = await evidenceWorkbench.text();
  assert.match(evidenceWorkbenchHtml, /Lean kernel status · accepted/i);
  assert.match(evidenceWorkbenchHtml, /Result evidence recorded/i);
  assert.match(evidenceWorkbenchHtml, /Hash-bound Runner result recorded accepted kernel/i);

  const pausedResponse = await render(`/api/me/attempts/${encodeURIComponent(ownerAttempt.id)}`, {
    method: "PATCH",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "pause" }),
  });
  assert.equal(pausedResponse.status, 200);
  const pausedAttempt = (await pausedResponse.json()).attempt;
  assert.equal(pausedAttempt.id, ownerAttempt.id);
  assert.equal(pausedAttempt.status, "paused");
  assert.equal(pausedAttempt.events.at(-1).type, "attempt_paused");

  const resumedResponse = await render(`/api/me/attempts/${encodeURIComponent(ownerAttempt.id)}`, {
    method: "PATCH",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "resume" }),
  });
  assert.equal(resumedResponse.status, 200);
  const resumedAttempt = (await resumedResponse.json()).attempt;
  assert.equal(resumedAttempt.id, ownerAttempt.id);
  assert.equal(resumedAttempt.status, "active");
  assert.equal(resumedAttempt.events.at(-1).type, "attempt_resumed");

  const abandonedResponse = await render(`/api/me/attempts/${encodeURIComponent(ownerAttempt.id)}`, {
    method: "PATCH",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "abandon" }),
  });
  assert.equal(abandonedResponse.status, 200);
  const abandonedAttempt = (await abandonedResponse.json()).attempt;
  assert.equal(abandonedAttempt.id, ownerAttempt.id);
  assert.equal(abandonedAttempt.status, "abandoned");
  assert.equal(abandonedAttempt.events.at(-1).type, "attempt_abandoned");
  assert.equal(abandonedAttempt.events.some((event) => event.type === "bundle_staged"), true);

  const otherOwnerClose = await render(`/api/me/attempts/${encodeURIComponent(selectedTargetAttempt.id)}`, {
    method: "PATCH",
    headers: { "oai-authenticated-user-email": "other-owner@example.test", "content-type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });
  assert.equal(otherOwnerClose.status, 404);

  const closeAttemptResponse = await render(`/api/me/attempts/${encodeURIComponent(selectedTargetAttempt.id)}`, {
    method: "PATCH",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });
  assert.equal(closeAttemptResponse.status, 200);
  const { attempt: closedAttempt, idempotentReplay: firstCloseReplay } = await closeAttemptResponse.json();
  assert.equal(firstCloseReplay, false);
  assert.equal(closedAttempt.status, "cancelled");
  assert.equal(closedAttempt.events.at(-1).type, "attempt_cancelled");
  assert.match(closedAttempt.events.at(-1).message, /closed by its owner/i);

  const repeatedCloseResponse = await render(`/api/me/attempts/${encodeURIComponent(selectedTargetAttempt.id)}`, {
    method: "PATCH",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "cancel" }),
  });
  assert.equal(repeatedCloseResponse.status, 200);
  assert.equal((await repeatedCloseResponse.json()).idempotentReplay, true);

  const historyWorkbench = await render(`/workbench?attempt=${encodeURIComponent(selectedTargetAttempt.id)}`, { headers: authHeaders });
  assert.equal(historyWorkbench.status, 200);
  const historyWorkbenchHtml = await historyWorkbench.text();
  assert.match(historyWorkbenchHtml, /History/i);
  assert.match(historyWorkbenchHtml, /Attempt closed by owner/i);
  assert.match(historyWorkbenchHtml, /This Attempt is retained in your research history/i);
  assert.doesNotMatch(historyWorkbenchHtml, /Copy Codex brief/i);

  const currentOwnerAttemptsResponse = await render("/api/me/attempts", { headers: authHeaders });
  const { attempts: currentOwnerAttempts } = await currentOwnerAttemptsResponse.json();
  const activeAttemptCount = currentOwnerAttempts.filter((candidate) => candidate.status === "active").length;
  const capacityFixtures = [];
  for (let index = activeAttemptCount; index < closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson; index += 1) {
    capacityFixtures.push(database.prepare(
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, delegation_certificate_id,
        delegation_scope, agent_label, status, idempotency_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    ).bind(
      `attempt:owner-capacity:${index}`,
      profile.person.id,
      "problem-revision:formal-conjectures:erdos-865:main:1",
      certificate.agentId,
      certificate.id,
      "prove",
      "Delegation test agent",
      `owner-attempt-capacity-${index}`,
      `2026-07-14T00:00:${String(index).padStart(2, "0")}Z`,
      `2026-07-14T00:00:${String(index).padStart(2, "0")}Z`,
    ));
  }
  if (capacityFixtures.length > 0) await database.batch(capacityFixtures);
  const exhaustedAttemptResponse = await render("/api/me/attempts", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      problemSlug: "erdos-865-sos-variant",
      delegationCertificateId: certificate.id,
      delegationScope: "prove",
      idempotencyKey: "owner-attempt-capacity-exhausted",
    }),
  });
  assert.equal(exhaustedAttemptResponse.status, 429);
  assert.equal((await exhaustedAttemptResponse.json()).error.code, "rate_limited");

  const guardedKeyRevocation = await render(`/api/me/keys/${encodeURIComponent(key.id)}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Device replaced.", emergency: false }),
  });
  assert.equal(guardedKeyRevocation.status, 409);
  assert.match((await guardedKeyRevocation.json()).error.message, /another device signing key/i);

  const replacementKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const replacementPublicKey = base64Url(await crypto.subtle.exportKey("raw", replacementKeys.publicKey));
  const replacementKeyResponse = await render("/api/me/keys", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ publicKey: replacementPublicKey }),
  });
  assert.equal(replacementKeyResponse.status, 201);
  const { key: replacementKey } = await replacementKeyResponse.json();
  const replacementChallengeResponse = await render(`/api/me/keys/${encodeURIComponent(replacementKey.id)}/proof-challenge`, {
    method: "POST",
    headers: authHeaders,
  });
  assert.equal(replacementChallengeResponse.status, 201);
  const { challenge: replacementChallenge } = await replacementChallengeResponse.json();
  const replacementSignature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    replacementKeys.privateKey,
    new TextEncoder().encode(canonicalJson(personKeyProofChallengeSigningPayload(replacementChallenge))),
  ));
  const replacementProof = await render(`/api/me/keys/${encodeURIComponent(replacementKey.id)}/proof`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ challengeId: replacementChallenge.id, personSignature: replacementSignature }),
  });
  assert.equal(replacementProof.status, 201);

  const keyRevocationResponse = await render(`/api/me/keys/${encodeURIComponent(key.id)}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Device replaced.", emergency: false }),
  });
  assert.equal(keyRevocationResponse.status, 201);
  const { revocation: keyRevocation } = await keyRevocationResponse.json();
  assert.equal(keyRevocation.personKeyId, key.id);
  assert.equal(keyRevocation.reason, "Device replaced.");
  const repeatedKeyRevocation = await render(`/api/me/keys/${encodeURIComponent(key.id)}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Device replaced.", emergency: false }),
  });
  assert.equal(repeatedKeyRevocation.status, 200);
  assert.equal((await repeatedKeyRevocation.json()).idempotentReplay, true);
  const revokedKeyProfileResponse = await render("/api/me/delegation", { headers: authHeaders });
  const { profile: revokedKeyProfile } = await revokedKeyProfileResponse.json();
  assert.equal(revokedKeyProfile.signingKeys.find((candidate) => candidate.id === key.id).revokedAt.length > 0, true);
  assert.equal(revokedKeyProfile.signingKeys.find((candidate) => candidate.id === replacementKey.id).possessionVerifiedAt.length > 0, true);

  const progressAfterKeyRevocation = await render(`/api/v1/mcp/attempts/${attempt.id}/events`, {
    method: "POST",
    headers: { authorization: `Bearer ${testToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: "This must not be recorded after signer key revocation.",
      progressPercent: 1,
      idempotencyKey: "delegation-progress-after-key-revocation",
    }),
  });
  assert.equal(progressAfterKeyRevocation.status, 412);

  const emergencyReplacementRevocation = await render(`/api/me/keys/${encodeURIComponent(replacementKey.id)}/revoke`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ reason: "Replacement device compromised.", emergency: true }),
  });
  assert.equal(emergencyReplacementRevocation.status, 201);
  assert.equal((await emergencyReplacementRevocation.json()).revocation.personKeyId, replacementKey.id);

  const revokedResponse = await render("/api/me/delegations/pw:delegation:api-test/revoke", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      reason: "Agent key rotated.",
      revokedAt: new Date().toISOString(),
    }),
  });
  assert.equal(revokedResponse.status, 200);
  assert.equal((await revokedResponse.json()).delegation.revokedAt.length > 0, true);

});

test("keeps the production frontend free of the deleted starter preview", async () => {
  const [page, layout, globals, researchGraphView, packageJson, workbench, delegationSetup, localAgentHandoff, browserKeyStore, sourceSkill, legacyContent] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/explore/[slug]/ResearchGraphView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../app/workbench/workbench-sections.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/workbench/DelegationSetup.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/workbench/LocalAgentHandoff.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/workbench/browser-signing-key.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../skills/proofweave-research/SKILL.md", import.meta.url),
      "utf8",
    ),
    access(new URL("../app/lib/content.ts", import.meta.url)).then(
      () => "present",
      () => "absent",
    ),
  ]);

  assert.match(page, /Proofweave/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview|react-loading-skeleton/i);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview/i);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/i);
  assert.match(globals, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(globals, /hero-proof-page-lift/);
  assert.match(globals, /hero-evidence-pulse/);
  assert.match(researchGraphView, /Checkpoint evidence gates/);
  assert.match(researchGraphView, /Receipt recorded/);
  assert.match(workbench, /No simulated Agent work is created in this workspace/);
  assert.match(workbench, /Proofweave does not render a sample source file or a fictional compiler result/);
  assert.match(workbench, /Independent review/);
  assert.doesNotMatch(workbench, /Run next bounded step|Illustrative only|Example check result|Local preview/);
  assert.match(delegationSetup, /Connect an accountable research Agent/);
  assert.match(delegationSetup, /Recommended setup/);
  assert.match(delegationSetup, /Advanced: manage an existing key or Agent manually/);
  assert.match(delegationSetup, /No public key or API key is required/);
  assert.match(delegationSetup, /Proofweave never asks for your ChatGPT password, API key, private key, or workspace/);
  assert.doesNotMatch(delegationSetup, /Enter Agent identity/);
  assert.match(delegationSetup, /Replace or revoke key/);
  assert.match(localAgentHandoff, /Continue this Proofweave Attempt in Codex/);
  assert.match(workbench, /Copy Codex brief/);
  assert.match(globals, /\.workspace-topbar \{[^}]*z-index:\s*1;/s);
  assert.match(localAgentHandoff, /Check recorded progress/);
  assert.match(localAgentHandoff, /do not call \\`report_progress\\` unless I explicitly confirm/);
  assert.match(localAgentHandoff, /connection_status/);
  assert.match(localAgentHandoff, /continue_research/);
  assert.match(localAgentHandoff, /research_connection_mismatch/);
  assert.match(localAgentHandoff, /do not create a replacement Attempt/);
  assert.match(localAgentHandoff, /inspect_research_graph/);
  assert.match(localAgentHandoff, /prepare_research_checkpoint/);
  assert.match(localAgentHandoff, /publish_prepared_research_checkpoint/);
  assert.match(localAgentHandoff, /I_CONFIRM_PUBLISH_CHECKPOINT/);
  assert.match(localAgentHandoff, /prepare_workspace_bundle_v2/);
  assert.match(localAgentHandoff, /submit_prepared_research_submission/);
  assert.match(localAgentHandoff, /I_CONFIRM_PREPARE_WORKSPACE_BUNDLE/);
  assert.match(localAgentHandoff, /I_CONFIRM_STAGE_AND_RUN/);
  assert.doesNotMatch(localAgentHandoff, /PROOFWEAVE_API_TOKEN/);
  assert.match(sourceSkill, /wait for explicit confirmation before recording it/);
  assert.match(sourceSkill, /explicitly approve the smallest local file set/);
  assert.match(sourceSkill, /Only after the owner explicitly confirms the exact previewed list/);
  assert.match(sourceSkill, /prepare_artifact_bundle_v2/);
  assert.match(sourceSkill, /prepare_workspace_bundle_v2/);
  assert.match(sourceSkill, /I_CONFIRM_STAGE_AND_RUN/);
  assert.match(sourceSkill, /list_review_assignments/);
  assert.match(sourceSkill, /get_review_assignment/);
  assert.match(browserKeyStore, /IndexedDB-backed WebCrypto store/);
  assert.match(browserKeyStore, /Remove a locally held private key/);
  assert.doesNotMatch(browserKeyStore, /localStorage/);
  assert.equal(legacyContent, "absent");

  await assert.rejects(
    access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)),
  );
  await assert.rejects(
    access(new URL("public/_sites-preview/SkeletonPreview.tsx", repositoryRoot)),
  );
});

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
