import assert from "node:assert/strict";
import test from "node:test";
import {
  createLeanRunnerWorker,
  createRunnerQueueExecution,
  RunnerWorkerConfigurationError,
} from "../services/lean-runner/worker.mjs";

const message = Object.freeze({
  runId: "run:worker-test",
  request: Object.freeze({ jobId: "run:worker-test", attemptId: "attempt:worker-test" }),
});
const running = Object.freeze({ id: "run:worker-test", state: "running" });

test("Runner Worker has no public control route and only acknowledges durable queue execution", async () => {
  let executed = 0;
  const worker = createLeanRunnerWorker({
    createRuntime: async () => ({
      retryDelaySeconds: 42,
      authenticator: { async authenticate(value) { return value; } },
      async execute(value) {
        executed += 1;
        assert.equal(value, message);
      },
    }),
  });
  assert.equal((await worker.fetch(new Request("https://runner.example.test/anything"))).status, 404);
  const delivery = deliveryFor(message);
  const result = await worker.queue({ messages: [delivery] }, {});
  assert.deepEqual(result, { acknowledged: 1, retried: 0 });
  assert.equal(executed, 1);
  assert.equal(delivery.acknowledged, true);
  assert.equal(delivery.retryDelay, null);
});

test("Runner queue execution stages once, executes in the named private Container, then finalizes", async () => {
  const calls = [];
  const execute = createRunnerQueueExecution({
    workspaceStager: {
      async executeAuthenticatedMessage(received, timestamps) {
        calls.push(["stage", received, timestamps]);
        return { action: "execute", run: running, message };
      },
    },
    imageRegistry: { resolve() { calls.push(["image"]); } },
    async getContainerForRun(runId) {
      calls.push(["container", runId]);
      return { fetch() {} };
    },
    executionClient: {
      async execute(input) {
        calls.push(["execute", input]);
        return { result: { jobId: running.id } };
      },
    },
    finalizer: {
      async finalize(input) {
        calls.push(["finalize", input]);
        return { run: { ...running, state: "succeeded" } };
      },
    },
    now: () => new Date("2026-07-13T00:00:00Z"),
  });

  assert.deepEqual(await execute(message), { run: { ...running, state: "succeeded" } });
  assert.equal(calls[0][0], "stage");
  assert.equal(calls[1][0], "container");
  assert.equal(calls[1][1], running.id);
  assert.equal(calls[2][0], "execute");
  assert.equal(calls[2][1].request, message.request);
  assert.equal(calls[3][0], "finalize");
  assert.equal(calls[3][1].runId, running.id);
});

test("Runner queue retry resumes a running Run but never restarts a cancellation or terminal Run", async () => {
  let executionCalls = 0;
  let imageCalls = 0;
  let state = "running";
  const execute = createRunnerQueueExecution({
    workspaceStager: {
      async executeAuthenticatedMessage() {
        return { action: "skip", reason: `run_${state}`, run: { ...running, state } };
      },
    },
    imageRegistry: { resolve(request) { imageCalls += 1; assert.equal(request, message.request); } },
    async getContainerForRun() { return { fetch() {} }; },
    executionClient: { async execute() { executionCalls += 1; return { result: {} }; } },
    finalizer: { async finalize() { return { finalized: true }; } },
    now: () => new Date("2026-07-13T00:00:00Z"),
  });

  assert.deepEqual(await execute(message), { finalized: true });
  assert.equal(imageCalls, 1);
  assert.equal(executionCalls, 1);
  state = "cancel_requested";
  assert.deepEqual(await execute(message), {
    action: "skip",
    reason: "run_cancel_requested",
    run: { ...running, state: "cancel_requested" },
  });
  state = "succeeded";
  await execute(message);
  assert.equal(imageCalls, 1);
  assert.equal(executionCalls, 1);
});

test("Runner Worker rejects incomplete deployment configuration before touching a queue", async () => {
  const worker = createLeanRunnerWorker();
  await assert.rejects(
    worker.queue({ messages: [] }, {}),
    RunnerWorkerConfigurationError,
  );
});

function deliveryFor(body) {
  return {
    body,
    acknowledged: false,
    retryDelay: null,
    ack() { this.acknowledged = true; },
    retry({ delaySeconds }) { this.retryDelay = delaySeconds; },
  };
}
