import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { promisify } from "node:util";
import { normalizeArtifactBundle, verifyArtifactBundleAgentSignature } from "../packages/protocol/artifact-bundle.mjs";
import { verifyVerificationAttestationSignature } from "../packages/protocol/verification-attestation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceSkillRoot = resolve(root, "skills/proofweave-research");
const pluginRoot = resolve(root, "plugins/proofweave-research");
const pluginSkillRoot = resolve(pluginRoot, "skills/proofweave-research");
const execFileAsync = promisify(execFile);

test("the portable Proofweave Codex plugin carries the checked source skill", async () => {
  const [sourceSkill, bundledSkill, sourceReference, bundledReference, protocolContract, bundledProtocolContract] = await Promise.all([
    readFile(resolve(sourceSkillRoot, "SKILL.md"), "utf8"),
    readFile(resolve(pluginSkillRoot, "SKILL.md"), "utf8"),
    readFile(resolve(sourceSkillRoot, "references/mcp-tools.md"), "utf8"),
    readFile(resolve(pluginSkillRoot, "references/mcp-tools.md"), "utf8"),
    readFile(resolve(root, "packages/protocol/proofweave-client-compatibility.json"), "utf8"),
    readFile(resolve(pluginRoot, "mcp/proofweave-client-compatibility.json"), "utf8"),
  ]);

  assert.equal(bundledSkill, sourceSkill);
  assert.equal(bundledReference, sourceReference);
  assert.deepEqual(JSON.parse(bundledProtocolContract), JSON.parse(protocolContract));
});

test("connection_status distinguishes live-compatible updates from tool-schema restarts", async () => {
  let toolSchemaVersion = 1;
  let responseStatus = 200;
  const server = createServer((request, response) => {
    if (request.url !== "/api/mcp/capabilities") return response.writeHead(404).end();
    response.writeHead(responseStatus, {
      "cache-control": "no-store",
      "content-type": "application/json",
    });
    response.end(JSON.stringify({
      protocolVersion: "pw-local-connector-v1",
      toolSchemaVersion,
      minimumConnectorApiVersion: 1,
      recommendedConnectorApiVersion: 1,
      capabilities: ["stable_attempt_handoff"],
    }));
  });
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-connector-compatibility-"));
  try {
    const port = await listen(server);
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = join(fixtureRoot, "connector.json");
    await writeFile(configPath, JSON.stringify(connectedFixtureConfig(baseUrl)));
    const env = { ...process.env, PROOFWEAVE_BASE_URL: baseUrl, PROOFWEAVE_CONNECTOR_CONFIG: configPath };

    const compatibleResponse = await callConnectorTool("connection_status", {}, env);
    const compatible = JSON.parse(compatibleResponse.result.content[0].text);
    assert.equal(compatible.compatibility.state, "compatible");
    assert.equal(compatible.compatibility.taskAction, "continue_current_task");
    assert.equal(compatible.compatibility.restartRequired, false);
    assert.equal(compatible.connector.toolSchemaVersion, 1);
    assert.equal(compatible.compatibility.remote.capabilities[0], "stable_attempt_handoff");

    toolSchemaVersion = 2;
    const restartResponse = await callConnectorTool("connection_status", {}, env);
    const restart = JSON.parse(restartResponse.result.content[0].text);
    assert.equal(restart.compatibility.state, "restart_required");
    assert.equal(restart.compatibility.taskAction, "reinstall_then_restart_codex");
    assert.equal(restart.compatibility.restartRequired, true);

    responseStatus = 503;
    const degradedResponse = await callConnectorTool("connection_status", {}, env);
    const degraded = JSON.parse(degradedResponse.result.content[0].text);
    assert.equal(degraded.connected, true);
    assert.equal(degraded.compatibility.state, "unknown");
    assert.equal(degraded.compatibility.remote, null);
    assert.equal(degraded.distribution.state, "unknown");
    assert.match(degraded.compatibility.message, /saved connection is unchanged/i);
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(saved.accessToken, "access-test");
    assert.equal(saved.refreshToken, "refresh-test");
  } finally {
    await Promise.all([close(server), rm(fixtureRoot, { recursive: true, force: true })]);
  }
});

