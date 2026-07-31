import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  D1RemoteMcpGatewayStore,
  GatewayStoreAuthorizationError,
  GatewayStoreNotFoundError,
  GatewayStoreRateLimitError,
} from "../services/proofweave-mcp-gateway/d1-gateway-store.mjs";
import { closedAlphaAttemptLimits } from "../packages/domain/attempt-policy.mjs";
import {
  createD1RemoteMcpGatewayRuntime,
  RemoteMcpRuntimeConfigurationError,
} from "../services/proofweave-mcp-gateway/runtime.mjs";
import cloudflareGatewayWorker from "../services/proofweave-mcp-gateway/cloudflare-worker.mjs";
import { D1ProofweaveOAuthStore } from "../services/proofweave-identity/d1-oauth-store.mjs";
import { D1VerificationStore } from "../services/verification/d1-verification-store.mjs";
import { D1R2VerificationReplayEvidenceStore } from "../services/verification/d1-r2-verification-replay-evidence-store.mjs";
import { D1R2ArtifactStore } from "../services/artifacts/d1-r2-artifact-store.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import {
  signLeanRunnerResult,
  verifyLeanRunnerResultSignature,
} from "../packages/protocol/lean-runner.mjs";
import { runnerKeyFingerprint } from "../packages/protocol/runner-key-registry.mjs";
import { D1ResearchGraphStore } from "../services/research/d1-research-graph-store.mjs";
import {
  researchCheckpointPayloadHash,
  researchCheckpointSigningPayload,
} from "../packages/protocol/research-checkpoint.mjs";
import { applyControlPlaneOperationMode } from "../services/database/control-plane-operation-mode.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let reviewerKeyPair;
let reviewerPublicKey;
let proverKeyPair;
let proverPublicKey;
let ownerProverKeyPair;
let ownerProverPublicKey;
let alternateProverPublicKey;
let artifactBucket;
let controlPlanePrivateKeyJwkJson;

before(async () => {
  reviewerKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  reviewerPublicKey = base64Url(await crypto.subtle.exportKey("raw", reviewerKeyPair.publicKey));
  proverKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  proverPublicKey = base64Url(await crypto.subtle.exportKey("raw", proverKeyPair.publicKey));
  ownerProverKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  ownerProverPublicKey = base64Url(await crypto.subtle.exportKey("raw", ownerProverKeyPair.publicKey));
  const alternateProverKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  alternateProverPublicKey = base64Url(await crypto.subtle.exportKey("raw", alternateProverKeyPair.publicKey));
  const controlPlaneKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  controlPlanePrivateKeyJwkJson = JSON.stringify(await crypto.subtle.exportKey("jwk", controlPlaneKeyPair.privateKey));
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
    r2Buckets: ["ARTIFACTS"],
  });
  database = await miniflare.getD1Database("DB");
  artifactBucket = await miniflare.getR2Bucket("ARTIFACTS");
  await applyMigrations(database);
  await seedGatewayFixture(database, { reviewerPublicKey, proverPublicKey, ownerProverPublicKey, alternateProverPublicKey });
});

after(async () => {
  await miniflare?.dispose();
});

test("partial Runner dispatch configuration fails closed before serving MCP", () => {
  assert.throws(
    () => createD1RemoteMcpGatewayRuntime({
      resource: "https://mcp.gateway.example.test/mcp",
      issuer: "https://auth.gateway.example.test",
      database,
      bucket: artifactBucket,
      operationMode: "read_write",
      receiptIssuerKeyId: "issuer:partial",
    }),
    RemoteMcpRuntimeConfigurationError,
  );
  assert.throws(
    () => createD1RemoteMcpGatewayRuntime({
      resource: "https://mcp.gateway.example.test/mcp",
      issuer: "https://auth.gateway.example.test",
      database,
      bucket: artifactBucket,
      operationMode: "read_write",
      runnerApprovedImagesJson: "[]",
    }),
    RemoteMcpRuntimeConfigurationError,
  );
  assert.throws(
    () => createD1RemoteMcpGatewayRuntime({
      resource: "https://mcp.gateway.example.test/mcp",
      issuer: "https://auth.gateway.example.test",
      database,
      bucket: artifactBucket,
      operationMode: "read_write",
      runnerQueue: { async send() {} },
      runnerApprovedImagesJson: JSON.stringify([{
        imageDigest: `registry.example.test/proofweave/lean@sha256:${"f".repeat(64)}`,
        leanToolchain: "leanprover/lean4:v4.27.0",
        mathlibRevision: "gateway-fixture",
      }]),
      runnerControlPlaneKeyId: "runner-control:gateway",
      runnerControlPlanePrivateKeyJwkJson: "{}",
      runnerDefaultLimitsJson: JSON.stringify({
        cpuSeconds: 60,
        wallSeconds: 120,
        memoryMiB: 2_048,
        diskMiB: 2_048,
        outputBytes: 1_000_000,
      }),
    }),
    RemoteMcpRuntimeConfigurationError,
  );
});

test("read-only D1 runtime serves reads without validating write-only bindings and blocks mutations", async () => {
  const resource = "https://mcp.gateway.example.test/mcp";
  const accessToken = "pw_at_gateway_read_only_runtime_fixture";
  const oauthStore = new D1ProofweaveOAuthStore(database);
  await oauthStore.issueTokenPair({
    accessTokenHash: await tokenHash(accessToken),
    refreshTokenHash: await tokenHash("pw_rt_gateway_read_only_runtime_fixture"),
    clientId: "client:gateway-codex",
    resource,
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover",
    scopes: ["catalog:read", "attempt:create"],
    issuedAt: "2026-07-13T00:00:00Z",
    accessExpiresAt: "2027-07-13T00:00:00Z",
    refreshExpiresAt: "2027-08-13T00:00:00Z",
  });
  const readOnlyDatabase = applyControlPlaneOperationMode(database, "read_only");
  const gateway = createD1RemoteMcpGatewayRuntime({
    resource,
    issuer: "https://auth.gateway.example.test",
    database: readOnlyDatabase,
    operationMode: "read_only",
    runnerQueueMode: "invalid-write-only-mode",
    runnerApprovedImagesJson: JSON.stringify([
      `registry.example.test/proofweave/lean@sha256:${"f".repeat(64)}`,
    ]),
    receiptIssuerKeyId: "issuer:incomplete-write-only-config",
  });

  const authority = await callGatewayTool(
    gateway,
    resource,
    accessToken,
    "get_connection_authority",
    {},
  );
  assert.equal(authority.result.isError, undefined);
  assert.equal(
    JSON.parse(authority.result.content[0].text).personId,
    "person:gateway-reviewer",
  );
  const frontier = await callGatewayTool(
    gateway,
    resource,
    accessToken,
    "list_frontier_problems",
    {},
  );
  assert.equal(frontier.result.isError, undefined);
  assert.match(frontier.result.content[0].text, /gateway-target/);

  const blocked = await gateway.fetch(new Request(resource, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_attempt",
        arguments: {
          problemSlug: "gateway-target",
          delegationScope: "prove",
          idempotencyKey: "must-not-write-during-read-only-runtime-test",
        },
      },
    }),
  }));
  assert.equal(blocked.status, 503);
  assert.deepEqual(await blocked.json(), {
    error: "temporarily_unavailable",
    error_description: "Proofweave is temporarily read-only for maintenance.",
    diagnostic_code: "control_plane_read_only",
  });
});

