import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const runtimeSources = [
  "services/proofweave-mcp-gateway/runner-dispatch.mjs",
  "services/proofweave-mcp-gateway/runtime.mjs",
  "services/lean-runner/hosted-runner-wake-client.mjs",
  "services/lean-runner/hosted-trusted-runner.mjs",
  "services/lean-runner/hosted-trusted-runner-main.mjs",
  "services/lean-runner/trusted-runner-process.mjs",
  "services/lean-runner/e2b-sandbox-container.mjs",
];
const forbiddenRuntimeDependencies = [
  ["GitHub environment input", /\bGITHUB_[A-Z0-9_]+\b/],
  ["GitHub API", /\bapi\.github\.com\b/i],
  ["Actions dispatch event", /\brepository_dispatch\b/],
  ["Actions event payload", /\bgithub\.event\b/i],
];

for (const filename of runtimeSources) {
  const source = await readFile(new URL(`../${filename}`, import.meta.url), "utf8");
  for (const [label, pattern] of forbiddenRuntimeDependencies) {
    if (pattern.test(source)) {
      throw new Error(`${filename} contains a forbidden ${label} dependency in the primary hosted runtime.`);
    }
  }
}

const environment = { ...process.env, PROOFWEAVE_GITHUB_RECOVERY_ENABLED: "false" };
for (const key of Object.keys(environment)) {
  if (key.startsWith("GITHUB_")) delete environment[key];
}

const result = spawnSync(
  process.execPath,
  ["--test", "tests/github-independent-runtime.test.mjs"],
  {
    cwd: new URL("..", import.meta.url),
    env: environment,
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
