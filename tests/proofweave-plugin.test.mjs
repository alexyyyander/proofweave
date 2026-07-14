import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
    ],
  );
});
