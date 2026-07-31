import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { delegationSigningPayload } from "../packages/domain/delegation.mjs";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { personKeyProofChallengeSigningPayload } from "../packages/protocol/person-key-proof.mjs";
import {
  researchCheckpointPayloadHash,
  researchCheckpointSigningPayload,
} from "../packages/protocol/research-checkpoint.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
const workerRoot = new URL("../dist/server/", import.meta.url);
const anonymousPaths = [
  "/",
  "/explore",
  "/explore/erdos-865-k2",
  "/demo",
];
const ordinaryEntryPaths = [
  "/",
  "/sign-in?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher",
  "/explore/erdos-865-k2",
  "/workbench?target=erdos-865-k2",
  "/demo",
];
const authHeaders = {
  "oai-authenticated-user-email": "ordinary-user@example.test",
  "oai-authenticated-user-full-name": "Ordinary%20User",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

let normalWorker;
let readOnlyWorker;
let storageUnavailableWorker;

before(async () => {
  normalWorker = await createWorker({
    bindings: {
      PROOFWEAVE_CONTROL_PLANE_MODE: "read_write",
      MCP_RESOURCE_URL: "https://localhost/api/mcp",
      OAUTH_ISSUER_URL: "https://localhost",
    },
  });
  await applyMigrations(await normalWorker.getD1Database("DB"));

  readOnlyWorker = await createWorker({
    bindings: {
      PROOFWEAVE_CONTROL_PLANE_MODE: "read_only",
      MCP_RESOURCE_URL: "https://localhost/api/mcp",
      OAUTH_ISSUER_URL: "https://localhost",
    },
  });
  const readOnlyDatabase = await readOnlyWorker.getD1Database("DB");
  await applyMigrations(readOnlyDatabase);
  await seedReadOnlyOAuth(readOnlyDatabase);

  storageUnavailableWorker = await createWorker({
    includeDatabase: false,
    bindings: {
      PROOFWEAVE_CONTROL_PLANE_MODE: "read_write",
    },
  });
});

after(async () => {
  await Promise.all([
    normalWorker?.dispose(),
    readOnlyWorker?.dispose(),
    storageUnavailableWorker?.dispose(),
  ]);
});

test("an anonymous visitor can browse the public research journey without an account", async () => {
  for (const pathname of anonymousPaths) {
    const response = await render(normalWorker, pathname);
    assert.equal(response.status, 200, `${pathname} should remain publicly readable`);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    assert.doesNotMatch(
      await response.text(),
      /you must sign in to (?:view|read)|authentication required to (?:view|read)/i,
      `${pathname} should not imply that public reading requires an account`,
    );
  }

  const detail = await render(normalWorker, "/explore/erdos-865-k2");
  const detailText = defaultVisibleText(await detail.text());
  assert.match(detailText, /Erdős Problem 865: k = 2 variant/i);
  assert.match(detailText, /Pinned Lean statement/i);
  assert.match(detailText, /Source correspondence/i);
});

test("a selected target survives start, sign-in, and the ChatGPT handoff", async () => {
  const start = await render(normalWorker, "/start?target=erdos-865-k2", {
    redirect: "manual",
  });
  assert.equal(start.status, 307);
  assert.equal(
    new URL(start.headers.get("location")).pathname +
      new URL(start.headers.get("location")).search +
      new URL(start.headers.get("location")).hash,
    "/workbench?target=erdos-865-k2#research-launcher",
  );

  const workbench = await render(normalWorker, "/workbench?target=erdos-865-k2");
  const workbenchHtml = await workbench.text();
  assert.match(workbenchHtml, /Erdős Problem 865: k = 2 variant/i);
  assert.match(workbenchHtml, /exact target and source revision stay selected after sign-in/i);
  assert.match(
    workbenchHtml,
    /href="\/sign-in\?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher"/i,
  );

  const signIn = await render(
    normalWorker,
    "/sign-in?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher",
  );
  const signInHtml = await signIn.text();
  assert.match(
    signInHtml,
    /href="\/signin-with-chatgpt\?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher"/i,
  );
});

test("the first-run path uses action language instead of protocol vocabulary", async () => {
  const welcome = defaultVisibleText(await (await render(normalWorker, "/")).text());
  assert.match(welcome, /Explore without an account/i);
  assert.match(welcome, /Watch the proof journey/i);

  const detail = defaultVisibleText(
    await (await render(normalWorker, "/explore/erdos-865-k2")).text(),
  );
  assert.match(detail, /Start with my Agent/i);
  assert.doesNotMatch(detail, /\bStart an Attempt\b/i);

  const workbench = defaultVisibleText(
    await (await render(normalWorker, "/workbench?target=erdos-865-k2")).text(),
  );
  assert.match(workbench, /Sign in to begin/i);
  assert.match(workbench, /Explore first/i);

  const demo = defaultVisibleText(await (await render(normalWorker, "/demo")).text());
  assert.match(demo, /Run the walkthrough/i);
  assert.match(demo, /Start with my Agent/i);
});

test("sign-in makes the available provider and unavailable provider unambiguous", async () => {
  const response = await render(
    normalWorker,
    "/sign-in?return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher",
  );
  assert.equal(response.status, 200);
  const html = await response.text();

  assert.match(
    html,
    /class="auth-provider auth-provider-disabled" aria-disabled="true"[\s\S]*Continue with Google[\s\S]*Available after the deployment owner finishes Google OAuth setup[\s\S]*Soon/i,
  );
  assert.doesNotMatch(html, /href="\/auth\/google\/start/i);
  assert.match(
    html,
    /href="\/signin-with-chatgpt\?return_to=[^"]+"[\s\S]*Continue with ChatGPT/i,
  );
});

test("a new ordinary Person connects an Agent and reaches a truthfully bounded read-write contribution", async () => {
  const database = await normalWorker.getD1Database("DB");
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
  const approvalText = defaultVisibleText(await approvalPage.text());
  assert.match(approvalText, /Reading local connection/i);
  assert.match(approvalText, /Stored locally/i);
  assert.match(approvalText, /does not claim Lean verification or create a contribution receipt/i);

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

  const createdResponse = await callMcpTool(
    normalWorker,
    tokens.access_token,
    "create_attempt",
    {
      problemSlug: "erdos-865-k2",
      delegationScope: "formalize",
      idempotencyKey: "ordinary-user-read-write-attempt",
    },
  );
  assert.equal(createdResponse.status, 200);
  const createdTool = await createdResponse.json();
  assert.equal(createdTool.result?.isError, undefined);
  const created = JSON.parse(createdTool.result.content[0].text);
  assert.equal(created.idempotentReplay, false);
  assert.equal(created.verificationState, "agent_reported_only");
  const attempt = created.attempt;

  const retriedResponse = await callMcpTool(
    normalWorker,
    tokens.access_token,
    "create_attempt",
    {
      problemSlug: "erdos-865-k2",
      delegationScope: "formalize",
      idempotencyKey: "ordinary-user-read-write-attempt",
    },
  );
  const retried = JSON.parse((await retriedResponse.json()).result.content[0].text);
  assert.equal(retried.idempotentReplay, true);
  assert.equal(retried.attempt.id, attempt.id);

  const listedResponse = await callMcpTool(
    normalWorker,
    tokens.access_token,
    "list_attempts",
    { limit: 10 },
  );
  const listed = JSON.parse((await listedResponse.json()).result.content[0].text);
  assert.equal(listed.attempts.filter((entry) => entry.id === attempt.id).length, 1);

  const checkpoint = await signedOrdinaryCheckpoint({
    attempt,
    agentId,
    agentPublicKey,
    agentPrivateKey: agentKeys.privateKey,
  });
  const checkpointResponse = await callMcpTool(
    normalWorker,
    tokens.access_token,
    "publish_research_checkpoint",
    { checkpoint },
  );
  assert.equal(checkpointResponse.status, 200);
  const checkpointTool = await checkpointResponse.json();
  assert.equal(checkpointTool.result?.isError, undefined);
  const published = JSON.parse(checkpointTool.result.content[0].text);
  assert.equal(published.verificationState, "shared_research_only");
  assert.equal(published.contributionState, "not_credited");

  const problemResponse = await callMcpTool(
    normalWorker,
    tokens.access_token,
    "inspect_problem",
    { slug: "erdos-865-k2" },
  );
  const problem = JSON.parse((await problemResponse.json()).result.content[0].text);
  const objects = {};
  for (const [name, artifact] of Object.entries({
    sourceArchive: {
      filename: "source.tar.zst",
      contentType: "application/zstd",
      bytes: Buffer.concat([
        Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
        Buffer.from("ordinary-user-fixture"),
      ]),
    },
    patch: {
      filename: "normalized.patch",
      contentType: "text/x-diff",
      bytes: Buffer.from(
        "diff --git a/Main.lean b/Main.lean\n--- a/Main.lean\n+++ b/Main.lean\n",
      ),
    },
    lakeManifest: {
      filename: "lake-manifest.json",
      contentType: "application/json",
      bytes: Buffer.from('{"name":"ordinary-user-fixture"}\n'),
    },
  })) {
    const objectResponse = await callMcpTool(
      normalWorker,
      tokens.access_token,
      "put_artifact_object",
      {
        attemptId: attempt.id,
        filename: artifact.filename,
        contentType: artifact.contentType,
        contentBase64Url: artifact.bytes.toString("base64url"),
      },
    );
    assert.equal(objectResponse.status, 200);
    const objectTool = await objectResponse.json();
    assert.equal(objectTool.result?.isError, undefined, name);
    const stagedObject = JSON.parse(objectTool.result.content[0].text);
    assert.equal(stagedObject.storageState, "object_staged_only");
    assert.equal(stagedObject.verificationState, "not_verified");
    objects[name] = stagedObject.object;
  }

  const bundle = await signedOrdinaryBundle({
    attempt,
    problem,
    objects,
    agentPublicKey,
    agentPrivateKey: agentKeys.privateKey,
  });
  const bundleResponse = await callMcpTool(
    normalWorker,
    tokens.access_token,
    "stage_artifact_bundle",
    { bundle },
  );
  assert.equal(bundleResponse.status, 200);
  const bundleTool = await bundleResponse.json();
  assert.equal(bundleTool.result?.isError, undefined);
  const stagedBundle = JSON.parse(bundleTool.result.content[0].text);
  assert.equal(stagedBundle.storageState, "bundle_staged_only");
  assert.equal(stagedBundle.verificationState, "not_verified");
  assert.match(stagedBundle.bundle.manifestHash, /^sha256:[a-f0-9]{64}$/);

  const runResponse = await callMcpTool(
    normalWorker,
    tokens.access_token,
    "request_runner_run",
    {
      attemptId: attempt.id,
      artifactBundleHash: stagedBundle.bundle.manifestHash,
      idempotencyKey: "ordinary-user-runner-unavailable",
    },
  );
  assert.equal(runResponse.status, 200);
  const runTool = await runResponse.json();
  assert.equal(runTool.result?.isError, true);
  assert.match(
    runTool.result.content[0].text,
    /isolated Lean Runner dispatch is not configured/i,
  );

  const runCount = await database
    .prepare("SELECT COUNT(*) AS count FROM runs WHERE attempt_id = ?")
    .bind(attempt.id)
    .first();
  const receiptCount = await database
    .prepare("SELECT COUNT(*) AS count FROM contribution_receipts WHERE attempt_id = ?")
    .bind(attempt.id)
    .first();
  const attestationCount = await database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM verification_attestations AS attestation
       INNER JOIN verification_assignments AS assignment
         ON assignment.id = attestation.assignment_id
       INNER JOIN artifact_bundles AS artifact
         ON artifact.manifest_hash = assignment.artifact_bundle_manifest_hash
       WHERE artifact.attempt_id = ?`,
    )
    .bind(attempt.id)
    .first();
  assert.equal(Number(runCount?.count ?? 0), 0);
  assert.equal(Number(receiptCount?.count ?? 0), 0);
  assert.equal(Number(attestationCount?.count ?? 0), 0);
});

test("read-only mode never offers a connection write that the service will reject", async () => {
  const response = await render(
    readOnlyWorker,
    "/integrations?target=erdos-865-k2&return_to=%2Fworkbench%3Ftarget%3Derdos-865-k2%23research-launcher",
    { headers: authHeaders },
  );
  assert.equal(response.status, 200);
  const html = await response.text();
  const text = defaultVisibleText(html);

  assert.match(text, /Connections are temporarily paused for maintenance/i);
  assert.match(text, /No Agent connection, research task, or evidence write can complete/i);
  assert.match(html, /<button[^>]*disabled[^>]*>Connection temporarily paused<\/button>/i);
  assert.doesNotMatch(text, /Copy setup request/i);
  assert.doesNotMatch(text, /Approve and connect/i);

  const workbench = await render(readOnlyWorker, "/workbench?target=erdos-865-k2", {
    headers: authHeaders,
  });
  assert.equal(workbench.status, 200);
  const workbenchText = defaultVisibleText(await workbench.text());
  assert.match(workbenchText, /Research updates are temporarily paused/i);
  assert.match(workbenchText, /Your selected question is preserved/i);
  assert.doesNotMatch(workbenchText, /\bStart research\b/i);
  assert.doesNotMatch(workbenchText, /\bManage research\b/i);
});

test("the built Worker refreshes an existing Agent for reads while research writes remain frozen", async () => {
  const refreshResponse = await readOnlyWorker.dispatchFetch("https://localhost/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "pw_rt_ordinary_read_only_fixture",
      client_id: "client:ordinary-read-only",
    }),
  });
  assert.equal(refreshResponse.status, 200);
  assert.equal(refreshResponse.headers.get("cache-control"), "no-store");
  const tokens = await refreshResponse.json();
  assert.match(tokens.access_token, /^pw_at_/);
  assert.match(tokens.refresh_token, /^pw_rt_/);

  for (const name of ["list_frontier_problems", "list_attempts"]) {
    const response = await callMcpTool(readOnlyWorker, tokens.access_token, name, {});
    assert.equal(response.status, 200, `${name} should remain readable after refresh`);
    const payload = await response.json();
    assert.equal(payload.result?.isError, undefined);
  }

  const blocked = await callMcpTool(
    readOnlyWorker,
    tokens.access_token,
    "create_attempt",
    {
      problemSlug: "erdos-865-k2",
      delegationScope: "formalize",
      idempotencyKey: "ordinary-read-only-worker-must-not-write",
    },
  );
  assert.equal(blocked.status, 503);
  assert.deepEqual(await blocked.json(), {
    error: "temporarily_unavailable",
    error_description: "Proofweave is temporarily read-only for maintenance.",
    diagnostic_code: "control_plane_read_only",
  });
});

test("missing or invalid built-Worker operation modes never enable participant or MCP writes", async (t) => {
  for (const fixture of [
    {
      name: "missing",
      bindings: {
        MCP_RESOURCE_URL: "https://localhost/api/mcp",
        OAUTH_ISSUER_URL: "https://localhost",
      },
    },
    {
      name: "invalid",
      bindings: {
        PROOFWEAVE_CONTROL_PLANE_MODE: "read_write",
        PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "typo",
        PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "typo",
        MCP_RESOURCE_URL: "https://localhost/api/mcp",
        OAUTH_ISSUER_URL: "https://localhost",
      },
    },
  ]) {
    const worker = await createWorker({
      bindings: fixture.bindings,
      configureOperationModes: false,
    });
    t.after(() => worker.dispose());
    const database = await worker.getD1Database("DB");
    await applyMigrations(database);
    await seedReadOnlyOAuth(database);

    const pairing = await requestJson(worker, "/api/connect/sessions", connectionRequest(fixture.name));
    assert.equal(pairing.response.status, 503, `${fixture.name} participant writes must be frozen`);

    const tokens = await refreshSeededAgent(worker);
    const blocked = await callMcpTool(worker, tokens.access_token, "create_attempt", {
      problemSlug: "erdos-865-k2",
      delegationScope: "formalize",
      idempotencyKey: `operation-mode-${fixture.name}-must-not-write`,
    });
    assert.equal(blocked.status, 503, `${fixture.name} MCP writes must be frozen`);

    const capabilities = await worker.dispatchFetch("https://localhost/api/mcp/capabilities");
    const contract = await capabilities.json();
    assert.equal(contract.participantOperations.writesEnabled, false);
    assert.equal(contract.mcpOperations.writesEnabled, false);
    assert.ok(
      contract.participantOperations.failureCodes.some((code) => code.includes(fixture.name === "missing" ? "missing" : "invalid")),
    );
    assert.ok(
      contract.mcpOperations.failureCodes.some((code) => code.includes(fixture.name === "missing" ? "missing" : "invalid")),
    );
  }
});

test("built Worker freezes participant and MCP write surfaces independently", async (t) => {
  const participantFrozen = await createWorker({
    bindings: {
      PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_only",
      MCP_RESOURCE_URL: "https://localhost/api/mcp",
      OAUTH_ISSUER_URL: "https://localhost",
    },
  });
  t.after(() => participantFrozen.dispose());
  const participantFrozenDatabase = await participantFrozen.getD1Database("DB");
  await applyMigrations(participantFrozenDatabase);
  await seedReadOnlyOAuth(participantFrozenDatabase);

  const participantPairing = await requestJson(
    participantFrozen,
    "/api/connect/sessions",
    connectionRequest("participant-frozen"),
  );
  assert.equal(participantPairing.response.status, 503);
  const participantTokens = await refreshSeededAgent(participantFrozen);
  const mcpRead = await callMcpTool(
    participantFrozen,
    participantTokens.access_token,
    "get_connection_authority",
    {},
  );
  assert.equal(mcpRead.status, 200);
  const mcpOperationalWrites = await participantFrozenDatabase
    .prepare("SELECT COUNT(*) AS count FROM remote_mcp_rate_limit_buckets")
    .first("count");
  assert.ok(Number(mcpOperationalWrites) > 0, "MCP remains independently writable");

  const mcpFrozen = await createWorker({
    bindings: {
      PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "read_only",
      MCP_RESOURCE_URL: "https://localhost/api/mcp",
      OAUTH_ISSUER_URL: "https://localhost",
    },
  });
  t.after(() => mcpFrozen.dispose());
  const mcpFrozenDatabase = await mcpFrozen.getD1Database("DB");
  await applyMigrations(mcpFrozenDatabase);
  await seedReadOnlyOAuth(mcpFrozenDatabase);

  const participantWrite = await requestJson(
    mcpFrozen,
    "/api/connect/sessions",
    connectionRequest("mcp-frozen"),
  );
  assert.equal(participantWrite.response.status, 201, "participant writes remain independently enabled");
  const mcpTokens = await refreshSeededAgent(mcpFrozen);
  const blockedMcp = await callMcpTool(mcpFrozen, mcpTokens.access_token, "create_attempt", {
    problemSlug: "erdos-865-k2",
    delegationScope: "formalize",
    idempotencyKey: "mcp-surface-frozen-must-not-write",
  });
  assert.equal(blockedMcp.status, 503);
});

test("authenticated personal surfaces render read-only maintenance without mutation controls", async () => {
  const personalSurfaces = [
    {
      pathname: "/profile",
      expected: /private contribution profile is temporarily paused/i,
      forbidden: [/View public contribution record/i, /Manage Agent and security/i],
    },
    {
      pathname: "/settings",
      expected: /Agent and account changes are temporarily paused/i,
      forbidden: [/Sign and activate delegation/i, /Revoke delegation/i, /Approve local Codex/i],
    },
    {
      pathname: "/reviews",
      expected: /Review assignments are temporarily paused/i,
      forbidden: [/Sign in to claim/i, /Claim review/i, /Enable review Agent/i, /\bAccept\b/i, /\bDecline\b/i],
    },
    {
      pathname: "/reviews/read-only-assignment",
      expected: /private review workspace is temporarily paused/i,
      forbidden: [/\bAccept\b/i, /\bDecline\b/i, /Submit signed decision/i, /Request fresh replay/i],
    },
    {
      pathname: "/evidence",
      expected: /private evidence records are temporarily paused/i,
      forbidden: [/Inspect evidence/i, /\bDownload\b/i, /Submit evidence/i],
    },
    {
      pathname: "/evidence/read-only-bundle",
      expected: /private evidence record is temporarily paused/i,
      forbidden: [/\bDownload\b/i, /Request independent review/i, /Submit evidence/i],
    },
    {
      pathname: "/connect/codex?pairing=read-only-pairing&secret=not-used",
      expected: /Approving a local Codex is temporarily paused/i,
      forbidden: [/Approve local Codex/i, /Create key/i, /Approve and connect/i],
    },
    {
      pathname: "/workbench/attempts/read-only-attempt",
      expected: /This research task is temporarily paused/i,
      forbidden: [/Copy Codex brief/i, /Manage Attempt/i, /Prepare evidence/i, /Refresh records/i],
    },
  ];

  for (const surface of personalSurfaces) {
    const response = await render(readOnlyWorker, surface.pathname, {
      headers: authHeaders,
    });
    assert.equal(response.status, 200, `${surface.pathname} should render read-only maintenance`);
    const html = await response.text();
    const text = defaultVisibleText(html);
    assert.match(text, surface.expected);
    assert.match(html, /href="\/explore"/i);
    assert.match(html, /href="\/demo"/i);
    assert.match(text, /Public research remains readable/i);
    for (const pattern of surface.forbidden) {
      assert.doesNotMatch(
        text,
        pattern,
        `${surface.pathname} should not expose mutation control ${pattern}`,
      );
    }
  }
});

test("missing durable storage fails closed instead of showing sample or writable work", async () => {
  const response = await render(
    storageUnavailableWorker,
    "/workbench?target=erdos-865-k2",
    { headers: authHeaders },
  );
  assert.equal(response.status, 200);
  const text = defaultVisibleText(await response.text());

  assert.match(text, /Research setup is temporarily unavailable/i);
  assert.match(text, /will not substitute an untracked local record/i);
  assert.doesNotMatch(text, /\bStart research\b/i);
  assert.doesNotMatch(text, /Sign and activate delegation/i);
  assert.doesNotMatch(text, /sample (?:Attempt|task|contribution)/i);
});

test("the public demo distinguishes signed-evidence verification from a fresh Lean run", async () => {
  const response = await render(normalWorker, "/demo");
  assert.equal(response.status, 200);
  const text = defaultVisibleText(await response.text());

  assert.match(text, /Re-verify signed evidence/i);
  assert.match(text, /Lean itself is not restarted/i);
  assert.match(text, /It does not start Lean/i);
  assert.match(text, /fresh Lean replay is the separate local end-to-end command/i);
  assert.match(text, /Optional audit path · developers and reviewers/i);
  assert.match(text, /npm run demo:e2e:check/i);

  const verification = await render(normalWorker, "/api/demo/verify", {
    headers: { accept: "application/json" },
  });
  assert.equal(verification.status, 200);
  const payload = await verification.json();
  assert.equal(payload.executionBoundary.signedEvidenceReverified, true);
  assert.equal(payload.executionBoundary.leanReplay, "not_run_by_this_request");
});

test("ordinary entry pages hide operational identifiers and raw Agent tool names by default", async () => {
  const forbidden = [
    /\bidempotency(?: key)?\b/i,
    /\bdelegationCertificateId\b/i,
    /\bdelegation:[a-z0-9:_-]+\b/i,
    /\bcontinue_research\b/i,
    /\binspect_research_graph\b/i,
    /\breport_progress\b/i,
    /\bprepare_workspace_bundle\b/i,
    /\bstage_workspace_bundle\b/i,
    /\brequest_runner_run\b/i,
  ];

  for (const pathname of ordinaryEntryPaths) {
    const response = await render(normalWorker, pathname);
    assert.equal(response.status, 200, `${pathname} should render`);
    const text = defaultVisibleText(await response.text());
    for (const pattern of forbidden) {
      assert.doesNotMatch(
        text,
        pattern,
        `${pathname} should keep ${pattern} behind optional technical details`,
      );
    }
  }
});

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
        PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_write",
        PROOFWEAVE_MCP_CONTROL_PLANE_MODE: "read_write",
      } : {}),
      ...bindings,
    },
    serviceBindings: {
      ASSETS: async () => new Response("Not found", { status: 404 }),
    },
  });
}

async function render(worker, pathname = "/", init = {}) {
  return worker.dispatchFetch(`http://localhost${pathname}`, {
    ...init,
    headers: { accept: "text/html", ...(init.headers ?? {}) },
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

async function seedReadOnlyOAuth(database) {
  const issuedAt = "2026-07-20T00:00:00.000Z";
  const statements = [
    [
      "INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at) VALUES (?, ?, ?, ?, ?)",
      ["person:ordinary-read-only", "proofweave", "ordinary-read-only", "Ordinary read-only", issuedAt],
    ],
    [
      "INSERT INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      ["person-key:ordinary-read-only", "person:ordinary-read-only", "person-key", "sha256:ordinary-read-only-person-key"],
    ],
    [
      "INSERT INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      ["agent:ordinary-read-only", "person:ordinary-read-only", "Ordinary read-only Agent", "agent-key", "sha256:ordinary-read-only-agent-key"],
    ],
    [
      `INSERT INTO delegation_certificates (
        id, owner_person_id, agent_id, person_key_id, agent_public_key,
        scopes_json, valid_from, valid_until, beneficiary_person_id,
        protocol_version, payload_hash, canonical_payload, person_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "delegation:ordinary-read-only", "person:ordinary-read-only",
        "agent:ordinary-read-only", "person-key:ordinary-read-only", "agent-key",
        '["formalize","prove"]', "2026-07-01T00:00:00.000Z",
        "2027-07-01T00:00:00.000Z", "person:ordinary-read-only",
        "pw-delegation-v1", "sha256:ordinary-read-only-delegation", "{}",
        "signature",
      ],
    ],
    [
      "INSERT INTO oauth_clients (id, client_name, redirect_uris_json) VALUES (?, ?, ?)",
      ["client:ordinary-read-only", "Ordinary read-only client", '["http://127.0.0.1/callback"]'],
    ],
    [
      `INSERT INTO agent_installations (
        id, person_id, agent_id, delegation_certificate_id, client_id, label
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        "installation:ordinary-read-only", "person:ordinary-read-only",
        "agent:ordinary-read-only", "delegation:ordinary-read-only",
        "client:ordinary-read-only", "Ordinary read-only installation",
      ],
    ],
    [
      `INSERT INTO oauth_refresh_tokens (
        token_hash, client_id, resource, person_id, agent_installation_id,
        scopes_json, issued_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        await tokenHash("pw_rt_ordinary_read_only_fixture"),
        "client:ordinary-read-only", "https://localhost/api/mcp",
        "person:ordinary-read-only", "installation:ordinary-read-only",
        '["attempt:create","attempt:read","catalog:read"]', issuedAt,
        "2027-07-01T00:00:00.000Z",
      ],
    ],
  ];
  for (const [sql, values] of statements) {
    await database.prepare(sql).bind(...values).run();
  }
}

function connectionRequest(suffix) {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": "203.0.113.210",
    },
    body: JSON.stringify({
      agentId: `urn:pw:agent:operation-mode-${suffix}`,
      agentLabel: `Operation mode ${suffix} Agent`,
      agentPublicKey: "a".repeat(43),
      oauthState: `operation-mode-${suffix}-state`,
      codeChallenge: "b".repeat(43),
      connectionMode: "research",
    }),
  };
}

async function refreshSeededAgent(worker) {
  const response = await worker.dispatchFetch("https://localhost/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "pw_rt_ordinary_read_only_fixture",
      client_id: "client:ordinary-read-only",
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function callMcpTool(worker, accessToken, name, arguments_) {
  return worker.dispatchFetch("https://localhost/api/mcp", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: arguments_ },
    }),
  });
}

async function requestJson(worker, pathname, init = {}) {
  const response = await worker.dispatchFetch(`https://localhost${pathname}`, {
    ...init,
    headers: { accept: "application/json", ...(init.headers ?? {}) },
  });
  return {
    response,
    body: await response.json(),
  };
}

async function signedOrdinaryCheckpoint({
  attempt,
  agentId,
  agentPublicKey,
  agentPrivateKey,
}) {
  const checkpoint = {
    protocolVersion: "pw-research-checkpoint-v1",
    id: `research-node:ordinary-${crypto.randomUUID()}`,
    attemptId: attempt.id,
    problemRevisionId: attempt.problemRevisionId,
    kind: "formalization",
    summary: "Pinned the exact target and recorded one owner-approved formalization checkpoint.",
    parentNodeIds: [],
    proofStateHash: null,
    artifactBundleHash: null,
    citations: [],
    agentEvent: {
      id: `agent-event:ordinary-${crypto.randomUUID()}`,
      agentId,
      agentPublicKey,
      occurredAt: new Date().toISOString(),
      signature: "A".repeat(86),
    },
    payloadHash: `sha256:${"0".repeat(64)}`,
  };
  checkpoint.payloadHash = await researchCheckpointPayloadHash(checkpoint);
  checkpoint.agentEvent.signature = await signCanonical(
    agentPrivateKey,
    researchCheckpointSigningPayload(checkpoint),
  );
  return checkpoint;
}

async function signedOrdinaryBundle({
  attempt,
  problem,
  objects,
  agentPublicKey,
  agentPrivateKey,
}) {
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v2",
    id: `bundle:ordinary-${crypto.randomUUID()}`,
    attemptId: attempt.id,
    problemRevisionId: attempt.problemRevisionId,
    target: {
      declaration: problem.declaration.qualifiedName,
      statementHash: problem.declaration.sourceContentHash,
    },
    workspace: {
      archive: {
        objectKey: objects.sourceArchive.objectKey,
        contentHash: objects.sourceArchive.contentHash,
        format: "tar.zst",
        maxExpandedBytes: 1_000_000,
        maxFileCount: 12,
        symlinkPolicy: "forbidden",
      },
      patch: {
        objectKey: objects.patch.objectKey,
        contentHash: objects.patch.contentHash,
        format: "unified-diff",
        strip: 1,
        allowFuzz: false,
      },
      tree: {
        hash: await contentHash("ordinary-user-tree"),
        algorithm: "pw-tree-v1",
        state: "after_patch_and_lake_manifest",
      },
      lakeManifest: {
        objectKey: objects.lakeManifest.objectKey,
        contentHash: objects.lakeManifest.contentHash,
        destination: "lake-manifest.json",
      },
    },
    environment: {
      leanToolchain: problem.source.leanToolchain,
      mathlibRevision: problem.source.mathlibRevision,
    },
    entryCommand: ["lake", "env", "lean", "Main.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: `agent-event:ordinary-bundle-${crypto.randomUUID()}`,
      occurredAt: new Date().toISOString(),
      payloadHash: `sha256:${"0".repeat(64)}`,
      agentPublicKey,
      signature: "A".repeat(86),
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = await signCanonical(
    agentPrivateKey,
    artifactBundleSigningPayload(bundle),
  );
  return bundle;
}

async function signCanonical(privateKey, payload) {
  return base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode(canonicalJson(payload)),
    ),
  );
}

async function contentHash(value) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    typeof value === "string" ? new TextEncoder().encode(value) : value,
  );
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function tokenHash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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

function defaultVisibleText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<details\b[\s\S]*?<\/details>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function decodeEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
