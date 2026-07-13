import assert from "node:assert/strict";
import test from "node:test";
import { RunnerExecutionFinalizer } from "../services/lean-runner/runner-execution-finalizer.mjs";

test("execution finalizer persists outputs before signing and recording a Run result", async () => {
  const calls = [];
  const run = {
    id: "run:finalizer",
    attemptId: "attempt:finalizer",
    requestHash: sha("a"),
    artifactBundleHash: sha("b"),
    state: "running",
  };
  const execution = { result: { jobId: run.id } };
  const signed = { runnerSignature: "signature" };
  const finalizer = new RunnerExecutionFinalizer({
    runStore: {
      async find(runId) {
        calls.push(`find:${runId}`);
        return run;
      },
      async recordResult(runId, result, receivedAt) {
        calls.push(`record:${runId}:${receivedAt}`);
        assert.equal(result, signed);
        return { ...run, state: "succeeded" };
      },
    },
    outputStore: {
      async persist(input) {
        calls.push("persist");
        assert.equal(input.run, run);
        assert.equal(input.execution, execution);
        return { stdout: { contentHash: sha("c") }, stderr: { contentHash: sha("d") } };
      },
    },
    resultSigner: {
      async sign(input) {
        calls.push("sign");
        assert.equal(input.run, run);
        assert.equal(input.execution, execution);
        return signed;
      },
    },
  });

  const finalized = await finalizer.finalize({
    runId: run.id,
    execution,
    receivedAt: "2026-07-13T00:00:01Z",
  });

  assert.equal(finalized.run.state, "succeeded");
  assert.equal(finalized.result, signed);
  assert.deepEqual(calls, [
    "find:run:finalizer",
    "persist",
    "sign",
    "record:run:finalizer:2026-07-13T00:00:01Z",
  ]);
});

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