test("connection_status discovers only the fixed same-origin plugin distribution without leaking local authority", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-connector-distribution-"));
  const keyPath = join(fixtureRoot, "tls-key.pem");
  const certificatePath = join(fixtureRoot, "tls-certificate.pem");
  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
  ]);
  const [tlsKey, tlsCertificate, pluginManifestText] = await Promise.all([
    readFile(keyPath),
    readFile(certificatePath),
    readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
  ]);
  const installedVersion = JSON.parse(pluginManifestText).version;
  const requests = [];
  let mode = "current";
  let baseUrl;
  const server = createHttpsServer({ key: tlsKey, cert: tlsCertificate }, (request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization ?? null,
      cookie: request.headers.cookie ?? null,
      agentId: request.headers["x-proofweave-agent-id"] ?? null,
    });
    if (request.url === "/api/mcp/capabilities") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        protocolVersion: "pw-local-connector-v1",
        toolSchemaVersion: 1,
        minimumConnectorApiVersion: 1,
        recommendedConnectorApiVersion: 1,
        capabilities: ["stable_attempt_handoff"],
        distributionManifestUrl: mode === "malicious_url"
          ? "https://attacker.example/downloads/proofweave-research-marketplace.json"
          : `${baseUrl}/downloads/proofweave-research-marketplace.json`,
      }));
      return;
    }
    if (request.url !== "/downloads/proofweave-research-marketplace.json") {
      response.writeHead(404).end();
      return;
    }
    if (mode === "oversized") {
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(40 * 1024),
      });
      response.end("{}");
      return;
    }
    const manifest = distributionManifest({
      pluginVersion: mode === "update" ? "9.0.0+codex.recommended" : installedVersion,
    });
    if (mode === "malformed") manifest.archive.path = "https://attacker.example/plugin.tar";
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(manifest));
  });
  try {
    const port = await listen(server);
    baseUrl = `https://127.0.0.1:${port}`;
    const configPath = join(fixtureRoot, "connector.json");
    await writeFile(configPath, JSON.stringify({
      ...connectedFixtureConfig(baseUrl),
      accessToken: "access-token-must-not-leak",
      refreshToken: "refresh-token-must-not-leak",
      privateKeyJwk: { d: "private-key-must-not-leak" },
      workspacePath: "/private/workspace/must-not-leak",
    }));
    const env = {
      ...process.env,
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      PROOFWEAVE_BASE_URL: baseUrl,
      PROOFWEAVE_CONNECTOR_CONFIG: configPath,
    };

    const current = JSON.parse((await callConnectorTool("connection_status", {}, env)).result.content[0].text);
    assert.equal(current.connected, true);
    assert.equal(current.distribution.state, "current");
    assert.equal(current.distribution.installedVersion, installedVersion);
    assert.equal(current.distribution.recommendedVersion, installedVersion);
    assert.equal(current.distribution.archive.sha256, "a".repeat(64));
    assert.equal(current.distribution.archive.bytes, 148_992);
    assert.equal(current.distribution.archive.url, `${baseUrl}/downloads/proofweave-research-marketplace.tar`);
    assert.equal(current.distribution.taskAction, "continue_current_task");

    mode = "update";
    const update = JSON.parse((await callConnectorTool("connection_status", {}, env)).result.content[0].text);
    assert.equal(update.connected, true);
    assert.equal(update.distribution.state, "update_available");
    assert.equal(update.distribution.recommendedVersion, "9.0.0+codex.recommended");
    assert.equal(update.distribution.taskAction, "reinstall_then_restart_codex");
    assert.equal(update.distribution.restartRequiredAfterUpdate, true);
    assert.match(update.distribution.message, /show the archive URL, SHA-256, byte size, local paths, and every command/i);
    assert.match(update.distribution.message, /ask for confirmation again/i);
    assert.match(update.distribution.message, /never automatic/i);

    for (const unsafeMode of ["malicious_url", "oversized", "malformed"]) {
      mode = unsafeMode;
      const unknown = JSON.parse((await callConnectorTool("connection_status", {}, env)).result.content[0].text);
      assert.equal(unknown.connected, true);
      assert.equal(unknown.distribution.state, "unknown");
      assert.equal(unknown.distribution.recommendedVersion, null);
      assert.equal(unknown.distribution.archive, null);
      assert.equal(unknown.distribution.taskAction, "continue_current_task");
      assert.match(unknown.distribution.message, /saved OAuth connection is unchanged/i);
    }

    assert.equal(
      requests.filter(({ url }) => url === "/downloads/proofweave-research-marketplace.json").length,
      4,
      "the rejected cross-origin URL must never be fetched",
    );
    for (const request of requests) {
      assert.equal(request.authorization, null);
      assert.equal(request.cookie, null);
      assert.equal(request.agentId, null);
      assert.ok(
        request.url === "/api/mcp/capabilities"
          || request.url === "/downloads/proofweave-research-marketplace.json",
      );
    }
    const observedRequests = JSON.stringify(requests);
    assert.doesNotMatch(observedRequests, /access-token-must-not-leak/);
    assert.doesNotMatch(observedRequests, /refresh-token-must-not-leak/);
    assert.doesNotMatch(observedRequests, /private-key-must-not-leak/);
    assert.doesNotMatch(observedRequests, /private\/workspace\/must-not-leak/);

    await close(server);
    const unavailable = JSON.parse((await callConnectorTool("connection_status", {}, env)).result.content[0].text);
    assert.equal(unavailable.connected, true);
    assert.equal(unavailable.compatibility.state, "unknown");
    assert.equal(unavailable.distribution.state, "unknown");
    assert.match(unavailable.distribution.message, /saved OAuth connection is unchanged/i);
  } finally {
    if (server.listening) await close(server);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the private-beta plugin starts only a local PKCE Connector", async () => {
  const [manifestText, mcpManifestText, connector, pairingRepository] = await Promise.all([
    readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
    readFile(resolve(pluginRoot, ".mcp.json"), "utf8"),
    readFile(resolve(pluginRoot, "mcp/proofweave-local.mjs"), "utf8"),
    readFile(resolve(root, "db/repositories/local-codex-pairing.ts"), "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);
  const mcpManifest = JSON.parse(mcpManifestText);

  assert.equal(manifest.name, "proofweave-research");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.interface.category, "Research");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.mcp, undefined);
  assert.deepEqual(mcpManifest, {
    mcpServers: {
      "proofweave-local": {
        command: "node",
        args: ["./mcp/proofweave-local.mjs"],
        cwd: ".",
      },
    },
  });
  assert.match(connector, /\/api\/connect\/sessions/);
  assert.match(connector, /proofweave-research\.yualex031821\.chatgpt\.site/);
  assert.doesNotMatch(connector, /proofweave-public-demo\.proofweave-research\.workers\.dev/);
  assert.match(connector, /code_verifier/);
  assert.match(connector, /generateKeyPairSync\("ed25519"\)/);
  assert.match(connector, /begin_research/);
  assert.match(connector, /submit_local_evidence/);
  assert.match(connector, /I_CONFIRM_SUBMIT/);
  assert.match(connector, /expectedSha256/);
  assert.match(connector, /prepare_workspace_bundle_v2/);
  assert.match(connector, /I_CONFIRM_PREPARE_WORKSPACE_BUNDLE/);
  assert.match(connector, /prepare_artifact_bundle_v2/);
  assert.match(connector, /stage_prepared_artifact_bundle/);
  assert.match(connector, /I_CONFIRM_STAGE_BUNDLE/);
  assert.match(connector, /pw-artifact-bundle-v2/);
  assert.match(connector, /requiredConnectionScopes/);
  assert.match(connector, /artifact:write/);
  assert.match(connector, /run:request/);
  assert.match(connector, /verification:replay/);
  assert.match(pairingRepository, /research_and_review/);
  assert.match(pairingRepository, /"artifact:write"/);
  assert.match(connector, /likely credential or private key/);
  assert.match(connector, /changingControlPlane/);
  assert.match(connector, /previousAgentPreserved/);
  assert.match(connector, /fresh deployment-scoped Agent identity/);
  assert.doesNotMatch(connector, /PROOFWEAVE_API_TOKEN/);
});