test("provider-neutral gateway composes the durable database Runner queue only from a complete configuration", () => {
  const complete = {
    resource: "https://mcp.gateway.example.test/mcp",
    issuer: "https://auth.gateway.example.test",
    database,
    bucket: artifactBucket,
    operationMode: "read_write",
    runnerQueueMode: "d1",
    runnerApprovedImagesJson: JSON.stringify([{
      imageDigest: `registry.example.test/proofweave/lean@sha256:${"f".repeat(64)}`,
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "gateway-fixture",
    }]),
    runnerControlPlaneKeyId: "runner-control:gateway",
    runnerControlPlanePrivateKeyJwkJson: controlPlanePrivateKeyJwkJson,
    runnerDefaultLimitsJson: JSON.stringify({
      cpuSeconds: 60,
      wallSeconds: 120,
      memoryMiB: 2_048,
      diskMiB: 2_048,
      outputBytes: 1_000_000,
    }),
  };
  assert.equal(typeof createD1RemoteMcpGatewayRuntime(complete).fetch, "function");
  assert.throws(
    () => createD1RemoteMcpGatewayRuntime({ ...complete, runnerQueueMode: "memory" }),
    /RUNNER_QUEUE_MODE must be d1/,
  );
  assert.throws(
    () => createD1RemoteMcpGatewayRuntime({ ...complete, runnerQueue: { async send() {} } }),
    /cannot be combined/,
  );
});

test("remote MCP gateway store binds a signed review attestation to its OAuth installation", async () => {
  const verification = new D1VerificationStore(database);
  await verification.assign({
    id: "assignment:gateway-review",
    artifactBundleManifestHash: sha("a"),
    claimType: "kernel_accepted",
    verifierPersonId: "person:gateway-reviewer",
    assignedAt: "2026-07-13T00:00:00Z",
  });
  await verification.accept("assignment:gateway-review", "person:gateway-reviewer", "2026-07-13T00:00:01Z");

  const replayRunId = "run:gateway-review-fresh-replay";
  const replayId = "verification-replay:gateway-review";
  const requestHash = sha("c");
  await database.prepare(
    `INSERT INTO runs (
      id, attempt_id, artifact_bundle_hash, request_hash, idempotency_key,
      state, queued_at, started_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    replayRunId,
    "attempt:gateway",
    sha("a"),
    requestHash,
    "gateway-review-fresh-replay",
    "running",
    "2026-07-13T00:00:01.100Z",
    "2026-07-13T00:00:01.200Z",
    "2026-07-13T00:00:01.200Z",
  ).run();
  await database.prepare(
    `INSERT INTO verification_replays (
      id, assignment_id, run_id, artifact_bundle_manifest_hash,
      requester_person_id, requester_agent_id, delegation_certificate_id,
      agent_installation_id, idempotency_key, requested_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    replayId,
    "assignment:gateway-review",
    replayRunId,
    sha("a"),
    "person:gateway-reviewer",
    "agent:gateway-reviewer",
    "delegation:gateway-reviewer",
    "installation:gateway-reviewer",
    "gateway-review-fresh-replay",
    "2026-07-13T00:00:01.100Z",
  ).run();
  const runnerKeyPair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const runnerPublicKey = base64Url(await crypto.subtle.exportKey("raw", runnerKeyPair.publicKey));
  await database.prepare(
    "INSERT INTO runner_keys (id, public_key, fingerprint) VALUES (?, ?, ?)",
  ).bind(
    "runner-key:gateway-review-fixture",
    runnerPublicKey,
    await runnerKeyFingerprint(runnerPublicKey),
  ).run();
  const runnerResult = await signLeanRunnerResult({
    result: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: replayRunId,
      attemptId: "attempt:gateway",
      requestHash,
      runnerKeyId: "runner-key:gateway-review-fixture",
      status: "succeeded",
      exitCode: 0,
      startedAt: "2026-07-13T00:00:01.200Z",
      finishedAt: "2026-07-13T00:00:01.500Z",
      kernelStatus: "accepted",
      checks: {
        network: "passed",
        noSorry: "passed",
        allowedAxioms: "passed",
        leanBuild: "passed",
      },
      artifacts: {
        manifestHash: sha("a"),
        stdoutHash: sha("d"),
        stderrHash: sha("e"),
      },
    },
    runnerPrivateKey: runnerKeyPair.privateKey,
  });
  assert.equal(await verifyLeanRunnerResultSignature({ result: runnerResult, runnerPublicKey }), true);
  const replayEvidence = await new D1R2VerificationReplayEvidenceStore({
    database,
    bucket: artifactBucket,
  }).persist({
    run: {
      id: replayRunId,
      attemptId: "attempt:gateway",
      requestHash,
      artifactBundleHash: sha("a"),
      state: "running",
    },
    result: runnerResult,
    receivedAt: "2026-07-13T00:00:01.600Z",
  });
  assert.equal(replayEvidence?.created, true);
  const runnerResultHash = await sha256Canonical(runnerResult);
  await database.batch([
    database.prepare(
      "INSERT INTO run_results (run_id, result_hash, canonical_result, received_at) VALUES (?, ?, ?, ?)",
    ).bind(
      replayRunId,
      runnerResultHash,
      canonicalJson(runnerResult),
      "2026-07-13T00:00:01.600Z",
    ),
    database.prepare(
      `UPDATE runs
       SET state = 'succeeded', finished_at = ?, runner_result_hash = ?, updated_at = ?
       WHERE id = ? AND state = 'running'`,
    ).bind(
      "2026-07-13T00:00:01.500Z",
      runnerResultHash,
      "2026-07-13T00:00:01.600Z",
      replayRunId,
    ),
  ]);

  const store = new D1RemoteMcpGatewayStore(database);
  const principal = {
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-reviewer",
    scopes: ["catalog:read", "verification:write"],
  };
  const attestation = await signedAttestation({ evidenceHash: replayEvidence.evidenceHash });
  const recorded = await store.submitVerificationAttestation(principal, attestation);
  assert.equal(recorded.created, true);
  assert.equal(recorded.attestation.id, attestation.id);
  assert.equal((await store.submitVerificationAttestation(principal, attestation)).created, false);

  await assert.rejects(
    store.submitVerificationAttestation({ ...principal, scopes: ["catalog:read"] }, attestation),
    GatewayStoreAuthorizationError,
  );
});

test("remote MCP gateway store rejects an Attestation that is not the selected review installation", async () => {
  const verification = new D1VerificationStore(database);
  await verification.assign({
    id: "assignment:gateway-binding",
    artifactBundleManifestHash: sha("a"),
    claimType: "novelty_reviewed",
    verifierPersonId: "person:gateway-reviewer",
    assignedAt: "2026-07-13T00:00:02Z",
  });
  await verification.accept("assignment:gateway-binding", "person:gateway-reviewer", "2026-07-13T00:00:03Z");
  const store = new D1RemoteMcpGatewayStore(database);
  const principal = {
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-reviewer",
    scopes: ["verification:write"],
  };
  const mismatched = await signedAttestation({
    id: "attestation:gateway-binding",
    assignmentId: "assignment:gateway-binding",
    claimType: "novelty_reviewed",
  });
  mismatched.verifierPersonId = "person:gateway-owner";
  await assert.rejects(
    store.submitVerificationAttestation(principal, mismatched),
    /does not match the authorized Agent installation/,
  );
});

