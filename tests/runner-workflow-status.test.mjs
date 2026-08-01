import assert from "node:assert/strict";
import test from "node:test";
import { runnerWorkflowStatus } from "../app/workbench/runner-workflow-status.ts";

const baseRun = {
  id: "run:status",
  attemptId: "attempt:status",
  artifactBundleHash: `sha256:${"a".repeat(64)}`,
  state: "queued",
  queuedAt: "2026-08-02T00:00:00Z",
  startedAt: null,
  finishedAt: null,
  runnerResultHash: null,
  evidenceState: "not_recorded",
  result: null,
};

test("a staged Bundle without a Run is presented as ready, not verified", () => {
  const status = runnerWorkflowStatus(null, true);
  assert.equal(status.tone, "pending");
  assert.equal(status.badge, "Runner needed");
  assert.match(status.detail, /no Runner request exists yet/i);
  assert.match(status.technicalTitle, /no Run recorded/i);
});

test("a queued Run reassures the owner that immutable evidence is safely waiting", () => {
  const status = runnerWorkflowStatus(baseRun, true);
  assert.equal(status.tone, "waiting");
  assert.equal(status.badge, "Bundle safely queued");
  assert.match(status.detail, /Do not resubmit/i);
  assert.match(status.detail, /refreshes while the Run is pending/i);
  assert.doesNotMatch(status.detail, /accepted/i);
});

test("preparing and running states communicate progress without creating a Lean claim", () => {
  const preparing = runnerWorkflowStatus({ ...baseRun, state: "preparing" }, true);
  const running = runnerWorkflowStatus({ ...baseRun, state: "running" }, true);
  assert.equal(preparing.tone, "running");
  assert.match(preparing.title, /preparing an isolated Lean workspace/i);
  assert.equal(running.tone, "running");
  assert.match(running.title, /Lean is checking/i);
  assert.doesNotMatch(running.detail, /Lean accepted/i);
});

test("only the fully accepted signed result advances to the review handoff", () => {
  const accepted = runnerWorkflowStatus({
    ...baseRun,
    state: "succeeded",
    startedAt: "2026-08-02T00:00:02Z",
    finishedAt: "2026-08-02T00:00:03Z",
    runnerResultHash: `sha256:${"b".repeat(64)}`,
    evidenceState: "recorded",
    result: {
      resultHash: `sha256:${"b".repeat(64)}`,
      receivedAt: "2026-08-02T00:00:04Z",
      summary: {
        status: "succeeded",
        exitCode: 0,
        kernelStatus: "accepted",
        checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
      },
    },
  }, true);
  assert.equal(accepted.tone, "accepted");
  assert.equal(accepted.badge, "Lean accepted");
  assert.match(accepted.detail, /different owner must still independently review/i);
  assert.doesNotMatch(accepted.detail, /Receipt issued/i);
});

test("terminal non-accepted runs do not look like proof success", () => {
  const failed = runnerWorkflowStatus({ ...baseRun, state: "timed_out" }, true);
  assert.equal(failed.tone, "failed");
  assert.match(failed.title, /did not complete successfully/i);
  assert.match(failed.detail, /No Lean acceptance was recorded/i);

  const unreadable = runnerWorkflowStatus({ ...baseRun, evidenceState: "unreadable" }, true);
  assert.equal(unreadable.tone, "failed");
  assert.match(unreadable.title, /controlled inspection/i);
});
