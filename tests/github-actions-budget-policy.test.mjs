import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrls = {
  ci: new URL("../.github/workflows/ci.yml", import.meta.url),
  e2b: new URL("../.github/workflows/e2b-lean-runner.yml", import.meta.url),
  image: new URL("../.github/workflows/build-e2b-lean-runner-image.yml", import.meta.url),
};

async function readWorkflows() {
  const entries = await Promise.all(
    Object.entries(workflowUrls).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
  );
  return Object.fromEntries(entries);
}

function triggerBlock(workflow) {
  const match = workflow.match(/^on:\n(?<block>[\s\S]*?)^\S/m);
  assert.ok(match?.groups?.block, "workflow must have a top-level on block");
  return match.groups.block;
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