test("the local Connector flags legacy connections for the artifact-write scope upgrade", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-connector-scopes-"));
  try {
    const baseUrl = "https://proofweave.example.test";
    const configPath = join(fixtureRoot, "connector.json");
    const legacy = connectedFixtureConfig(baseUrl);
    await writeFile(configPath, JSON.stringify(legacy));
    const env = { ...process.env, PROOFWEAVE_BASE_URL: baseUrl, PROOFWEAVE_CONNECTOR_CONFIG: configPath };

    const legacyResponse = await callConnectorTool("connection_status", {}, env);
    const legacyStatus = JSON.parse(legacyResponse.result.content[0].text);
    assert.equal(legacyStatus.connected, true);
    assert.equal(legacyStatus.scopeUpgradeRequired, true);
    assert.deepEqual(legacyStatus.missingScopes, ["artifact:write", "run:request", "run:read", "run:cancel"]);

    await writeFile(configPath, JSON.stringify({
      ...legacy,
      version: 2,
      grantedScopes: ["catalog:read", "attempt:create", "attempt:read", "progress:write", "artifact:write", "run:request", "run:read", "run:cancel"],
    }));
    const upgradedResponse = await callConnectorTool("connection_status", {}, env);
    const upgradedStatus = JSON.parse(upgradedResponse.result.content[0].text);
    assert.equal(upgradedStatus.scopeUpgradeRequired, false);
    assert.deepEqual(upgradedStatus.missingScopes, []);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the local Connector refuses to treat a saved connection for another control plane as active", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-connector-control-plane-"));
  try {
    const configPath = join(fixtureRoot, "connector.json");
    await writeFile(configPath, JSON.stringify(connectedFixtureConfig("https://old-proofweave.example.test")));
    const response = await callConnectorTool("connection_status", {}, {
      ...process.env,
      PROOFWEAVE_BASE_URL: "https://proofweave.example.test",
      PROOFWEAVE_CONNECTOR_CONFIG: configPath,
    });
    const status = JSON.parse(response.result.content[0].text);
    assert.equal(status.connected, false);
    assert.equal(status.reconnectRequired, true);
    assert.equal(status.identityRotationRequired, true);
    assert.equal(status.configuredBaseUrl, "https://old-proofweave.example.test");
    assert.equal(status.expectedBaseUrl, "https://proofweave.example.test");
    assert.match(status.message, /approve connect_proofweave/i);
    assert.match(status.message, /fresh Agent identity/i);
    assert.match(status.message, /preserving the previous Agent/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the local Connector rotates an Agent identity before approving a different control plane", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-connector-identity-rotation-"));
  let pairingPayload;
  let resolvePairing;
  const pairingReceived = new Promise((resolve) => { resolvePairing = resolve; });
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      if (request.url === "/api/connect/sessions") {
        pairingPayload = JSON.parse(body);
        response.writeHead(201, { "content-type": "application/json" });
        response.end(JSON.stringify({
          clientId: "client:fresh-control-plane",
          connectionUrl: "http://127.0.0.1:9/approval-is-suppressed-in-this-test",
          expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
        }));
        resolvePairing();
        return;
      }
      if (request.url === "/token") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({
          access_token: "access-fresh-control-plane",
          refresh_token: "refresh-fresh-control-plane",
          expires_in: 3_600,
          scope: "catalog:read attempt:create attempt:read progress:write artifact:write run:request run:read run:cancel",
        }));
        return;
      }
      response.writeHead(404).end();
    });
  });
  try {
    const port = await listen(server);
    const callbackPort = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = join(fixtureRoot, "connector.json");
    const previous = connectedFixtureConfig("https://old-proofweave.example.test");
    await writeFile(configPath, JSON.stringify(previous));
    const connectPromise = callConnectorTool("connect_proofweave", {}, {
      ...process.env,
      PROOFWEAVE_BASE_URL: baseUrl,
      PROOFWEAVE_CONNECTOR_CONFIG: configPath,
      PROOFWEAVE_CALLBACK_PORT: String(callbackPort),
      PROOFWEAVE_DISABLE_BROWSER_OPEN: "1",
    });

    await pairingReceived;
    assert.notEqual(pairingPayload.agentId, previous.agentId);
    assert.notEqual(pairingPayload.agentPublicKey, previous.agentPublicKey);
    assert.match(pairingPayload.agentId, /^urn:pw:agent:codex-/);
    await fetchWithRetry(`http://127.0.0.1:${callbackPort}/callback?code=approved-code&state=${encodeURIComponent(pairingPayload.oauthState)}`);

    const response = await connectPromise;
    assert.equal(response.error, undefined);
    const result = JSON.parse(response.result.content[0].text);
    assert.equal(result.connected, true);
    assert.equal(result.identityRotated, true);
    assert.equal(result.previousAgentPreserved, true);
    const saved = JSON.parse(await readFile(configPath, "utf8"));
    assert.equal(saved.agentId, pairingPayload.agentId);
    assert.notEqual(saved.agentId, previous.agentId);
  } finally {
    await Promise.all([close(server), rm(fixtureRoot, { recursive: true, force: true })]);
  }
});

