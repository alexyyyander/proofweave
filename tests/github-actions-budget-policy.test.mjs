import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrls = {
  ci: new URL("../.github/workflows/ci.yml", import.meta.url),
  e2b: new URL("../.github/workflows/e2b-lean-runner.yml", import.meta.url),
  image: new URL("../.github/workflows/build-e2b-lean-runner-image.yml", import.meta.url),
};
const packageUrl = new URL("../package.json", import.meta.url);

async function readWorkflows() {
  const entries = await Promise.all(
    Object.entries(workflowUrls).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
  );
  return Object.fromEntries(entries);
}

async function readPackageScripts() {
  return JSON.parse(await readFile(packageUrl, "utf8")).scripts;
}

function triggerBlock(workflow) {
  const match = workflow.match(/^on:\n(?<block>[\s\S]*?)^\S/m);
  assert.ok(match?.groups?.block, "workflow must have a top-level on block");
  return match.groups.block;
}

function yamlBlock(source, key, indentation) {
  const prefix = " ".repeat(indentation);
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${prefix}${key}:`);
  assert.notEqual(start, -1, `missing ${key} block at indentation ${indentation}`);

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const leadingSpaces = line.length - line.trimStart().length;
    if (leadingSpaces <= indentation) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

test("full CI runs only for manual requests, pull requests, and main pushes", async () => {
  const { ci } = await readWorkflows();
  const triggers = triggerBlock(ci);

  assert.match(triggers, /^  workflow_dispatch:\s*$/m);
  assert.match(triggers, /^  push:\n    branches: \[main\]\s*$/m);
  assert.match(triggers, /^  pull_request:\s*$/m);
  assert.doesNotMatch(triggers, /branches: \["\*\*"\]/);
  assert.doesNotMatch(triggers, /^  (schedule|repository_dispatch|workflow_call):/m);
});

test("README and docs-only changes do not consume a full CI run", async () => {
  const { ci } = await readWorkflows();
  const triggers = triggerBlock(ci);

  const readmeIgnores = triggers.match(/^\s+- "README\.md"\s*$/gm) ?? [];
  const docsIgnores = triggers.match(/^\s+- "docs\/\*\*"\s*$/gm) ?? [];
  assert.equal(readmeIgnores.length, 2, "push and pull_request must both ignore README.md");
  assert.equal(docsIgnores.length, 2, "push and pull_request must both ignore docs/**");
});

test("full CI cancels a superseded run for the same PR or ref", async () => {
  const { ci } = await readWorkflows();

  assert.match(
    ci,
    /^concurrency:\n  group: check-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n  cancel-in-progress: true\s*$/m,
  );
});

test("PR and release events select exactly one mutually exclusive job", async () => {
  const { ci } = await readWorkflows();
  const jobs = yamlBlock(ci, "jobs", 0);
  const jobNames = [...jobs.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map((match) => match[1]);
  const fast = yamlBlock(jobs, "fast", 2);
  const full = yamlBlock(jobs, "full", 2);

  assert.deepEqual(jobNames, ["fast", "full"]);
  assert.match(fast, /^\s+if: \$\{\{ github\.event_name == 'pull_request' \}\}\s*$/m);
  assert.match(
    full,
    /^\s+if: \$\{\{ github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch' \}\}\s*$/m,
  );
  assert.match(fast, /^\s+- run: npm run check:fast\s*$/m);
  assert.doesNotMatch(fast, /^\s+- run: npm run check\s*$/m);
  assert.match(full, /^\s+- run: npm run check\s*$/m);
  assert.doesNotMatch(full, /^\s+- run: npm run check:fast\s*$/m);
});

test("both CI jobs are bounded and use the workflow's read-only permission", async () => {
  const { ci } = await readWorkflows();
  const jobs = yamlBlock(ci, "jobs", 0);
  const timeouts = [...jobs.matchAll(/^\s+timeout-minutes: (\d+)\s*$/gm)].map((match) =>
    Number(match[1]),
  );

  assert.match(ci, /^permissions:\n  contents: read\s*$/m);
  assert.equal(timeouts.length, 2, "every CI job must have an explicit timeout");
  assert.ok(timeouts.every((timeout) => timeout <= 15), "CI job timeout must not exceed 15 minutes");
});

test("CI dependencies are pinned to immutable reviewed revisions", async () => {
  const { ci } = await readWorkflows();
  const checkout = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
  const setupNode = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";

  assert.equal(ci.match(new RegExp(checkout, "g"))?.length, 2);
  assert.equal(ci.match(new RegExp(setupNode, "g"))?.length, 2);
  assert.doesNotMatch(ci, /uses:\s+actions\/(?:checkout|setup-node)@v\d/);
});

test("the fast gate covers static checks and core protocol tests without expensive suites", async () => {
  const scripts = await readPackageScripts();
  const fast = scripts["check:fast"];

  assert.equal(typeof fast, "string", "package.json must define check:fast");
  for (const required of [
    "npm run lint",
    "npm run typecheck",
    "npm run release:manifest:check",
    "npm run actions:policy:check",
    "npm run delegation:check",
    "npm run artifact:check",
    "tests/runner-queue.test.mjs",
    "tests/run-state.test.mjs",
    "npm run verification:check",
    "npm run receipt:check",
    "packages/protocol/research-checkpoint.mjs",
    "tests/research-checkpoint.test.mjs",
  ]) {
    assert.ok(fast.includes(required), `check:fast must include ${required}`);
  }

  assert.doesNotMatch(fast, /(?:^|&&\s*)npm run build(?:\s|$)/);
  assert.doesNotMatch(fast, /(?:^|&&\s*)npm test(?:\s|$)/);
  assert.doesNotMatch(fast, /\b(?:miniflare|wrangler|d1-|turso|network)\b/i);
});

test("E2B verification is event-driven with only a six-hour recovery sweep", async () => {
  const { e2b } = await readWorkflows();
  const triggers = triggerBlock(e2b);

  assert.match(triggers, /^  workflow_dispatch:\s*$/m);
  assert.match(
    triggers,
    /^  repository_dispatch:\n    types: \[proofweave_lean_run\]\s*$/m,
  );
  assert.match(triggers, /^\s+- cron: "23 \*\/6 \* \* \*"\s*$/m);
  assert.doesNotMatch(triggers, /cron: "\*\/5 \* \* \* \*"/);
  assert.doesNotMatch(triggers, /^  (push|pull_request):/m);
});

test("a newer reviewed image build cancels the superseded run", async () => {
  const { image } = await readWorkflows();

  assert.match(
    image,
    /^concurrency:\n  group: proofweave-reviewed-lean-runner-image\n(?:  #.*\n)*  cancel-in-progress: true\s*$/m,
  );
});
