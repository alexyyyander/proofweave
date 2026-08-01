import assert from "node:assert/strict";
import test from "node:test";
import { RunnerExecutionFinalizer } from "../services/lean-runner/runner-execution-finalizer.mjs";

test("execution finalizer durably succeeds before publishing independent verification work", async () => {
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
    replayEvidenceStore: {
      async persist(input) {
        calls.push("replay-evidence");
        assert.equal(input.run, run);
        assert.equal(input.result, signed);
        assert.equal(input.receivedAt, "2026-07-13T00:00:01Z");
        return { evidenceHash: sha("e") };
      },
    },
    verificationJobPublisher: {
      async publishJobsForBundle(artifactBundleHash, publishedAt) {
        calls.push(`publish:${artifactBundleHash}:${publishedAt}`);
        assert.equal(artifactBundleHash, run.artifactBundleHash);
        return { published: true, reason: null, jobs: [{ id: "verification-job:one" }] };
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
  assert.equal(finalized.replayEvidence?.evidenceHash, sha("e"));
  assert.equal(finalized.verificationMarket?.published, true);
  assert.deepEqual(calls, [
    "find:run:finalizer",
    "persist",
    "sign",
    "replay-evidence",
    "record:run:finalizer:2026-07-13T00:00:01Z",
    `publish:${run.artifactBundleHash}:2026-07-13T00:00:01Z`,
  ]);
});

test("verification job publication is retried idempotently after a durable Runner success", async () => {
  const calls = [];
  const run = {
    id: "run:retry",
    attemptId: "attempt:retry",
    requestHash: sha("a"),
    artifactBundleHash: sha("b"),
    state: "running",
  };
  const finalizedRun = { ...run, state: "succeeded" };
  let publicationAttempt = 0;
  const finalizer = new RunnerExecutionFinalizer({
    runStore: {
      async find() {
        calls.push("find");
        return publicationAttempt === 0 ? run : finalizedRun;
      },
      async recordResult() {
        calls.push("record");
        return finalizedRun;
      },
    },
    outputStore: {
      async persist() {
        calls.push("persist");
        return {};
      },
    },
    resultSigner: {
      async sign() {
        calls.push("sign");
        return { status: "succeeded" };
      },
    },
    verificationJobPublisher: {
      async publishJobsForBundle(artifactBundleHash) {
        calls.push(`publish:${artifactBundleHash}`);
        publicationAttempt += 1;
        if (publicationAttempt === 1) throw new Error("temporary database failure");
        return {
          published: true,
          reason: null,
          jobs: [{ id: "verification-job:stable", created: false }],
        };
      },
    },
  });

  await assert.rejects(
    finalizer.finalize({
      runId: run.id,
      execution: {},
      receivedAt: "2026-07-13T00:00:01Z",
    }),
    (error) => {
      assert.equal(error.name, "RunnerExecutionFinalizerError");
      assert.match(error.message, /result is durable/);
      assert.match(error.cause?.message ?? "", /temporary database failure/);
      return true;
    },
  );

  const retry = await finalizer.finalize({
    runId: run.id,
    execution: {},
    receivedAt: "2026-07-13T00:00:02Z",
  });

  assert.equal(retry.run.state, "succeeded");
  assert.equal(retry.verificationMarket?.jobs[0]?.id, "verification-job:stable");
  assert.equal(publicationAttempt, 2);
  assert.deepEqual(
    calls.filter((call) => call.startsWith("publish:")),
    [`publish:${run.artifactBundleHash}`, `publish:${run.artifactBundleHash}`],
  );
});

test("non-successful terminal Runner results do not publish verification work", async () => {
  let publications = 0;
  const run = {
    id: "run:failed",
    attemptId: "attempt:failed",
    requestHash: sha("a"),
    artifactBundleHash: sha("b"),
    state: "running",
  };
  const finalizer = new RunnerExecutionFinalizer({
    runStore: {
      async find() {
        return run;
      },
      async recordResult() {
        return { ...run, state: "failed" };
      },
    },
    outputStore: {
      async persist() {
        return {};
      },
    },
    resultSigner: {
      async sign() {
        return { status: "failed" };
      },
    },
    verificationJobPublisher: {
      async publishJobsForBundle() {
        publications += 1;
        return { published: true, jobs: [] };
      },
    },
  });

  const finalized = await finalizer.finalize({
    runId: run.id,
    execution: {},
    receivedAt: "2026-07-13T00:00:01Z",
  });

  assert.equal(finalized.run.state, "failed");
  assert.equal(finalized.verificationMarket, null);
  assert.equal(publications, 0);
});

test("execution finalizer rejects an invalid verification job publisher", () => {
  assert.throws(
    () => new RunnerExecutionFinalizer({
      runStore: { find() {}, recordResult() {} },
      outputStore: { persist() {} },
      resultSigner: { sign() {} },
      verificationJobPublisher: {},
    }),
    /publishJobsForBundle/,
  );
});

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