test("the local Connector exposes connection and bounded research tools over STDIO", async () => {
  const connector = resolve(pluginRoot, "mcp/proofweave-local.mjs");
  const child = spawn(process.execPath, [connector], {
    cwd: root,
    env: { ...process.env, PROOFWEAVE_CONNECTOR_CONFIG: "/tmp/proofweave-plugin-test.json" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  child.stdin.end([
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
  ].join("\n") + "\n");
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(status, 0, errors);
  const responses = output.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(responses[0].result.serverInfo.name, "proofweave-local");
  assert.deepEqual(
    responses[1].result.tools.map((tool) => tool.name),
    [
      "connect_proofweave",
      "connection_status",
      "get_connection_authority",
      "list_frontier_problems",
      "inspect_problem",
      "begin_research",
      "continue_research",
      "create_attempt",
      "report_progress",
      "inspect_research_graph",
      "prepare_research_checkpoint",
      "publish_prepared_research_checkpoint",
      "list_attempts",
      "get_attempt",
      "preview_local_evidence",
      "submit_local_evidence",
      "prepare_workspace_bundle_v2",
      "prepare_artifact_bundle_v2",
      "stage_prepared_artifact_bundle",
      "submit_prepared_research_submission",
      "request_runner_run",
      "get_runner_run",
      "cancel_runner_run",
      "list_review_assignments",
      "get_review_assignment",
      "request_verification_replay",
      "get_verification_replay",
      "prepare_verification_attestation",
      "submit_prepared_verification_attestation",
    ],
  );
});

test("the local Connector publishes only an owner-confirmed, hash-bound research checkpoint", async () => {
  let publishedCheckpoint = null;
  const pair = generateKeyPairSync("ed25519");
  const publicKeyJwk = pair.publicKey.export({ format: "jwk" });
  const privateKeyJwk = pair.privateKey.export({ format: "jwk" });
  const server = createServer((request, response) => {
    assert.equal(request.url, "/api/mcp");
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const { name, arguments: args } = payload.params;
      if (name === "get_attempt") return respondTool(response, {
        attempt: {
          id: args.attemptId,
          problemSlug: "fixture-target",
          problemRevisionId: "revision:fixture-target",
          agentId: "urn:pw:agent:test",
          status: "active",
        },
      });
      if (name === "inspect_problem") return respondTool(response, {
        id: "revision:fixture-target",
        slug: "fixture-target",
        title: "Fixture target",
        declaration: {
          qualifiedName: "Proofweave.Fixture.target",
          sourceContentHash: `sha256:${"1".repeat(64)}`,
        },
        source: {
          revisionTag: "fixture:1",
          leanToolchain: "leanprover/lean4:v4.27.0",
          mathlibRevision: "fixture-mathlib",
        },
      });
      if (name === "inspect_research_graph") return respondTool(response, {
        problem: { id: "revision:fixture-target", slug: "fixture-target" },
        graph: { nodes: [], edges: [], externalWorks: [] },
      });
      if (name === "publish_research_checkpoint") {
        publishedCheckpoint = args.checkpoint;
        return respondTool(response, {
          node: { id: args.checkpoint.id, state: "shared_unverified" },
          graphState: "shared_unverified",
          contributionState: "not_credited",
        });
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: `Unexpected tool: ${name}` } }));
    });
  });
  const port = await listen(server);
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-research-checkpoint-"));
  try {
    assert.equal(typeof publicKeyJwk.x, "string");
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = join(fixtureRoot, "connector.json");
    await writeFile(configPath, JSON.stringify({
      version: 1,
      baseUrl,
      agentId: "urn:pw:agent:test",
      agentLabel: "Test Codex",
      agentPublicKey: publicKeyJwk.x,
      privateKeyJwk,
      clientId: "client:test",
      accessToken: "access-test",
      refreshToken: "refresh-test",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    }));
    const env = { ...process.env, PROOFWEAVE_BASE_URL: baseUrl, PROOFWEAVE_CONNECTOR_CONFIG: configPath };

    const preparedResponse = await callConnectorTool("prepare_research_checkpoint", {
      attemptId: "attempt:test",
      kind: "lemma",
      summary: "Reduced the target to a reusable bounded lemma.",
    }, env);
    assert.equal(preparedResponse.error, undefined);
    const prepared = JSON.parse(preparedResponse.result.content[0].text);
    assert.equal(prepared.published, false);
    assert.equal(prepared.uploadedFiles, false);
    assert.equal(prepared.checkpoint.agentEvent.agentId, "urn:pw:agent:test");
    assert.match(prepared.checkpointHash, /^sha256:[a-f0-9]{64}$/);

    const unconfirmed = await callConnectorTool("publish_prepared_research_checkpoint", {
      ...prepared.publishInput,
      ownerConfirmation: "NO",
    }, env);
    assert.match(unconfirmed.error.message, /explicitly approve/);
    assert.equal(publishedCheckpoint, null);

    const changed = structuredClone(prepared.checkpoint);
    changed.summary = "Changed after review.";
    const tampered = await callConnectorTool("publish_prepared_research_checkpoint", {
      checkpoint: changed,
      expectedCheckpointHash: prepared.checkpointHash,
      ownerConfirmation: "I_CONFIRM_PUBLISH_CHECKPOINT",
    }, env);
    assert.match(tampered.error.message, /changed after the owner reviewed it/);
    assert.equal(publishedCheckpoint, null);

    const approvedResponse = await callConnectorTool("publish_prepared_research_checkpoint", {
      ...prepared.publishInput,
      ownerConfirmation: "I_CONFIRM_PUBLISH_CHECKPOINT",
    }, env);
    assert.equal(approvedResponse.error, undefined);
    const approved = JSON.parse(approvedResponse.result.content[0].text);
    assert.equal(approved.published, true);
    assert.equal(approved.verificationState, "shared_research_only");
    assert.equal(approved.contributionState, "not_credited");
    assert.deepEqual(publishedCheckpoint, prepared.checkpoint);
  } finally {
    await Promise.all([close(server), rm(fixtureRoot, { recursive: true, force: true })]);
  }
});

test("the local Connector starts or resumes a selected research target without exposing protocol fields", async () => {
  const calls = [];
  const attempts = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const { name, arguments: args } = payload.params;
      calls.push({ name, args });
      if (name === "inspect_problem") return respondTool(response, {
        slug: args.slug,
        title: "Fixture frontier target",
        declaration: { qualifiedName: "Proofweave.Fixture.target", sourceContentHash: `sha256:${"1".repeat(64)}` },
        source: { revisionTag: "fixture:1", leanToolchain: "leanprover/lean4:v4.27.0", mathlibRevision: "fixture-mathlib" },
      });
      if (name === "list_attempts") return respondTool(response, { attempts });
      if (name === "create_attempt") {
        const attempt = {
          id: `attempt:${attempts.length + 1}`,
          problemSlug: args.problemSlug,
          delegationScope: args.delegationScope,
          status: "active",
        };
        attempts.push(attempt);
        return respondTool(response, { attempt, verificationState: "agent_reported_only" });
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: `Unexpected tool: ${name}` } }));
    });
  });
  const port = await listen(server);
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-research-start-"));
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = join(fixtureRoot, "connector.json");
    await writeFile(configPath, JSON.stringify(connectedFixtureConfig(baseUrl)));
    const env = { ...process.env, PROOFWEAVE_BASE_URL: baseUrl, PROOFWEAVE_CONNECTOR_CONFIG: configPath };

    const started = await callConnectorTool("begin_research", { targetSlug: "fixture-target" }, env);
    assert.equal(started.error, undefined);
    const first = JSON.parse(started.result.content[0].text);
    assert.equal(first.operation, "research_started");
    assert.equal(first.created, true);
    assert.equal(first.attempt.problemSlug, "fixture-target");
    assert.equal(first.uploaded, false);
    assert.equal(first.recordedProgress, false);
    assert.equal(calls.filter((call) => call.name === "create_attempt").length, 1);
    assert.equal(calls.find((call) => call.name === "create_attempt").args.delegationScope, "formalize");
    assert.equal("idempotencyKey" in first, false);

    const resumed = await callConnectorTool("continue_research", { attemptId: first.attempt.id, targetSlug: "fixture-target" }, env);
    assert.equal(resumed.error, undefined);
    const second = JSON.parse(resumed.result.content[0].text);
    assert.equal(second.operation, "research_resumed");
    assert.equal(second.created, false);
    assert.equal(second.attempt.id, first.attempt.id);
    assert.equal(calls.filter((call) => call.name === "create_attempt").length, 1);

    attempts[0].status = "paused";
    const paused = await callConnectorTool("continue_research", { attemptId: first.attempt.id, targetSlug: "fixture-target" }, env);
    assert.equal(paused.error, undefined);
    const pausedResult = JSON.parse(paused.result.content[0].text);
    assert.equal(pausedResult.operation, "research_resume_required");
    assert.equal(pausedResult.attempt.id, first.attempt.id);
    assert.match(pausedResult.next, /same Attempt/i);
    const beginPaused = await callConnectorTool("begin_research", { targetSlug: "fixture-target" }, env);
    assert.equal(JSON.parse(beginPaused.result.content[0].text).operation, "research_resume_required");
    assert.equal(calls.filter((call) => call.name === "create_attempt").length, 1);

    attempts[0].status = "completed";
    const terminal = await callConnectorTool("continue_research", { attemptId: first.attempt.id }, env);
    assert.equal(terminal.error, undefined);
    assert.equal(JSON.parse(terminal.result.content[0].text).operation, "research_attempt_terminal");
    attempts[0].status = "active";

    const mismatch = await callConnectorTool("continue_research", { targetSlug: "website-only-target" }, env);
    assert.equal(mismatch.error, undefined);
    const mismatchResult = JSON.parse(mismatch.result.content[0].text);
    assert.equal(mismatchResult.operation, "research_connection_mismatch");
    assert.equal(mismatchResult.recordedProgress, false);
    assert.match(mismatchResult.next, /Do not create a duplicate Attempt/i);
    assert.equal(calls.filter((call) => call.name === "create_attempt").length, 1);
  } finally {
    await Promise.all([close(server), rm(fixtureRoot, { recursive: true, force: true })]);
  }
});