test("a review Agent can discover only its Person-addressed assignments and controlled context", async () => {
  const verification = new D1VerificationStore(database);
  await verification.assign({
    id: "assignment:gateway-discovery",
    artifactBundleManifestHash: sha("a"),
    claimType: "bundle_reproducible",
    verifierPersonId: "person:gateway-reviewer",
    assignedAt: "2026-07-13T00:00:10Z",
  });
  await verification.accept("assignment:gateway-discovery", "person:gateway-reviewer", "2026-07-13T00:00:11Z");
  const store = new D1RemoteMcpGatewayStore(database);
  const principal = {
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-reviewer",
    scopes: ["verification:replay"],
  };

  const listed = await store.listReviewAssignments(principal, { status: "accepted", limit: 20 });
  const summary = listed.assignments.find((assignment) => assignment.id === "assignment:gateway-discovery");
  assert.ok(summary);
  assert.equal(summary.target.problemSlug, "gateway-target");
  assert.equal(summary.artifactBundleManifestHash, sha("a"));
  assert.equal(summary.exactAgentReplayCount, 0);
  assert.equal("attemptOwnerPersonId" in summary, false);

  const detail = await store.getReviewAssignment(principal, "assignment:gateway-discovery");
  assert.equal(detail.assignment.id, "assignment:gateway-discovery");
  assert.equal(detail.target.leanStatement, "theorem fixture : True := by trivial");
  assert.deepEqual(detail.bundle.manifest, {});
  assert.equal(detail.events.length, 2);
  assert.deepEqual(detail.replays, []);
  assert.equal("attemptOwnerPersonId" in detail, false);

  await assert.rejects(
    store.listReviewAssignments({ ...principal, scopes: ["verification:write"] }),
    GatewayStoreAuthorizationError,
  );
  await assert.rejects(
    store.getReviewAssignment({
      ...principal,
      personId: "person:gateway-owner",
    }, "assignment:gateway-discovery"),
    GatewayStoreAuthorizationError,
  );
});

