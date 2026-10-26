import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Miniflare } from "miniflare";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { delegationSigningPayload } from "../packages/domain/delegation.mjs";
import { personKeyProofChallengeSigningPayload } from "../packages/protocol/person-key-proof.mjs";
const workerRoot = new URL("../dist/server/", import.meta.url);
const migrationsRoot = new URL("../drizzle/", import.meta.url);
const authHeaders = { cookie: "__Host-pw_session=connection-isolated-test-session" };
test("real Worker pairs an Agent while research is frozen, then revokes its tokens", async (t) => {
  const normalWorker = await createWorker();
  t.after(() => normalWorker.dispose());
  const database = await normalWorker.getD1Database("DB");
  await applyMigrations(database);
  await seedAccount(database);
  const before = await researchCounts(database);
  const agentKeys = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const agentPublicKey = base64Url(
    await crypto.subtle.exportKey("raw", agentKeys.publicKey),
  );
  const agentId = `urn:pw:agent:ordinary-${crypto.randomUUID()}`;
  const codeVerifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const codeChallenge = base64Url(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(codeVerifier),
    ),
  );

  const pairingResponse = await requestJson(normalWorker, "/api/connect/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.201",
    },
    body: JSON.stringify({
      agentId,
      agentLabel: "Ordinary user Agent",
      agentPublicKey,
      oauthState: "ordinary-user-oauth-state",
      codeChallenge,
      connectionMode: "research",
    }),
  });
  assert.equal(pairingResponse.response.status, 201);
  const pairingUrl = new URL(pairingResponse.body.connectionUrl);
  const pairingId = pairingUrl.searchParams.get("pairing");
  const pairingSecret = pairingUrl.searchParams.get("secret");
  assert.equal(typeof pairingId, "string");
  assert.equal(typeof pairingSecret, "string");

  const pairingStatus = await requestJson(
    normalWorker,
    `/api/connect/sessions/${encodeURIComponent(pairingId)}?secret=${encodeURIComponent(pairingSecret)}`,
  );
  assert.equal(pairingStatus.response.status, 200);
  assert.equal(pairingStatus.body.pairing.agentLabel, "Ordinary user Agent");
  assert.equal(pairingStatus.body.pairing.status, "pending");

  const approvalPage = await render(
    normalWorker,
    `${pairingUrl.pathname}${pairingUrl.search}`,
    { headers: authHeaders },
  );
  assert.equal(approvalPage.status, 200);
  assert.doesNotMatch(await approvalPage.text(), /Approving a local Codex is temporarily paused/);

  const profileResponse = await requestJson(normalWorker, "/api/me/delegation", {
    headers: authHeaders,
  });
  assert.equal(profileResponse.response.status, 200);
  const profile = profileResponse.body.profile;

  const personKeys = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const personPublicKey = base64Url(
    await crypto.subtle.exportKey("raw", personKeys.publicKey),
  );
  const personKeyResponse = await requestJson(normalWorker, "/api/me/keys", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ publicKey: personPublicKey }),
  });
  assert.equal(personKeyResponse.response.status, 201);
  const personKey = personKeyResponse.body.key;

  const proofChallengeResponse = await requestJson(
    normalWorker,
    `/api/me/keys/${encodeURIComponent(personKey.id)}/proof-challenge`,
    { method: "POST", headers: authHeaders },
  );
  assert.equal(proofChallengeResponse.response.status, 201);
  const proofChallenge = proofChallengeResponse.body.challenge;
  const personProofSignature = await signCanonical(
    personKeys.privateKey,
    personKeyProofChallengeSigningPayload(proofChallenge),
  );
  const proofResponse = await requestJson(
    normalWorker,
    `/api/me/keys/${encodeURIComponent(personKey.id)}/proof`,
    {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        challengeId: proofChallenge.id,
        personSignature: personProofSignature,
      }),
    },
  );
  assert.equal(proofResponse.response.status, 201);

  const agentResponse = await requestJson(normalWorker, "/api/me/agents", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      agentId,
      label: "Ordinary user Agent",
      publicKey: agentPublicKey,
    }),
  });
  assert.equal(agentResponse.response.status, 201);

  const validFrom = new Date(Date.now() - 60_000);
  const certificate = {
    id: `pw:delegation:ordinary-${crypto.randomUUID()}`,
    ownerPersonId: profile.person.id,
    agentId,
    agentPublicKey,
    scopes: ["formalize", "prove"],
    validFrom: validFrom.toISOString(),
    validUntil: new Date(validFrom.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    attributionPolicy: {
      beneficiaryPersonId: profile.person.id,
      mode: "agent_delegated",
    },
  };
  const delegationResponse = await requestJson(normalWorker, "/api/me/delegations", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      personKeyId: personKey.id,
      certificate,
      personSignature: await signCanonical(
        personKeys.privateKey,
        delegationSigningPayload(certificate),
      ),
    }),
  });
  assert.equal(delegationResponse.response.status, 201);

  const approveResponse = await requestJson(
    normalWorker,
    `/api/connect/sessions/${encodeURIComponent(pairingId)}/approve`,
    {
      method: "POST",
      headers: { ...authHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        secret: pairingSecret,
        delegationCertificateId: certificate.id,
      }),
    },
  );
  assert.equal(approveResponse.response.status, 200);
  const callback = new URL(approveResponse.body.redirectUrl);
  assert.equal(callback.origin, "http://127.0.0.1:44765");
  assert.equal(callback.searchParams.get("state"), "ordinary-user-oauth-state");

  const tokenResponse = await normalWorker.dispatchFetch("https://localhost/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code"),
      redirect_uri: "http://127.0.0.1:44765/callback",
      client_id: pairingResponse.body.clientId,
      code_verifier: codeVerifier,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResponse.headers.get("cache-control"), "no-store");
  const tokens = await tokenResponse.json();
  assert.match(tokens.access_token, /^pw_at_/);
  assert.match(tokens.refresh_token, /^pw_rt_/);
  assert.match(tokens.scope, /\bartifact:write\b/);
  assert.match(tokens.scope, /\brun:request\b/);

  const authority = await callMcpTool(normalWorker, tokens.access_token, "get_connection_authority", {});
  assert.equal(authority.status, 200);
  for (const path of ["/api/me/attempts", "/api/attempts", "/api/internal/anchors/tick", "/api/me/research/sources"]) {
    const denied = await normalWorker.dispatchFetch("https://localhost" + path, { method: "POST", headers: { ...authHeaders, "content-type": "application/json" }, body: "{}" });
    assert.equal(denied.status, 503);
  }
  const write = await callMcpTool(normalWorker, tokens.access_token, "create_attempt", { problemSlug: "erdos-865-k2", delegationScope: "formalize", idempotencyKey: "frozen-write-must-fail" });
  const writeBody = await write.json();
  assert.ok(write.status >= 400 || writeBody.error || writeBody.result?.isError);
  assert.deepEqual(await researchCounts(database), before);
  const revoke = await requestJson(normalWorker, `/api/me/agent-installations/${encodeURIComponent(approveResponse.body.installationId)}/revoke`, { method: "POST", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify({ reason: "Isolated test complete" }) });
  assert.equal(revoke.response.status, 200);
  const revoked = await callMcpTool(normalWorker, tokens.access_token, "get_connection_authority", {});
  assert.equal(revoked.status, 401);
});