test("the local Connector explains a sandboxed DNS failure without exposing a credential", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-connector-network-"));
  try {
    const result = await callConnectorTool("connect_proofweave", {}, {
      ...process.env,
      PROOFWEAVE_BASE_URL: "https://proofweave.invalid",
      PROOFWEAVE_CONNECTOR_CONFIG: join(fixtureRoot, "connector.json"),
    });
    assert.match(result.error.message, /cannot (resolve|reach) proofweave\.invalid/);
    assert.match(result.error.message, /no permitted network route/);
    assert.doesNotMatch(result.error.message, /token|private key/i);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("the local Connector submits only an owner-confirmed, hash-bound evidence preview", async () => {
  const receivedObjects = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const { name, arguments: args } = payload.params;
      if (name === "get_attempt") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ attempt: { id: args.attemptId } }) }] } }));
        return;
      }
      if (name === "put_artifact_object") {
        receivedObjects.push(args);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ object: { contentHash: `sha256:${createHash("sha256").update(Buffer.from(args.contentBase64Url, "base64url")).digest("hex")}`, objectKey: "bundles/sha256/test/fixture.lean" }, storageState: "object_staged_only", verificationState: "not_verified" }) }] } }));
        return;
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: `Unexpected tool: ${name}` } }));
    });
  });
  const port = await listen(server);
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-local-evidence-"));
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = join(fixtureRoot, "connector.json");
    const evidencePath = join(fixtureRoot, "Fixture.lean");
    const contents = Buffer.from("theorem fixture : True := by trivial\n", "utf8");
    const sha256 = `sha256:${createHash("sha256").update(contents).digest("hex")}`;
    await Promise.all([
      writeFile(evidencePath, contents),
      writeFile(configPath, JSON.stringify({
        version: 1,
        baseUrl,
        agentId: "urn:pw:agent:test",
        agentLabel: "Test Codex",
        agentPublicKey: "A".repeat(43),
        privateKeyJwk: {},
        clientId: "client:test",
        accessToken: "access-test",
        refreshToken: "refresh-test",
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      })),
    ]);
    const env = { ...process.env, PROOFWEAVE_BASE_URL: baseUrl, PROOFWEAVE_CONNECTOR_CONFIG: configPath };
    const success = await callConnectorTool("submit_local_evidence", {
      attemptId: "attempt:test",
      paths: [evidencePath],
      expectedSha256: [sha256],
      ownerConfirmation: "I_CONFIRM_SUBMIT",
    }, env);
    const submitted = JSON.parse(success.result.content[0].text);
    assert.equal(submitted.storageState, "object_staged_only");
    assert.equal(submitted.verificationState, "not_verified");
    assert.equal(submitted.files[0].sha256, sha256);
    assert.equal(receivedObjects.length, 1);
    assert.equal(receivedObjects[0].contentBase64Url, contents.toString("base64url"));

    const changed = await callConnectorTool("submit_local_evidence", {
      attemptId: "attempt:test",
      paths: [evidencePath],
      expectedSha256: [`sha256:${"0".repeat(64)}`],
      ownerConfirmation: "I_CONFIRM_SUBMIT",
    }, env);
    assert.match(changed.error.message, /changed since the owner reviewed it/);
    assert.equal(receivedObjects.length, 1);
  } finally {
    await Promise.all([close(server), rm(fixtureRoot, { recursive: true, force: true })]);
  }
});