test("remote MCP D1 store pins catalog and Attempt work to the selected delegated Agent", async () => {
  const store = new D1RemoteMcpGatewayStore(database);
  const principal = {
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover",
    scopes: ["catalog:read", "attempt:create", "attempt:read", "progress:write"],
  };

  const authority = await store.getConnectionAuthority(principal);
  assert.equal(authority.personId, "person:gateway-reviewer");
  assert.equal(authority.agentId, "agent:gateway-prover");
  assert.equal(authority.agentPublicKey, proverPublicKey);
  assert.equal(authority.delegationCertificateId, "delegation:gateway-prover");
  assert.deepEqual(authority.oauthScopes, principal.scopes);

  const frontier = await store.listFrontier(principal);
  const target = frontier.find((record) => record.slug === "gateway-target");
  assert.ok(target);
  assert.equal(target.source.manifestHash, sha("2"));
  assert.equal((await store.inspectProblem(principal, "gateway-target"))?.declaration.qualifiedName, "gateway-target");

  const created = await store.createAttempt(principal, {
    problemSlug: "gateway-target",
    delegationScope: "prove",
    idempotencyKey: "gateway-prover-attempt",
  });
  assert.equal(created.idempotentReplay, false);
  assert.equal(created.attempt.agentId, "agent:gateway-prover");
  assert.equal(created.attempt.delegationCertificateId, "delegation:gateway-prover");
  assert.equal(created.attempt.events.length, 1);
  await assert.rejects(
    store.createAttempt(
      { ...principal, agentInstallationId: "installation:gateway-reviewer" },
      { problemSlug: "gateway-target", delegationScope: "prove", idempotencyKey: "gateway-reviewer-attempt" },
    ),
    /does not have active prove delegation authority/,
  );
  assert.equal((await store.createAttempt(principal, {
    problemSlug: "gateway-target",
    delegationScope: "prove",
    idempotencyKey: "gateway-prover-attempt",
  })).idempotentReplay, true);

  const authorizedAttempts = await store.listAttempts(principal, { limit: 10 });
  assert.deepEqual(authorizedAttempts.attempts.map((attempt) => attempt.id), [created.attempt.id]);
  assert.equal(authorizedAttempts.verificationState, "agent_reported_only");
  const otherAgentAttempts = await store.listAttempts(
    { ...principal, agentInstallationId: "installation:gateway-reviewer", scopes: ["attempt:read"] },
    { limit: 10 },
  );
  assert.deepEqual(otherAgentAttempts.attempts, []);

  const progress = await store.reportProgress(principal, {
    attemptId: created.attempt.id,
    message: "Pinned the normalized goal state.",
    progressPercent: 35,
    idempotencyKey: "gateway-prover-progress",
  });
  assert.equal(progress.idempotentReplay, false);
  assert.equal(progress.event.type, "agent_reported");
  assert.equal((await store.getAttempt(principal, created.attempt.id)).attempt.events.length, 2);

  const renewedPrincipal = {
    ...principal,
    agentInstallationId: "installation:gateway-prover-renewed",
  };
  const continued = await store.getAttempt(renewedPrincipal, created.attempt.id);
  assert.equal(continued.attempt.id, created.attempt.id);
  assert.equal(continued.attempt.delegationCertificateId, "delegation:gateway-prover");
  assert.equal(continued.attempt.currentDelegationCertificateId, "delegation:gateway-prover-renewed");
  assert.equal(continued.attempt.authorityContinuity, "renewed");
  const renewedProgress = await store.reportProgress(renewedPrincipal, {
    attemptId: created.attempt.id,
    message: "Continued the same durable Attempt under renewed same-Agent authority.",
    progressPercent: 40,
    idempotencyKey: "gateway-prover-renewed-progress",
  });
  assert.equal(renewedProgress.idempotentReplay, false);
  const authorityRows = await database
    .prepare("SELECT delegation_certificate_id FROM attempt_authority_events WHERE attempt_id = ? ORDER BY recorded_at")
    .bind(created.attempt.id)
    .all();
  assert.deepEqual(authorityRows.results.map((row) => row.delegation_certificate_id), ["delegation:gateway-prover-renewed"]);
  const renewedEvents = (await store.getAttempt(renewedPrincipal, created.attempt.id)).attempt.events;
  assert.equal(renewedEvents.filter((event) => event.type === "authority_renewed").length, 1);

  const researchGraph = new D1ResearchGraphStore(database);
  const historical = await researchGraph.importExternalWork("person:gateway-reviewer", {
    problemRevisionId: "revision:gateway",
    sourceSystem: "example.test",
    sourceUrl: "https://example.test/prior-work/v1",
    sourceObjectId: "prior-work",
    sourceRevision: "v1",
    title: "A source-backed prior result",
    contentHash: sha("c"),
    sourceLicense: "CC BY 4.0",
    retrievedAt: "2026-07-15T00:00:00Z",
    contributors: [{
      displayName: "Previous Mathematician",
      persistentIdScheme: null,
      persistentId: null,
      role: "author",
      evidenceUrl: "https://example.test/prior-work/v1",
    }],
  });
  assert.equal(historical.attributionState, "source_asserted");
  const repeatedHistorical = await researchGraph.importExternalWork("person:gateway-reviewer", {
    problemRevisionId: "revision:gateway",
    sourceSystem: "example.test",
    sourceUrl: "https://example.test/prior-work/v1",
    sourceObjectId: "prior-work",
    sourceRevision: "v1",
    title: "A source-backed prior result",
    contentHash: sha("c"),
    sourceLicense: "CC BY 4.0",
    retrievedAt: "2026-07-15T00:00:03Z",
    contributors: [{
      displayName: "Previous Mathematician",
      persistentIdScheme: null,
      persistentId: null,
      role: "author",
      evidenceUrl: "https://example.test/prior-work/v1",
    }],
  });
  assert.equal(repeatedHistorical.created, false);
  assert.equal(repeatedHistorical.externalWork.retrievedAt, "2026-07-15T00:00:00Z");
  const sourceOnlyGraph = await store.inspectResearchGraph(principal, "gateway-target");
  assert.equal(sourceOnlyGraph.graph.externalWorks.length, 1);
  assert.deepEqual(sourceOnlyGraph.graph.externalWorks[0].citedBy, []);

  const firstCheckpoint = await signedResearchCheckpoint({
    id: "research-node:gateway-first",
    eventId: "research-checkpoint-event:gateway-first",
    attemptId: created.attempt.id,
    summary: "Excluded one false direction and preserved the minimal remaining goal.",
    kind: "negative_result",
    citations: [{ externalWorkId: historical.externalWork.id, relation: "builds_on" }],
    occurredAt: "2026-07-15T00:00:01Z",
  });
  const firstPublished = await store.publishResearchCheckpoint(principal, firstCheckpoint);
  assert.equal(firstPublished.created, true);
  assert.equal(firstPublished.node.state, "shared_unverified");
  assert.equal(firstPublished.contributionState, "not_credited");
  assert.equal((await store.publishResearchCheckpoint(principal, firstCheckpoint)).created, false);

  const childCheckpoint = await signedResearchCheckpoint({
    id: "research-node:gateway-child",
    eventId: "research-checkpoint-event:gateway-child",
    attemptId: created.attempt.id,
    summary: "Derived a reusable intermediate lemma from the surviving goal.",
    kind: "lemma",
    parentNodeIds: [firstCheckpoint.id],
    occurredAt: "2026-07-15T00:00:02Z",
  });
  await store.publishResearchCheckpoint(principal, childCheckpoint);
  const checkpointBundleHash = sha("d");
  await database.batch([
    database.prepare(
      "INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)",
    ).bind(checkpointBundleHash, `bundles/sha256/${"d".repeat(64)}/bundle.json`, 2, "application/json"),
    database.prepare(
      `INSERT INTO artifact_bundles (
        id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
        canonical_manifest, agent_event_id, agent_event_payload_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      "bundle:gateway-research-checkpoint",
      created.attempt.id,
      "revision:gateway",
      checkpointBundleHash,
      `bundles/sha256/${"d".repeat(64)}/bundle.json`,
      "{}",
      "agent-event:gateway-research-checkpoint-bundle",
      sha("f"),
    ),
  ]);
  const evidenceCheckpoint = await signedResearchCheckpoint({
    id: "research-node:gateway-evidence",
    eventId: "research-checkpoint-event:gateway-evidence",
    attemptId: created.attempt.id,
    summary: "Bound a proof patch checkpoint to its already staged Artifact Bundle.",
    kind: "proof_patch",
    parentNodeIds: [childCheckpoint.id],
    artifactBundleHash: checkpointBundleHash,
    occurredAt: "2026-07-15T00:00:03Z",
  });
  await store.publishResearchCheckpoint(principal, evidenceCheckpoint);
  const sharedGraph = await store.inspectResearchGraph(principal, "gateway-target");
  assert.deepEqual(sharedGraph.graph.nodes.map((node) => node.id), [firstCheckpoint.id, childCheckpoint.id, evidenceCheckpoint.id]);
  assert.deepEqual(sharedGraph.graph.edges.map((edge) => [edge.parentNodeId, edge.childNodeId]), [
    [firstCheckpoint.id, childCheckpoint.id],
    [childCheckpoint.id, evidenceCheckpoint.id],
  ]);
  assert.equal(sharedGraph.graph.nodes[0].evidence.stage, "shared");
  assert.equal(sharedGraph.graph.nodes[2].evidence.stage, "bundle_staged");
  assert.equal(sharedGraph.graph.nodes[2].evidence.bundle.manifestHash, checkpointBundleHash);
  assert.deepEqual(sharedGraph.graph.externalWorks[0].citedBy, [{ nodeId: firstCheckpoint.id, relation: "builds_on" }]);
  assert.equal((await store.getAttempt(principal, created.attempt.id)).attempt.events.filter((event) => event.type === "checkpoint_published").length, 3);

  await assert.rejects(
    store.getAttempt(
      { ...principal, agentInstallationId: "installation:gateway-reviewer", scopes: ["attempt:read"] },
      created.attempt.id,
    ),
    GatewayStoreNotFoundError,
  );
});

test("a verified OAuth token reaches the review-attestation D1 boundary through MCP", async () => {
  const verification = new D1VerificationStore(database);
  await verification.assign({
    id: "assignment:gateway-mcp",
    artifactBundleManifestHash: sha("a"),
    claimType: "statement_faithful",
    verifierPersonId: "person:gateway-reviewer",
    assignedAt: "2026-07-13T00:00:04Z",
  });
  await verification.accept("assignment:gateway-mcp", "person:gateway-reviewer", "2026-07-13T00:00:05Z");

  const resource = "https://mcp.gateway.example.test/mcp";
  const accessToken = "pw_at_gateway_review_fixture";
  const oauthStore = new D1ProofweaveOAuthStore(database);
  await oauthStore.issueTokenPair({
    accessTokenHash: await tokenHash(accessToken),
    refreshTokenHash: await tokenHash("pw_rt_gateway_review_fixture"),
    clientId: "client:gateway-codex",
    resource,
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-reviewer",
    scopes: ["verification:write"],
    issuedAt: "2026-07-13T00:00:00Z",
    accessExpiresAt: "2027-07-13T00:00:00Z",
    refreshExpiresAt: "2027-08-13T00:00:00Z",
  });
  const gateway = boundGateway({ resource, issuer: "https://auth.gateway.example.test" });
  const attestation = await signedAttestation({
    id: "attestation:gateway-mcp",
    assignmentId: "assignment:gateway-mcp",
    claimType: "statement_faithful",
    attestedAt: "2026-07-13T00:00:06Z",
  });
  const response = await gateway.fetch(new Request(resource, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "submit_verification_attestation", arguments: { attestation } },
    }),
  }));
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.isError, undefined);
  assert.match(payload.result.content[0].text, /attestation:gateway-mcp/);
  assert.equal((await verification.requireAssignment("assignment:gateway-mcp")).status, "completed");
});

test("a verified OAuth token reaches catalog and Attempt D1 boundaries through MCP", async () => {
  const resource = "https://mcp.gateway.example.test/mcp";
  const accessToken = "pw_at_gateway_prover_fixture";
  const oauthStore = new D1ProofweaveOAuthStore(database);
  await oauthStore.issueTokenPair({
    accessTokenHash: await tokenHash(accessToken),
    refreshTokenHash: await tokenHash("pw_rt_gateway_prover_fixture"),
    clientId: "client:gateway-codex",
    resource,
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover",
    scopes: ["catalog:read", "attempt:create", "attempt:read", "progress:write"],
    issuedAt: "2026-07-13T00:00:00Z",
    accessExpiresAt: "2027-07-13T00:00:00Z",
    refreshExpiresAt: "2027-08-13T00:00:00Z",
  });
  const gateway = createD1RemoteMcpGatewayRuntime({
    resource,
    issuer: "https://auth.gateway.example.test",
    database,
    bucket: artifactBucket,
    operationMode: "read_write",
  });
  const listed = await callGatewayTool(gateway, resource, accessToken, "list_frontier_problems", {});
  assert.equal(listed.result.isError, undefined);
  assert.match(listed.result.content[0].text, /gateway-target/);

  const created = await callGatewayTool(gateway, resource, accessToken, "create_attempt", {
    problemSlug: "gateway-target",
    delegationScope: "prove",
    idempotencyKey: "gateway-mcp-prover-attempt",
  });
  assert.equal(created.result.isError, undefined);
  const attemptId = JSON.parse(created.result.content[0].text).attempt.id;

  const listedAttempts = await callGatewayTool(gateway, resource, accessToken, "list_attempts", { limit: 10 });
  assert.equal(listedAttempts.result.isError, undefined);
  assert.equal(
    JSON.parse(listedAttempts.result.content[0].text).attempts.some((attempt) => attempt.id === attemptId),
    true,
  );

  const progress = await callGatewayTool(gateway, resource, accessToken, "report_progress", {
    attemptId,
    message: "Reported through the remote OAuth-bound MCP path.",
    progressPercent: 60,
    idempotencyKey: "gateway-mcp-prover-progress",
  });
  assert.equal(progress.result.isError, undefined);
  const loaded = await callGatewayTool(gateway, resource, accessToken, "get_attempt", { attemptId });
  assert.equal(JSON.parse(loaded.result.content[0].text).attempt.events.length, 2);
});

test("a prove-delegated OAuth Agent stages a signed v2 Bundle and requests one idempotent Runner Queue Run through MCP", async () => {
  const resource = "https://mcp.gateway.example.test/mcp";
  const accessToken = "pw_at_gateway_artifact_fixture";
  const oauthStore = new D1ProofweaveOAuthStore(database);
  await oauthStore.issueTokenPair({
    accessTokenHash: await tokenHash(accessToken),
    refreshTokenHash: await tokenHash("pw_rt_gateway_artifact_fixture"),
    clientId: "client:gateway-codex",
    resource,
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover",
    scopes: ["attempt:create", "artifact:write", "run:request", "run:read", "run:cancel"],
    issuedAt: "2026-07-13T00:00:00Z",
    accessExpiresAt: "2027-07-13T00:00:00Z",
    refreshExpiresAt: "2027-08-13T00:00:00Z",
  });
  const runnerQueue = {
    messages: [],
    async enqueue(message) {
      this.messages.push(message);
      return { message, created: true, deliveryState: "queued" };
    },
  };
  const gateway = createD1RemoteMcpGatewayRuntime({
    resource,
    issuer: "https://auth.gateway.example.test",
    database,
    bucket: artifactBucket,
    operationMode: "read_write",
    runnerQueue,
    runnerApprovedImagesJson: JSON.stringify([{
      imageDigest: `registry.example.test/proofweave/lean@sha256:${"f".repeat(64)}`,
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "gateway-fixture",
    }]),
    runnerControlPlaneKeyId: "runner-control:gateway",
    runnerControlPlanePrivateKeyJwkJson: controlPlanePrivateKeyJwkJson,
    runnerDefaultLimitsJson: JSON.stringify({
      cpuSeconds: 60,
      wallSeconds: 120,
      memoryMiB: 2_048,
      diskMiB: 2_048,
      outputBytes: 1_000_000,
    }),
  });
  const created = await callGatewayTool(gateway, resource, accessToken, "create_attempt", {
    problemSlug: "gateway-target",
    delegationScope: "prove",
    idempotencyKey: "gateway-artifact-prover-attempt",
  });
  const attemptId = JSON.parse(created.result.content[0].text).attempt.id;

  const archive = await stageArtifactObject(gateway, resource, accessToken, attemptId, {
    filename: "source.tar.zst",
    contentType: "application/zstd",
    content: "gateway fixture archive",
  });
  const patch = await stageArtifactObject(gateway, resource, accessToken, attemptId, {
    filename: "normalized.patch",
    contentType: "text/x-diff",
    content: "diff --git a/Proofweave/Gateway.lean b/Proofweave/Gateway.lean\n",
  });
  const lakeManifest = await stageArtifactObject(gateway, resource, accessToken, attemptId, {
    filename: "lake-manifest.json",
    contentType: "application/json",
    content: "{\"packages\":[]}",
  });
  const bundle = await signedBundleV2({ attemptId, archive, patch, lakeManifest });
  const staged = await callGatewayTool(gateway, resource, accessToken, "stage_artifact_bundle", { bundle });
  assert.equal(staged.result.isError, undefined);
  const first = JSON.parse(staged.result.content[0].text);
  assert.equal(first.created, true);
  assert.equal(first.storageState, "bundle_staged_only");
  assert.equal(first.verificationState, "not_verified");

  const stageReplay = await callGatewayTool(gateway, resource, accessToken, "stage_artifact_bundle", { bundle });
  const second = JSON.parse(stageReplay.result.content[0].text);
  assert.equal(second.created, false);
  const loaded = await new D1RemoteMcpGatewayStore({ database, bucket: artifactBucket }).getAttempt({
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover",
    scopes: ["attempt:read"],
  }, attemptId);
  assert.equal(loaded.attempt.events.filter((event) => event.type === "bundle_staged").length, 1);
  assert.match(loaded.attempt.events.at(-1)?.message ?? "", /awaits a separate isolated runner and review/);

  const withoutRunner = createD1RemoteMcpGatewayRuntime({
    resource,
    issuer: "https://auth.gateway.example.test",
    database,
    bucket: artifactBucket,
    operationMode: "read_write",
  });
  const unavailable = await callGatewayTool(withoutRunner, resource, accessToken, "request_runner_run", {
    attemptId,
    artifactBundleHash: first.bundle.manifestHash,
    idempotencyKey: "gateway-artifact-run-unconfigured",
  });
  assert.equal(unavailable.result.isError, true);
  assert.match(unavailable.result.content[0].text, /isolated Lean Runner dispatch is not configured/);

  const dispatched = await callGatewayTool(gateway, resource, accessToken, "request_runner_run", {
    attemptId,
    artifactBundleHash: first.bundle.manifestHash,
    idempotencyKey: "gateway-artifact-run",
  });
  assert.equal(dispatched.result.isError, undefined);
  const run = JSON.parse(dispatched.result.content[0].text);
  assert.equal(run.runCreated, true);
  assert.equal(run.run.state, "queued");
  assert.equal(run.queueDeliveryState, "queued");
  assert.equal(run.verificationState, "not_verified");
  assert.equal(runnerQueue.messages.length, 1);
  assert.equal(runnerQueue.messages[0].request.attemptId, attemptId);
  assert.equal(runnerQueue.messages[0].request.bundle.manifestHash, first.bundle.manifestHash);

  const replay = await callGatewayTool(gateway, resource, accessToken, "request_runner_run", {
    attemptId,
    artifactBundleHash: first.bundle.manifestHash,
    idempotencyKey: "gateway-artifact-run",
  });
  const replayRun = JSON.parse(replay.result.content[0].text);
  assert.equal(replayRun.runCreated, false);
  assert.equal(replayRun.run.id, run.run.id);
  assert.equal(runnerQueue.messages.length, 2);

  const visible = await callGatewayTool(gateway, resource, accessToken, "get_runner_run", {
    attemptId,
    runId: run.run.id,
  });
  assert.equal(visible.result.isError, undefined);
  const visibleRun = JSON.parse(visible.result.content[0].text);
  assert.equal(visibleRun.run.id, run.run.id);
  assert.equal(visibleRun.run.state, "queued");
  assert.deepEqual(visibleRun.events.map((event) => event.eventType), ["run_queued"]);
  assert.equal(visibleRun.verificationState, "not_verified");

  const alternateProverAccessToken = "pw_at_gateway_alternate_prover_run_fixture";
  await oauthStore.issueTokenPair({
    accessTokenHash: await tokenHash(alternateProverAccessToken),
    refreshTokenHash: await tokenHash("pw_rt_gateway_alternate_prover_run_fixture"),
    clientId: "client:gateway-codex",
    resource,
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover-alt",
    scopes: ["run:read"],
    issuedAt: "2026-07-13T00:00:00Z",
    accessExpiresAt: "2027-07-13T00:00:00Z",
    refreshExpiresAt: "2027-08-13T00:00:00Z",
  });
  const hiddenFromOtherAgent = await callGatewayTool(gateway, resource, alternateProverAccessToken, "get_runner_run", {
    attemptId,
    runId: run.run.id,
  });
  assert.equal(hiddenFromOtherAgent.result.isError, true);
  assert.match(hiddenFromOtherAgent.result.content[0].text, /Attempt not found/);

  const cancelled = await callGatewayTool(gateway, resource, accessToken, "cancel_runner_run", {
    attemptId,
    runId: run.run.id,
  });
  assert.equal(cancelled.result.isError, undefined);
  const cancelledRun = JSON.parse(cancelled.result.content[0].text);
  assert.equal(cancelledRun.run.state, "cancelled");
  assert.equal(cancelledRun.cancellationState, "cancelled_before_execution");
  assert.equal(cancelledRun.verificationState, "not_verified");
  const firstCancelledAt = cancelledRun.run.cancelRequestedAt;

  const cancellationReplay = await callGatewayTool(gateway, resource, accessToken, "cancel_runner_run", {
    attemptId,
    runId: run.run.id,
  });
  const replayCancelledRun = JSON.parse(cancellationReplay.result.content[0].text);
  assert.equal(replayCancelledRun.run.state, "cancelled");
  assert.equal(replayCancelledRun.run.cancelRequestedAt, firstCancelledAt);

  const afterCancellation = await callGatewayTool(gateway, resource, accessToken, "get_runner_run", {
    attemptId,
    runId: run.run.id,
  });
  const afterCancellationRun = JSON.parse(afterCancellation.result.content[0].text);
  assert.deepEqual(afterCancellationRun.events.map((event) => event.eventType), ["run_queued", "run_cancelled"]);
});

test("an accepted independent reviewer can queue and read only a fresh replay of the assigned Bundle", async () => {
  const artifacts = new D1R2ArtifactStore({ database, bucket: artifactBucket });
  const [archive, patch, lakeManifest] = await Promise.all([
    artifacts.putObject({ bytes: "replay fixture archive", filename: "source.tar.zst", contentType: "application/zstd" }),
    artifacts.putObject({ bytes: "diff --git a/Proofweave/Replay.lean b/Proofweave/Replay.lean\n", filename: "normalized.patch", contentType: "text/x-diff" }),
    artifacts.putObject({ bytes: "{\"packages\":[]}", filename: "lake-manifest.json", contentType: "application/json" }),
  ]);
  const bundle = await signedBundleV2({
    attemptId: "attempt:gateway-owner-replay",
    archive,
    patch,
    lakeManifest,
    agentPublicKey: ownerProverPublicKey,
    agentPrivateKey: ownerProverKeyPair.privateKey,
  });
  const staged = await artifacts.stageBundle(bundle);
  const verification = new D1VerificationStore(database);
  await verification.assign({
    id: "assignment:gateway-fresh-replay",
    artifactBundleManifestHash: staged.bundle.manifestHash,
    claimType: "bundle_reproducible",
    verifierPersonId: "person:gateway-reviewer",
    assignedAt: "2026-07-13T00:00:20Z",
  });
  await verification.accept(
    "assignment:gateway-fresh-replay",
    "person:gateway-reviewer",
    "2026-07-13T00:00:21Z",
  );

  const resource = "https://mcp.gateway.example.test/mcp";
  const accessToken = "pw_at_gateway_verification_replay_fixture";
  const oauthStore = new D1ProofweaveOAuthStore(database);
  await oauthStore.issueTokenPair({
    accessTokenHash: await tokenHash(accessToken),
    refreshTokenHash: await tokenHash("pw_rt_gateway_verification_replay_fixture"),
    clientId: "client:gateway-codex",
    resource,
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-reviewer",
    scopes: ["verification:replay"],
    issuedAt: "2026-07-13T00:00:00Z",
    accessExpiresAt: "2027-07-13T00:00:00Z",
    refreshExpiresAt: "2027-08-13T00:00:00Z",
  });
  const runnerQueue = { messages: [], async send(message) { this.messages.push(message); } };
  const gateway = createD1RemoteMcpGatewayRuntime({
    resource,
    issuer: "https://auth.gateway.example.test",
    database,
    bucket: artifactBucket,
    operationMode: "read_write",
    runnerQueue,
    runnerApprovedImagesJson: JSON.stringify([{
      imageDigest: `registry.example.test/proofweave/lean@sha256:${"f".repeat(64)}`,
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "gateway-fixture",
    }]),
    runnerControlPlaneKeyId: "runner-control:gateway",
    runnerControlPlanePrivateKeyJwkJson: controlPlanePrivateKeyJwkJson,
    runnerDefaultLimitsJson: JSON.stringify({
      cpuSeconds: 60,
      wallSeconds: 120,
      memoryMiB: 2_048,
      diskMiB: 2_048,
      outputBytes: 1_000_000,
    }),
  });

  const ownerRunAttempt = await callGatewayTool(gateway, resource, accessToken, "request_runner_run", {
    attemptId: bundle.attemptId,
    artifactBundleHash: staged.bundle.manifestHash,
    idempotencyKey: "must-not-be-authorized",
  });
  assert.equal(ownerRunAttempt.result.isError, true);
  assert.match(ownerRunAttempt.result.content[0].text, /Missing OAuth scope: run:request/);

  const first = await callGatewayTool(gateway, resource, accessToken, "request_verification_replay", {
    assignmentId: "assignment:gateway-fresh-replay",
    idempotencyKey: "reviewer-fresh-workspace-1",
  });
  assert.equal(first.result.isError, undefined);
  const firstReplay = JSON.parse(first.result.content[0].text);
  assert.equal(firstReplay.runCreated, true);
  assert.equal(firstReplay.run.attemptId, bundle.attemptId);
  assert.equal(firstReplay.replay.assignmentId, "assignment:gateway-fresh-replay");
  assert.equal(firstReplay.replay.requesterPersonId, "person:gateway-reviewer");
  assert.equal(firstReplay.replay.requesterAgentId, "agent:gateway-reviewer");
  assert.equal(firstReplay.replay.artifactBundleManifestHash, staged.bundle.manifestHash);
  assert.equal(firstReplay.verificationState, "fresh_replay_recorded");
  assert.equal(runnerQueue.messages.length, 1);
  assert.equal(runnerQueue.messages[0].request.attemptId, bundle.attemptId);
  assert.equal(runnerQueue.messages[0].request.bundle.manifestHash, staged.bundle.manifestHash);

  const duplicate = await callGatewayTool(gateway, resource, accessToken, "request_verification_replay", {
    assignmentId: "assignment:gateway-fresh-replay",
    idempotencyKey: "reviewer-fresh-workspace-1",
  });
  const duplicateReplay = JSON.parse(duplicate.result.content[0].text);
  assert.equal(duplicateReplay.runCreated, false);
  assert.equal(duplicateReplay.run.id, firstReplay.run.id);
  assert.equal(runnerQueue.messages.length, 1);

  const visible = await callGatewayTool(gateway, resource, accessToken, "get_verification_replay", {
    assignmentId: "assignment:gateway-fresh-replay",
    idempotencyKey: "reviewer-fresh-workspace-1",
  });
  assert.equal(visible.result.isError, undefined);
  const visibleReplay = JSON.parse(visible.result.content[0].text);
  assert.equal(visibleReplay.run.id, firstReplay.run.id);
  assert.deepEqual(visibleReplay.events.map((event) => event.eventType), ["run_queued"]);
});

test("remote MCP capacity is shared by every Agent owned by the same Person", async () => {
  const active = await database
    .prepare("SELECT COUNT(*) AS count FROM agent_attempts WHERE person_id = ? AND status = 'active'")
    .bind("person:gateway-reviewer")
    .first();
  const remaining = Math.max(0, closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson - Number(active?.count ?? 0));
  for (let index = 0; index < remaining; index += 1) {
    await database
      .prepare(
        `INSERT INTO agent_attempts (
          id, person_id, problem_revision_id, agent_id, agent_label,
          delegation_certificate_id, delegation_scope, idempotency_key, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `attempt:gateway-capacity-${index}`,
        "person:gateway-reviewer",
        "revision:gateway",
        "agent:gateway-prover",
        "Gateway prover Agent",
        "delegation:gateway-prover",
        "prove",
        `gateway-capacity-${index}`,
        "2026-07-13T00:00:00Z",
      )
      .run();
  }

  const store = new D1RemoteMcpGatewayStore(database);
  const principal = {
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover",
    scopes: ["attempt:create"],
  };
  await assert.rejects(
    store.createAttempt(principal, {
      problemSlug: "gateway-target",
      delegationScope: "prove",
      idempotencyKey: "gateway-capacity-exhausted",
    }),
    GatewayStoreRateLimitError,
  );
});

async function signedAttestation({
  id = "attestation:gateway-review",
  assignmentId = "assignment:gateway-review",
  claimType = "kernel_accepted",
  attestedAt = "2026-07-13T00:00:02Z",
  evidenceHash = sha("b"),
} = {}) {
  const attestation = {
    protocolVersion: "pw-verification-attestation-v1",
    id,
    assignmentId,
    artifactBundleHash: sha("a"),
    claimType,
    verifierPersonId: "person:gateway-reviewer",
    verifierAgentId: "agent:gateway-reviewer",
    delegationCertificateId: "delegation:gateway-reviewer",
    verifierAgentPublicKey: reviewerPublicKey,
    decision: "attested",
    evidenceHash,
    attestedAt,
    payloadHash: sha("0"),
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
  attestation.payloadHash = await verificationAttestationPayloadHash(attestation);
  attestation.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    reviewerKeyPair.privateKey,
    new TextEncoder().encode(canonicalJson(verificationAttestationSigningPayload(attestation))),
  ));
  return attestation;
}

async function seedGatewayFixture(d1, { reviewerPublicKey, proverPublicKey, ownerProverPublicKey, alternateProverPublicKey }) {
  const statements = [
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:gateway-owner", "proofweave", "gateway-owner", "Gateway owner", "2026-07-01T00:00:00Z"]],
    ["INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)", ["person:gateway-reviewer", "proofweave", "gateway-reviewer", "Gateway reviewer", "2026-07-01T00:00:00Z"]],
    [
      `INSERT INTO source_snapshots (id, upstream_name, source_url, revision_tag, revision_commit, retrieved_at, content_hash, manifest_hash, source_license, lean_toolchain, mathlib_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["snapshot:gateway", "fixture", "https://example.test/source", "v1", "gateway", "2026-07-01T00:00:00Z", sha("1"), sha("2"), "MIT", "leanprover/lean4:v4.27.0", "gateway"],
    ],
    ["INSERT INTO projects (id, slug, kind, title, summary) VALUES (?, ?, ?, ?, ?)", ["project:gateway", "gateway", "frontier", "Gateway", "Fixture"]],
    [
      `INSERT INTO problem_revisions (id, project_id, source_snapshot_id, target_key, slug, revision_number, title, domain, research_status, informal_statement, lean_statement)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["revision:gateway", "project:gateway", "snapshot:gateway", "gateway-target", "gateway-target", 1, "Gateway target", "logic", "research_open", "fixture", "theorem fixture : True := by trivial"],
    ],
    ["INSERT INTO agent_attempts (id, person_id, problem_revision_id, agent_label, idempotency_key, updated_at) VALUES (?, ?, ?, ?, ?, ?)", ["attempt:gateway", "person:gateway-owner", "revision:gateway", "Gateway owner Agent", "attempt-gateway", "2026-07-01T00:00:00Z"]],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [sha("a"), `bundles/sha256/${"a".repeat(64)}/bundle.json`, 2, "application/json"]],
    ["INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)", [sha("b"), `bundles/sha256/${"b".repeat(64)}/review.json`, 2, "application/json"]],
    [
      `INSERT INTO artifact_bundles (id, attempt_id, problem_revision_id, manifest_hash, manifest_key, canonical_manifest, agent_event_id, agent_event_payload_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["bundle:gateway", "attempt:gateway", "revision:gateway", sha("a"), `bundles/sha256/${"a".repeat(64)}/bundle.json`, "{}", "agent-event:gateway", sha("3")],
    ],
    ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", ["person-key:gateway-reviewer", "person:gateway-reviewer", "person-key", sha("4")]],
    ["INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)", ["person-key:gateway-owner", "person:gateway-owner", ownerProverPublicKey, sha("e")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:gateway-reviewer", "person:gateway-reviewer", "Gateway reviewer Agent", reviewerPublicKey, sha("5")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:gateway-owner-prover", "person:gateway-owner", "Gateway owner prover Agent", ownerProverPublicKey, sha("6")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:gateway-prover", "person:gateway-reviewer", "Gateway prover Agent", proverPublicKey, sha("7")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:gateway-prover-alt", "person:gateway-reviewer", "Gateway alternate prover Agent", alternateProverPublicKey, sha("9")]],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:gateway-owner-prover", "person:gateway-owner", "agent:gateway-owner-prover", "person-key:gateway-owner", ownerProverPublicKey, '["formalize","prove"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:gateway-owner", "pw-delegation-v1", sha("b"), "{}", "signature"],
    ],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:gateway-reviewer", "person:gateway-reviewer", "agent:gateway-reviewer", "person-key:gateway-reviewer", reviewerPublicKey, '["review"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:gateway-reviewer", "pw-delegation-v1", sha("6"), "{}", "signature"],
    ],
    [
      `INSERT INTO agent_attempts (
        id, person_id, problem_revision_id, agent_id, agent_label,
        delegation_certificate_id, delegation_scope, idempotency_key, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["attempt:gateway-owner-replay", "person:gateway-owner", "revision:gateway", "agent:gateway-owner-prover", "Gateway owner prover Agent", "delegation:gateway-owner-prover", "prove", "gateway-owner-replay", "2026-07-01T00:00:00Z"],
    ],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:gateway-prover", "person:gateway-reviewer", "agent:gateway-prover", "person-key:gateway-reviewer", proverPublicKey, '["formalize","prove"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:gateway-reviewer", "pw-delegation-v1", sha("8"), "{}", "signature"],
    ],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:gateway-prover-renewed", "person:gateway-reviewer", "agent:gateway-prover", "person-key:gateway-reviewer", proverPublicKey, '["formalize","prove"]', "2026-07-02T00:00:00Z", "2027-07-02T00:00:00Z", "person:gateway-reviewer", "pw-delegation-v1", sha("d"), "{}", "signature"],
    ],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:gateway-prover-alt", "person:gateway-reviewer", "agent:gateway-prover-alt", "person-key:gateway-reviewer", alternateProverPublicKey, '["formalize","prove"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:gateway-reviewer", "pw-delegation-v1", sha("a"), "{}", "signature"],
    ],
    ["INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)", ["client:gateway-codex", "Gateway Codex", '["https://codex.example.test/callback"]']],
    [
      `INSERT INTO agent_installations (id, person_id, agent_id, delegation_certificate_id, client_id, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["installation:gateway-reviewer", "person:gateway-reviewer", "agent:gateway-reviewer", "delegation:gateway-reviewer", "client:gateway-codex", "Gateway Codex"],
    ],
    [
      `INSERT INTO agent_installations (id, person_id, agent_id, delegation_certificate_id, client_id, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["installation:gateway-prover", "person:gateway-reviewer", "agent:gateway-prover", "delegation:gateway-prover", "client:gateway-codex", "Gateway prover Codex"],
    ],
    [
      `INSERT INTO agent_installations (id, person_id, agent_id, delegation_certificate_id, client_id, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["installation:gateway-prover-renewed", "person:gateway-reviewer", "agent:gateway-prover", "delegation:gateway-prover-renewed", "client:gateway-codex", "Gateway renewed prover Codex"],
    ],
    [
      `INSERT INTO agent_installations (id, person_id, agent_id, delegation_certificate_id, client_id, label)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["installation:gateway-prover-alt", "person:gateway-reviewer", "agent:gateway-prover-alt", "delegation:gateway-prover-alt", "client:gateway-codex", "Gateway alternate prover Codex"],
    ],
  ];
  for (const [statement, values] of statements) await d1.prepare(statement).bind(...values).run();
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

