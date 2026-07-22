import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ciWorkflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);
const e2bWorkflowUrl = new URL("../.github/workflows/e2b-lean-runner.yml", import.meta.url);
const imageWorkflowUrl = new URL("../.github/workflows/build-e2b-lean-runner-image.yml", import.meta.url);

test("GitHub Actions workflows preserve the private-alpha minute budget", async () => {
  const [ciWorkflow, e2bWorkflow, imageWorkflow] = await Promise.all([
    readFile(ciWorkflowUrl, "utf8"),
    readFile(e2bWorkflowUrl, "utf8"),
    readFile(imageWorkflowUrl, "utf8"),
  ]);

  assert.match(ciWorkflow, /on:\n\s+workflow_dispatch:/);
  assert.match(ciWorkflow, /push:\n\s+branches: \[main\]/);
  assert.doesNotMatch(ciWorkflow, /branches: \["\*\*"\]/);
  assert.match(ciWorkflow, /group: check-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/);
  assert.match(ciWorkflow, /cancel-in-progress: true/);

  assert.match(e2bWorkflow, /repository_dispatch:\n\s+types: \[proofweave_lean_run\]/);
  assert.match(e2bWorkflow, /cron: "23 \*\/6 \* \* \*"/);
  assert.doesNotMatch(e2bWorkflow, /cron: "\*\/5 \* \* \* \*"/);

  assert.match(
    imageWorkflow,
    /group: proofweave-reviewed-lean-runner-image\n(?:\s+#.*\n)*\s+cancel-in-progress: true/,
  );
});
