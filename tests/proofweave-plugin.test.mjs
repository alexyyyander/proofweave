import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceSkillRoot = resolve(root, "skills/proofweave-research");
const pluginRoot = resolve(root, "plugins/proofweave-research");
const pluginSkillRoot = resolve(pluginRoot, "skills/proofweave-research");

test("the portable Proofweave Codex plugin carries the checked source skill", async () => {
  const [sourceSkill, bundledSkill, sourceReference, bundledReference] = await Promise.all([
    readFile(resolve(sourceSkillRoot, "SKILL.md"), "utf8"),
    readFile(resolve(pluginSkillRoot, "SKILL.md"), "utf8"),
    readFile(resolve(sourceSkillRoot, "references/mcp-tools.md"), "utf8"),
    readFile(resolve(pluginSkillRoot, "references/mcp-tools.md"), "utf8"),
  ]);

  assert.equal(bundledSkill, sourceSkill);
  assert.equal(bundledReference, sourceReference);
});

test("the private-beta plugin starts only a local PKCE Connector", async () => {
  const [manifestText, mcpManifestText, connector] = await Promise.all([
    readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
    readFile(resolve(pluginRoot, ".mcp.json"), "utf8"),
    readFile(resolve(pluginRoot, "mcp/proofweave-local.mjs"), "utf8"),
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
  assert.match(connector, /code_verifier/);
  assert.match(connector, /generateKeyPairSync\("ed25519"\)/);
  assert.match(connector, /submit_local_evidence/);
  assert.match(connector, /I_CONFIRM_SUBMIT/);
  assert.match(connector, /expectedSha256/);
  assert.match(connector, /likely credential or private key/);
  assert.doesNotMatch(connector, /PROOFWEAVE_API_TOKEN/);
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
      "list_frontier_problems",
      "inspect_problem",
      "create_attempt",
      "report_progress",
      "list_attempts",
      "get_attempt",
      "preview_local_evidence",
      "submit_local_evidence",
    ],
  );
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

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