test("the local Connector prepares and stages one signed, hash-bound v2 Artifact Bundle only after a second confirmation", async () => {
  const receivedObjects = [];
  let stagedBundle = null;
  let requestedRun = null;
  let rejectRunnerRequests = false;
  let expectedManifestHash = null;
  let rejectArtifactWrites = true;
  const targetHash = `sha256:${"1".repeat(64)}`;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const { name, arguments: args } = payload.params;
      if (name === "get_attempt") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({ attempt: { id: args.attemptId, problemSlug: "fixture-problem", problemRevisionId: "revision:fixture" } }) }] } }));
        return;
      }
      if (name === "inspect_problem") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
          slug: "fixture-problem",
          declaration: { qualifiedName: "Proofweave.Fixture.target", sourceContentHash: targetHash },
          source: { leanToolchain: "leanprover/lean4:v4.27.0", mathlibRevision: "fixture-revision" },
        }) }] } }));
        return;
      }
      if (name === "put_artifact_object") {
        if (rejectArtifactWrites) {
          respondToolError(response, "Missing OAuth scope: artifact:write.");
          return;
        }
        const bytes = Buffer.from(args.contentBase64Url, "base64url");
        const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
        receivedObjects.push(args);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
          object: { contentHash, objectKey: `bundles/sha256/${contentHash.slice("sha256:".length)}/${args.filename}` },
          storageState: "object_staged_only",
          verificationState: "not_verified",
        }) }] } }));
        return;
      }
      if (name === "stage_artifact_bundle") {
        stagedBundle = args.bundle;
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
          storageState: "bundle_staged_only",
          verificationState: "not_verified",
          bundle: {
            id: args.bundle.id,
            manifestHash: expectedManifestHash,
            manifestKey: `bundles/sha256/${expectedManifestHash.slice("sha256:".length)}/bundle.json`,
            agentEventId: args.bundle.agentEvent.eventId,
          },
        }) }] } }));
        return;
      }
      if (name === "request_runner_run") {
        requestedRun = args;
        if (rejectRunnerRequests) {
          respondToolError(response, "Runner dispatch is not configured.");
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify({
          run: {
            id: "run:fixture-submission",
            attemptId: args.attemptId,
            artifactBundleHash: args.artifactBundleHash,
            state: "queued",
          },
          verificationState: "not_verified",
        }) }] } }));
        return;
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: `Unexpected tool: ${name}` } }));
    });
  });
  const port = await listen(server);
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-local-bundle-"));
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = join(fixtureRoot, "connector.json");
    const sourceArchivePath = join(fixtureRoot, "source.tar.zst");
    const patchPath = join(fixtureRoot, "normalized.patch");
    const lakeManifestPath = join(fixtureRoot, "lake-manifest.json");
    const sourceArchive = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from("fixture-zstd-bytes")]);
    const patch = Buffer.from("diff --git a/Main.lean b/Main.lean\nindex 1111111..2222222 100644\n--- a/Main.lean\n+++ b/Main.lean\n@@ -0,0 +1 @@\n+theorem fixture : True := by trivial\n", "utf8");
    const lakeManifest = Buffer.from("{\"name\":\"fixture\"}\n", "utf8");
    const mainLean = Buffer.from("theorem fixture : True := by trivial\n", "utf8");
    const pair = generateKeyPairSync("ed25519");
    const publicKeyJwk = pair.publicKey.export({ format: "jwk" });
    const privateKeyJwk = pair.privateKey.export({ format: "jwk" });
    assert.equal(publicKeyJwk.kty, "OKP");
    assert.equal(publicKeyJwk.crv, "Ed25519");
    assert.equal(typeof publicKeyJwk.x, "string");
    await Promise.all([
      writeFile(sourceArchivePath, sourceArchive),
      writeFile(patchPath, patch),
      writeFile(lakeManifestPath, lakeManifest),
      writeFile(configPath, JSON.stringify({
        version: 1,
        baseUrl,
        agentId: "urn:pw:agent:test",
        agentLabel: "Test Codex",
        agentPublicKey: publicKeyJwk.x,
        privateKeyJwk,
        clientId: "client:test",
        accessToken: "access-test",
        refreshToken: "refresh-test",
        accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      })),
    ]);
    const artifactHashes = {
      sourceArchive: sha256(sourceArchive),
      patch: sha256(patch),
      lakeManifest: sha256(lakeManifest),
    };
    const env = { ...process.env, PROOFWEAVE_BASE_URL: baseUrl, PROOFWEAVE_CONNECTOR_CONFIG: configPath };
    const draftResponse = await callConnectorTool("prepare_artifact_bundle_v2", {
      attemptId: "attempt:fixture",
      artifacts: { sourceArchivePath, patchPath, lakeManifestPath },
      workspaceTree: [
        { path: "Main.lean", mode: 0o644, contentHash: sha256(mainLean) },
        { path: "lake-manifest.json", mode: 0o644, contentHash: artifactHashes.lakeManifest },
      ],
      maxExpandedBytes: 1_000_000,
      maxFileCount: 12,
      entryFile: "Main.lean",
      allowedAxioms: [],
    }, env);
    assert.equal(draftResponse.error, undefined);
    const draft = JSON.parse(draftResponse.result.content[0].text);
    assert.equal(draft.operation, "local_bundle_preparation");
    assert.equal(draft.uploaded, false);
    assert.equal(draft.staged, false);
    assert.equal(draft.bundle.protocolVersion, "pw-artifact-bundle-v2");
    assert.equal(draft.bundle.agentEvent.agentPublicKey, publicKeyJwk.x);
    assert.match(draft.manifestHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(receivedObjects.length, 0);
    expectedManifestHash = draft.manifestHash;

    const missingScopeResponse = await callConnectorTool("stage_prepared_artifact_bundle", {
      bundle: draft.bundle,
      artifacts: { sourceArchivePath, patchPath, lakeManifestPath },
      expectedArtifactSha256: artifactHashes,
      expectedBundleHash: draft.manifestHash,
      ownerConfirmation: "I_CONFIRM_STAGE_BUNDLE",
    }, env);
    assert.match(missingScopeResponse.error.message, /missing OAuth scope artifact:write/);
    assert.match(missingScopeResponse.error.message, /connect_proofweave/);
    assert.doesNotMatch(missingScopeResponse.error.message, /immutable object/);
    assert.equal(receivedObjects.length, 0);

    rejectArtifactWrites = false;
    const stagedResponse = await callConnectorTool("stage_prepared_artifact_bundle", {
      bundle: draft.bundle,
      artifacts: { sourceArchivePath, patchPath, lakeManifestPath },
      expectedArtifactSha256: artifactHashes,
      expectedBundleHash: draft.manifestHash,
      ownerConfirmation: "I_CONFIRM_STAGE_BUNDLE",
    }, env);
    assert.equal(stagedResponse.error, undefined);
    const staged = JSON.parse(stagedResponse.result.content[0].text);
    assert.equal(staged.storageState, "bundle_staged_only");
    assert.equal(staged.verificationState, "not_verified");
    assert.equal(staged.bundle.manifestHash, draft.manifestHash);
    assert.equal(receivedObjects.length, 3);
    assert.equal(stagedBundle.id, draft.bundle.id);
    assert.equal(stagedBundle.workspace.archive.contentHash, artifactHashes.sourceArchive);
    assert.match(stagedBundle.agentEvent.signature, /^[A-Za-z0-9_-]{86}$/);
    assert.equal(normalizeArtifactBundle(stagedBundle).protocolVersion, "pw-artifact-bundle-v2");
    assert.equal(await verifyArtifactBundleAgentSignature(stagedBundle), true);

    const beforeUnifiedSubmission = receivedObjects.length;
    const unconfirmedSubmission = await callConnectorTool("submit_prepared_research_submission", {
      bundle: draft.bundle,
      artifacts: { sourceArchivePath, patchPath, lakeManifestPath },
      expectedArtifactSha256: artifactHashes,
      expectedBundleHash: draft.manifestHash,
      runIdempotencyKey: "run:fixture-submission",
      ownerConfirmation: "NO",
    }, env);
    assert.match(unconfirmedSubmission.error.message, /explicitly confirm/);
    assert.equal(receivedObjects.length, beforeUnifiedSubmission);
    assert.equal(requestedRun, null);

    const unifiedSubmissionResponse = await callConnectorTool("submit_prepared_research_submission", {
      bundle: draft.bundle,
      artifacts: { sourceArchivePath, patchPath, lakeManifestPath },
      expectedArtifactSha256: artifactHashes,
      expectedBundleHash: draft.manifestHash,
      runIdempotencyKey: "run:fixture-submission",
      ownerConfirmation: "I_CONFIRM_STAGE_AND_RUN",
    }, env);
    assert.equal(unifiedSubmissionResponse.error, undefined);
    const unifiedSubmission = JSON.parse(unifiedSubmissionResponse.result.content[0].text);
    assert.equal(unifiedSubmission.submissionState, "bundle_staged_run_requested");
    assert.equal(unifiedSubmission.bundle.manifestHash, draft.manifestHash);
    assert.equal(unifiedSubmission.run.id, "run:fixture-submission");
    assert.equal(requestedRun.artifactBundleHash, draft.manifestHash);
    assert.equal(requestedRun.idempotencyKey, "run:fixture-submission");
    assert.equal(receivedObjects.length, beforeUnifiedSubmission + 3);

    rejectRunnerRequests = true;
    const stagedOnlyResponse = await callConnectorTool("submit_prepared_research_submission", {
      bundle: draft.bundle,
      artifacts: { sourceArchivePath, patchPath, lakeManifestPath },
      expectedArtifactSha256: artifactHashes,
      expectedBundleHash: draft.manifestHash,
      runIdempotencyKey: "run:fixture-dispatch-unavailable",
      ownerConfirmation: "I_CONFIRM_STAGE_AND_RUN",
    }, env);
    assert.equal(stagedOnlyResponse.error, undefined);
    const stagedOnly = JSON.parse(stagedOnlyResponse.result.content[0].text);
    assert.equal(stagedOnly.submissionState, "bundle_staged_run_not_requested");
    assert.equal(stagedOnly.bundle.manifestHash, draft.manifestHash);
    assert.equal(stagedOnly.run, null);
    assert.match(stagedOnly.runnerRequestError, /dispatch is not configured/);
    assert.match(stagedOnly.next, /do not upload the Bundle again/);
    rejectRunnerRequests = false;

    const workspaceRoot = join(fixtureRoot, "lean-workspace");
    await mkdir(workspaceRoot);
    await Promise.all([
      writeFile(join(workspaceRoot, ".gitignore"), ".lake/\n"),
      writeFile(join(workspaceRoot, "Main.lean"), "theorem fixture : True := by trivial\n"),
      writeFile(join(workspaceRoot, "lake-manifest.json"), "{\"name\":\"fixture\"}\n"),
      writeFile(join(workspaceRoot, "lean-toolchain"), "leanprover/lean4:v4.27.0\n"),
    ]);
    await git(workspaceRoot, ["init", "-q"]);
    await git(workspaceRoot, ["config", "user.email", "fixture@example.test"]);
    await git(workspaceRoot, ["config", "user.name", "Proofweave fixture"]);
    await git(workspaceRoot, ["add", "."]);
    await git(workspaceRoot, ["commit", "-qm", "baseline"]);
    await writeFile(join(workspaceRoot, "Main.lean"), "theorem fixture : True := by exact True.intro\n");

    const receivedBeforeWorkspaceDraft = receivedObjects.length;
    const workspaceDraftResponse = await callConnectorTool("prepare_workspace_bundle_v2", {
      attemptId: "attempt:fixture",
      workspaceRoot,
      entryFile: "Main.lean",
      ownerConfirmation: "I_CONFIRM_PREPARE_WORKSPACE_BUNDLE",
    }, env);
    assert.equal(workspaceDraftResponse.error, undefined);
    const workspaceDraft = JSON.parse(workspaceDraftResponse.result.content[0].text);
    assert.equal(workspaceDraft.operation, "local_workspace_bundle_preparation");
    assert.equal(workspaceDraft.uploaded, false);
    assert.equal(workspaceDraft.workspace.trackedFiles, 4);
    assert.equal(workspaceDraft.workspace.changedFiles[0], "Main.lean");
    assert.equal(receivedObjects.length, receivedBeforeWorkspaceDraft);
    assert.equal(workspaceDraft.bundle.protocolVersion, "pw-artifact-bundle-v2");
    assert.equal(workspaceDraft.bundle.workspace.tree.hash.startsWith("sha256:"), true);
    const generatedArchive = await readFile(workspaceDraft.stageInput.artifacts.sourceArchivePath);
    const generatedPatch = await readFile(workspaceDraft.stageInput.artifacts.patchPath, "utf8");
    assert.deepEqual([...generatedArchive.subarray(0, 4)], [0x28, 0xb5, 0x2f, 0xfd]);
    assert.match(generatedPatch, /^diff --git a\/Main\.lean b\/Main\.lean/m);
    const workspaceHashes = Object.fromEntries(workspaceDraft.artifacts.map((artifact) => [artifact.filename, artifact.sha256]));
    expectedManifestHash = workspaceDraft.manifestHash;
    const workspaceStagedResponse = await callConnectorTool("stage_prepared_artifact_bundle", {
      bundle: workspaceDraft.bundle,
      artifacts: workspaceDraft.stageInput.artifacts,
      expectedArtifactSha256: {
        sourceArchive: workspaceHashes["source.tar.zst"],
        patch: workspaceHashes["normalized.patch"],
        lakeManifest: workspaceHashes["lake-manifest.json"],
      },
      expectedBundleHash: workspaceDraft.manifestHash,
      ownerConfirmation: "I_CONFIRM_STAGE_BUNDLE",
    }, env);
    assert.equal(workspaceStagedResponse.error, undefined);
    assert.equal(receivedObjects.length, receivedBeforeWorkspaceDraft + 3);
  } finally {
    await Promise.all([close(server), rm(fixtureRoot, { recursive: true, force: true })]);
  }
});