async function researchCounts(db) {
  const counts = {};
  for (const table of ["agent_attempts", "runs", "contribution_receipts"]) counts[table] = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first("n");
  return counts;
}
async function seedAccount(db) {
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)").bind("person:connection-isolated", "google", "connection-isolated", "Connection Test", now).run();
  await db.prepare("INSERT INTO person_identities (id, person_id, provider, provider_subject, email, email_normalized, display_name, email_verified_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("identity:connection-isolated", "person:connection-isolated", "google", "connection-isolated", "connection@example.test", "connection@example.test", "Connection Test", now, now).run();
  await db.prepare("INSERT INTO app_sessions (id, person_id, identity_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind("session:connection-isolated", "person:connection-isolated", "identity:connection-isolated", createHash("sha256").update("connection-isolated-test-session").digest("hex"), "2099-01-01T00:00:00.000Z", now).run();
}
async function requestJson(worker, path, init = {}) {
  const response = await worker.dispatchFetch("https://localhost" + path, init);
  const body = await response.json();
  assert.ok(response.status < 500, JSON.stringify(body));
  return { response, body };
}
async function render(worker, path, init) { return worker.dispatchFetch("https://localhost" + path, init); }
async function callMcpTool(worker, token, name, args) {
  return worker.dispatchFetch("https://localhost/api/mcp", { method: "POST", headers: { authorization: "Bearer " + token, accept: "application/json, text/event-stream", "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
}
async function signCanonical(key, payload) { return base64Url(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(canonicalJson(payload)))); }
function base64Url(value) { return Buffer.from(value).toString("base64url"); }
async function createWorker({
  bindings = {},
  includeDatabase = true,
  configureOperationModes = true,
} = {}) {
  const entrypoint = fileURLToPath(new URL("index.js", workerRoot));
  const modules = await listJavaScriptModules(workerRoot);
  return new Miniflare({
    modules: [
      { type: "ESModule", path: entrypoint },
      ...modules
        .filter((modulePath) => modulePath !== entrypoint)
        .map((modulePath) => ({ type: "ESModule", path: modulePath })),
    ],
    modulesRoot: fileURLToPath(workerRoot),
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    ...(includeDatabase ? { d1Databases: ["DB"] } : {}),
    bindings: {
      ...(configureOperationModes ? {
        PROOFWEAVE_CONTROL_PLANE_MODE: "read_write",
        PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_only",
        PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "read_only",
        PROOFWEAVE_ACCOUNT_AUTH_MODE: "read_write",
        PROOFWEAVE_OAUTH_CONTROL_PLANE_MODE: "read_write",
        PROOFWEAVE_CONNECTION_CONTROL_PLANE_MODE: "read_write",
        PROOFWEAVE_HOSTING_PLATFORM: "cloudflare",
        PROOFWEAVE_DEPLOYMENT_STAGE: "validation",
        OAUTH_ISSUER_URL: "https://localhost",
        MCP_RESOURCE_URL: "https://localhost/api/mcp",
      } : {}),
      ...bindings,
    },
    serviceBindings: {
      ASSETS: async () => new Response("Not found", { status: 404 }),
    },
  });
}

async function applyMigrations(database) {
  const filenames = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();

  for (const filename of filenames) {
    const migration = await readFile(new URL(filename, migrationsRoot), "utf8");
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await database.prepare(statement).run();
    }
  }
}


async function listJavaScriptModules(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
    if (entry.isDirectory()) paths.push(...await listJavaScriptModules(url));
    else if (entry.name.endsWith(".js")) paths.push(fileURLToPath(url));
  }
  return paths;
}
