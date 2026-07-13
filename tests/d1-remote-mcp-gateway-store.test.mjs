import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  D1RemoteMcpGatewayStore,
  GatewayStoreAuthorizationError,
  GatewayStoreNotFoundError,
} from "../services/proofweave-mcp-gateway/d1-gateway-store.mjs";
import { createD1RemoteMcpGatewayRuntime } from "../services/proofweave-mcp-gateway/runtime.mjs";
import cloudflareGatewayWorker from "../services/proofweave-mcp-gateway/cloudflare-worker.mjs";
import { D1ProofweaveOAuthStore } from "../services/proofweave-identity/d1-oauth-store.mjs";
import { D1VerificationStore } from "../services/verification/d1-verification-store.mjs";
import {
  verificationAttestationPayloadHash,
  verificationAttestationSigningPayload,
} from "../packages/protocol/verification-attestation.mjs";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let reviewerKeyPair;
let reviewerPublicKey;
let proverKeyPair;
let proverPublicKey;
let artifactBucket;

before(async () => {
  reviewerKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  reviewerPublicKey = base64Url(await crypto.subtle.exportKey("raw", reviewerKeyPair.publicKey));
  proverKeyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  proverPublicKey = base64Url(await crypto.subtle.exportKey("raw", proverKeyPair.publicKey));
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
  await seedGatewayFixture(database, { reviewerPublicKey, proverPublicKey });
});

after(async () => {
  await miniflare?.dispose();
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

  const store = new D1RemoteMcpGatewayStore(database);
  const principal = {
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-reviewer",
    scopes: ["catalog:read", "verification:write"],
  };
  const attestation = await signedAttestation();
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

test("remote MCP D1 store pins catalog and Attempt work to the selected delegated Agent", async () => {
  const store = new D1RemoteMcpGatewayStore(database);
  const principal = {
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover",
    scopes: ["catalog:read", "attempt:create", "attempt:read", "progress:write"],
  };

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

test("a prove-delegated OAuth Agent stages immutable objects and a signed v2 Bundle through MCP", async () => {
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
    scopes: ["attempt:create", "artifact:write"],
    issuedAt: "2026-07-13T00:00:00Z",
    accessExpiresAt: "2027-07-13T00:00:00Z",
    refreshExpiresAt: "2027-08-13T00:00:00Z",
  });
  const gateway = createD1RemoteMcpGatewayRuntime({
    resource,
    issuer: "https://auth.gateway.example.test",
    database,
    bucket: artifactBucket,
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

  const replay = await callGatewayTool(gateway, resource, accessToken, "stage_artifact_bundle", { bundle });
  const second = JSON.parse(replay.result.content[0].text);
  assert.equal(second.created, false);
  const loaded = await new D1RemoteMcpGatewayStore({ database, bucket: artifactBucket }).getAttempt({
    clientId: "client:gateway-codex",
    personId: "person:gateway-reviewer",
    agentInstallationId: "installation:gateway-prover",
    scopes: ["attempt:read"],
  }, attemptId);
  assert.equal(loaded.attempt.events.filter((event) => event.type === "bundle_staged").length, 1);
  assert.match(loaded.attempt.events.at(-1)?.message ?? "", /awaits a separate isolated runner and review/);
});

async function signedAttestation({
  id = "attestation:gateway-review",
  assignmentId = "assignment:gateway-review",
  claimType = "kernel_accepted",
  attestedAt = "2026-07-13T00:00:02Z",
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
    evidenceHash: sha("b"),
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

async function seedGatewayFixture(d1, { reviewerPublicKey, proverPublicKey }) {
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
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:gateway-reviewer", "person:gateway-reviewer", "Gateway reviewer Agent", reviewerPublicKey, sha("5")]],
    ["INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)", ["agent:gateway-prover", "person:gateway-reviewer", "Gateway prover Agent", proverPublicKey, sha("7")]],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:gateway-reviewer", "person:gateway-reviewer", "agent:gateway-reviewer", "person-key:gateway-reviewer", reviewerPublicKey, '["review"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:gateway-reviewer", "pw-delegation-v1", sha("6"), "{}", "signature"],
    ],
    [
      `INSERT INTO delegation_certificates (id, owner_person_id, agent_id, person_key_id, agent_public_key, scopes_json, valid_from, valid_until, beneficiary_person_id, protocol_version, payload_hash, canonical_payload, person_signature)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["delegation:gateway-prover", "person:gateway-reviewer", "agent:gateway-prover", "person-key:gateway-reviewer", proverPublicKey, '["formalize","prove"]', "2026-07-01T00:00:00Z", "2027-07-01T00:00:00Z", "person:gateway-reviewer", "pw-delegation-v1", sha("8"), "{}", "signature"],
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

async function signedBundleV2({ attemptId, archive, patch, lakeManifest }) {
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
      agentPublicKey: proverPublicKey,
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    proverKeyPair.privateKey,
    new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
  ));
  return bundle;
}