test("the local Connector prepares and submits only an owner-confirmed review-Agent attestation", async () => {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyJwk = pair.publicKey.export({ format: "jwk" });
  const privateKeyJwk = pair.privateKey.export({ format: "jwk" });
  assert.equal(typeof publicKeyJwk.x, "string");
  const assignmentId = "assignment:review-fixture";
  const delegationCertificateId = "pw:delegation:review-fixture";
  const artifactBundleHash = `sha256:${"a".repeat(64)}`;
  const evidenceHash = `sha256:${"b".repeat(64)}`;
  let submittedAttestation = null;
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const payload = JSON.parse(body);
      const { name, arguments: args } = payload.params;
      if (name === "get_connection_authority") return respondTool(response, {
        personId: "person:reviewer",
        agentInstallationId: "installation:review-fixture",
        agentId: "urn:pw:agent:test",
        agentLabel: "Test review Codex",
        agentPublicKey: publicKeyJwk.x,
        delegationCertificateId,
        oauthScopes: ["catalog:read", "verification:replay", "verification:write"],
      });
      if (name === "get_verification_replay") return respondTool(response, {
        replay: {
          assignmentId,
          artifactBundleManifestHash: artifactBundleHash,
          requesterPersonId: "person:reviewer",
          requesterAgentId: "urn:pw:agent:test",
          delegationCertificateId,
          idempotencyKey: args.idempotencyKey,
        },
        replayEvidence: { evidenceHash },
        verificationState: "fresh_replay_evidence_recorded",
      });
      if (name === "submit_verification_attestation") {
        submittedAttestation = args.attestation;
        return respondTool(response, { assignment: { id: assignmentId, status: "completed" } });
      }
      response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: `Unexpected tool: ${name}` } }));
    });
  });
  const port = await listen(server);
  const fixtureRoot = await mkdtemp(join(tmpdir(), "proofweave-review-attestation-"));
  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const configPath = join(fixtureRoot, "connector.json");
    await writeFile(configPath, JSON.stringify({
      version: 3,
      connectionMode: "review",
      grantedScopes: ["catalog:read", "verification:replay", "verification:write"],
      baseUrl,
      agentId: "urn:pw:agent:test",
      agentLabel: "Test review Codex",
      agentPublicKey: publicKeyJwk.x,
      privateKeyJwk,
      clientId: "client:review-fixture",
      accessToken: "access-review-fixture",
      refreshToken: "refresh-review-fixture",
      accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    }));
    const env = { ...process.env, PROOFWEAVE_BASE_URL: baseUrl, PROOFWEAVE_CONNECTOR_CONFIG: configPath };
    const preparedResponse = await callConnectorTool("prepare_verification_attestation", {
      assignmentId,
      artifactBundleHash,
      claimType: "bundle_reproducible",
      decision: "attested",
      evidenceHash,
      replayIdempotencyKey: "review-replay-fixture",
    }, env);
    assert.equal(preparedResponse.error, undefined);
    const prepared = JSON.parse(preparedResponse.result.content[0].text);
    assert.equal(prepared.submitted, false);
    assert.equal(prepared.createsReceipt, false);
    assert.equal(prepared.createsCredit, false);
    assert.equal(prepared.attestation.verifierPersonId, "person:reviewer");
    assert.equal(prepared.attestation.artifactBundleHash, artifactBundleHash);
    assert.equal(await verifyVerificationAttestationSignature(prepared.attestation), true);

    const unconfirmed = await callConnectorTool("submit_prepared_verification_attestation", {
      ...prepared.submitInput,
      ownerConfirmation: "NO",
    }, env);
    assert.match(unconfirmed.error.message, /explicitly approve/);
    assert.equal(submittedAttestation, null);

    const changed = structuredClone(prepared.attestation);
    changed.decision = "rejected";
    const tampered = await callConnectorTool("submit_prepared_verification_attestation", {
      attestation: changed,
      expectedPayloadHash: prepared.payloadHash,
      ownerConfirmation: "I_CONFIRM_SUBMIT_VERIFICATION",
    }, env);
    assert.match(tampered.error.message, /changed after the owner reviewed it/);
    assert.equal(submittedAttestation, null);

    const approvedResponse = await callConnectorTool("submit_prepared_verification_attestation", prepared.submitInput, env);
    assert.equal(approvedResponse.error, undefined);
    const approved = JSON.parse(approvedResponse.result.content[0].text);
    assert.equal(approved.submitted, true);
    assert.equal(approved.createsReceipt, false);
    assert.deepEqual(submittedAttestation, prepared.attestation);
  } finally {
    await Promise.all([close(server), rm(fixtureRoot, { recursive: true, force: true })]);
  }
});

