import assert from "node:assert/strict";
import test from "node:test";
import {
  createQueuedRun,
  markRunStarted,
  recordRunnerResult,
  requestRunCancellation,
} from "../packages/domain/run.mjs";

test("a queued Run only reaches a terminal state through the allowed lifecycle", () => {
  const queued = fixtureRun();
  const running = markRunStarted(queued, "2026-07-13T00:00:01Z");
  const completed = recordRunnerResult(running, fixtureResult(), sha("e"));

  assert.equal(completed.state, "succeeded");
  assert.equal(completed.runnerResultHash, sha("e"));
  assert.throws(() => markRunStarted(completed, "2026-07-13T00:00:04Z"), /cannot start/);
});

test("a running cancellation remains pending until the runner acknowledges it", () => {
  const running = markRunStarted(fixtureRun(), "2026-07-13T00:00:01Z");
  const cancelling = requestRunCancellation(running, "2026-07-13T00:00:02Z");
  const cancelled = recordRunnerResult(cancelling, fixtureResult({ status: "cancelled", kernelStatus: "not_run", exitCode: 137, checks: { network: "passed", noSorry: "not_run", allowedAxioms: "not_run", leanBuild: "not_run" } }), sha("e"));

  assert.equal(cancelling.state, "cancel_requested");
  assert.equal(cancelled.state, "cancelled");
  assert.throws(() => recordRunnerResult(running, fixtureResult({ status: "cancelled", kernelStatus: "not_run", exitCode: 137, checks: { network: "passed", noSorry: "not_run", allowedAxioms: "not_run", leanBuild: "not_run" } }), sha("e")), /only after a control-plane cancellation/);
});

test("runner results cannot be replayed across Runs or request hashes", () => {
  const running = markRunStarted(fixtureRun(), "2026-07-13T00:00:01Z");
  assert.throws(() => recordRunnerResult(running, fixtureResult({ requestHash: sha("0") }), sha("e")), /does not cover this Run request hash/);
  assert.throws(() => recordRunnerResult(running, fixtureResult({ jobId: "run:other" }), sha("e")), /does not belong to this Run/);
});

function fixtureRun() {
  return createQueuedRun({
    id: "run:fixture-1",
    attemptId: "attempt:fixture-1",
    idempotencyKey: "run-fixture-1",
    requestHash: sha("a"),
    artifactBundleHash: sha("b"),
    queuedAt: "2026-07-13T00:00:00Z",
  });
}

function fixtureResult(overrides = {}) {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:fixture-1",
    attemptId: "attempt:fixture-1",
    requestHash: sha("a"),
    runnerKeyId: "runner-key:fixture-1",
    runnerSignature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    status: "succeeded",
    exitCode: 0,
    startedAt: "2026-07-13T00:00:01Z",
    finishedAt: "2026-07-13T00:00:03Z",
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: { manifestHash: sha("b"), stdoutHash: sha("c"), stderrHash: sha("d") },
    ...overrides,
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