async function tokenHash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function callGatewayTool(gateway, resource, accessToken, name, arguments_) {
  const response = await gateway.fetch(new Request(resource, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: arguments_ },
    }),
  }));
  assert.equal(response.status, 200);
  return response.json();
}

function boundGateway({ resource, issuer }) {
  return {
    fetch(request) {
      return cloudflareGatewayWorker.fetch(request, {
        DB: database,
        ARTIFACTS: artifactBucket,
        MCP_RESOURCE_URL: resource,
        OAUTH_ISSUER_URL: issuer,
        PROOFWEAVE_CONTROL_PLANE_MODE: "read_write",
        PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "read_write",
      });
    },
  };
}

async function stageArtifactObject(gateway, resource, accessToken, attemptId, { filename, contentType, content }) {
  const response = await callGatewayTool(gateway, resource, accessToken, "put_artifact_object", {
    attemptId,
    filename,
    contentType,
    contentBase64Url: base64Url(new TextEncoder().encode(content)),
  });
  assert.equal(response.result.isError, undefined);
  const result = JSON.parse(response.result.content[0].text);
  assert.equal(result.storageState, "object_staged_only");
  return result.object;
}

async function signedBundleV2({ attemptId, archive, patch, lakeManifest, agentPublicKey = proverPublicKey, agentPrivateKey = proverKeyPair.privateKey }) {
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v2",
    id: `bundle:gateway-artifact-${attemptId.slice("attempt:".length)}`,
    attemptId,
    problemRevisionId: "revision:gateway",
    target: { declaration: "Proofweave.Gateway.Target", statementHash: sha("c") },
    workspace: {
      archive: {
        objectKey: archive.objectKey,
        contentHash: archive.contentHash,
        format: "tar.zst",
        maxExpandedBytes: 64 * 1024 * 1024,
        maxFileCount: 10_000,
        symlinkPolicy: "forbidden",
      },
      patch: {
        objectKey: patch.objectKey,
        contentHash: patch.contentHash,
        format: "unified-diff",
        strip: 1,
        allowFuzz: false,
      },
      tree: {
        hash: sha("d"),
        algorithm: "pw-tree-v1",
        state: "after_patch_and_lake_manifest",
      },
      lakeManifest: {
        objectKey: lakeManifest.objectKey,
        contentHash: lakeManifest.contentHash,
        destination: "lake-manifest.json",
      },
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "gateway-fixture",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Gateway.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: `agent-event:gateway-artifact-${attemptId.slice("attempt:".length)}`,
      occurredAt: "2026-07-13T00:00:00Z",
      payloadHash: sha("0"),
      agentPublicKey,
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    agentPrivateKey,
    new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
  ));
  return bundle;
}

async function signedResearchCheckpoint({
  id,
  eventId,
  attemptId,
  summary,
  kind,
  parentNodeIds = [],
  citations = [],
  artifactBundleHash = null,
  occurredAt,
}) {
  const checkpoint = {
    protocolVersion: "pw-research-checkpoint-v1",
    id,
    attemptId,
    problemRevisionId: "revision:gateway",
    kind,
    summary,
    parentNodeIds,
    proofStateHash: null,
    artifactBundleHash,
    citations,
    agentEvent: {
      id: eventId,
      agentId: "agent:gateway-prover",
      agentPublicKey: proverPublicKey,
      occurredAt,
      signature: "A".repeat(86),
    },
    payloadHash: sha("0"),
  };
  checkpoint.payloadHash = await researchCheckpointPayloadHash(checkpoint);
  checkpoint.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    proverKeyPair.privateKey,
    new TextEncoder().encode(canonicalJson(researchCheckpointSigningPayload(checkpoint))),
  ));
  return checkpoint;
}