async function callConnectorTool(name, args, env) {
  const connector = resolve(pluginRoot, "mcp/proofweave-local.mjs");
  const child = spawn(process.execPath, [connector], { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { errors += chunk; });
  child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })}\n`);
  const status = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(status, 0, errors);
  return JSON.parse(output.trim());
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

async function availablePort() {
  const server = createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Callback returned HTTP ${response.status}.`);
      return response;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function respondTool(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ result: { content: [{ type: "text", text: JSON.stringify(value) }] } }));
}

function respondToolError(response, message) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ result: { content: [{ type: "text", text: message }], isError: true } }));
}

function connectedFixtureConfig(baseUrl) {
  return {
    version: 1,
    baseUrl,
    agentId: "urn:pw:agent:test",
    agentLabel: "Test Codex",
    agentPublicKey: "A".repeat(43),
    privateKeyJwk: {},
    clientId: "client:test",
    accessToken: "access-test",
    refreshToken: "refresh-test",
    accessTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
  };
}

function distributionManifest({ pluginVersion }) {
  return {
    schemaVersion: "pw-codex-plugin-distribution-v1",
    marketplaceName: "proofweave-private-beta",
    pluginName: "proofweave-research",
    pluginVersion,
    archive: {
      path: "/downloads/proofweave-research-marketplace.tar",
      filename: "proofweave-research-marketplace.tar",
      sha256: "a".repeat(64),
      bytes: 148_992,
    },
    compatibility: {
      protocolVersion: "pw-local-connector-v1",
      connectorApiVersion: 1,
      toolSchemaVersion: 1,
    },
  };
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function git(cwd, args) {
  await execFileAsync("git", args, { cwd });
}
