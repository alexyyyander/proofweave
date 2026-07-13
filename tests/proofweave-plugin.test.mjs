import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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

test("the plugin stays fail-closed until a reviewed remote MCP release exists", async () => {
  const [manifestText, files] = await Promise.all([
    readFile(resolve(pluginRoot, ".codex-plugin/plugin.json"), "utf8"),
    readdir(pluginRoot, { recursive: true }),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.name, "proofweave-research");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.interface.category, "Research");
  assert.equal(manifest.mcpServers, undefined);
  assert.equal(manifest.mcp, undefined);
  assert.equal(files.some((file) => file === ".mcp.json" || file.endsWith("/.mcp.json")), false);
});
