import assert from "node:assert/strict";
import test from "node:test";
import {
  createTrustedRunnerPhaseObserver,
  createTrustedRunnerRuntimeFromEnvironment,
  TrustedRunnerProcess,
} from "../services/lean-runner/trusted-runner-process.mjs";
import { RunnerJobAuthenticationError } from "../services/lean-runner/queue.mjs";

test("one-shot Runner fails closed before connecting or claiming when execution is disabled", async () => {
  await assert.rejects(
    createTrustedRunnerRuntimeFromEnvironment({
      environment: {
        RUNNER_EXECUTION_ENABLED: "false",
        TURSO_DATABASE_URL: "libsql://must-not-be-contacted.example",
        TURSO_AUTH_TOKEN: "must-not-be-read",
      },
    }),
    /RUNNER_EXECUTION_ENABLED=true/,
  );
});

test("trusted Runner phase audit records only bounded anonymous timing", async () => {
  const records = [];
  const observe = createTrustedRunnerPhaseObserver({
    emit: (record) => records.push(record),
    now: () => new Date("2026-07-13T00:00:01Z"),
  });
  observe({ phase: "runner_lean_execution", durationMs: 321, outcome: "completed", runId: "must-not-leak" });
  observe({ phase: "../../unsafe", durationMs: 1, outcome: "completed" });
  observe({ phase: "alice_email", durationMs: 1, outcome: "completed" });

  assert.deepEqual(records, [{
    schemaVersion: "pw-audit-v1",
    kind: "trusted_runner_phase",
    component: "trusted_lean_runner",
    occurredAt: "2026-07-13T00:00:01.000Z",
    phase: "runner_lean_execution",
    durationMs: 321,
    outcome: "completed",
  }]);
  assert.equal(JSON.stringify(records).includes("must-not-leak"), false);
});

test("trusted Runner wake interrupts a sixty-second idle poll without carrying work", async () => {
  const queue = fakeQueue({ deliveryAttempt: 1 });
  const originalClaim = queue.claim.bind(queue);
  const originalAcknowledge = queue.acknowledge.bind(queue);
  const idlePollStarted = deferred();
  const acknowledged = deferred();
  let deliveryAvailable = false;
  queue.claim = async () => deliveryAvailable ? originalClaim() : null;
  queue.acknowledge = async (input) => {
    const result = await originalAcknowledge(input);
    acknowledged.resolve();
    return result;
  };
  const process = new TrustedRunnerProcess({
    queue,
    authenticator: { async authenticate(message) { return message; } },
    async execute(_message, { beforeFinalize }) {
      await beforeFinalize();
    },
    consumerId: "runner:wake-test",
    leaseDurationSeconds: 60,
    heartbeatSeconds: 10,
    pollMilliseconds: 60_000,
    now: () => new Date("2026-07-13T00:00:01Z"),
    sleep: async (milliseconds) => {
      if (milliseconds === 60_000) idlePollStarted.resolve();
      await new Promise(() => {});
    },
  });
  const controller = new AbortController();
  const running = process.run({ signal: controller.signal });
  await idlePollStarted.promise;

  deliveryAvailable = true;
  assert.deepEqual(process.wake(), { state: "wake_requested" });
  await acknowledged.promise;
  controller.abort();
  process.wake();
  await running;
  assert.equal(queue.acknowledged.length, 1);
});

test("trusted Runner renews its lease and acknowledges only after durable execution", async () => {
  const renewed = deferred();
  let sleepCalls = 0;
  const queue = fakeQueue({
    deliveryAttempt: 1,
    async renew(input) {
      this.renewed.push(input);
      renewed.resolve();
      return { ...this.delivery.lease, expiresAt: "2026-07-13T00:05:00.000Z" };
    },
  });
  const audits = [];
  const process = new TrustedRunnerProcess({
    queue,
    authenticator: { async authenticate(message) { return { ...message, authenticated: true }; } },
    async execute(message, { beforeFinalize }) {
      assert.equal(message.authenticated, true);
      await renewed.promise;
      await beforeFinalize();
    },
    consumerId: "runner:trusted-test",
    leaseDurationSeconds: 60,
    heartbeatSeconds: 10,
    now: () => new Date("2026-07-13T00:00:01Z"),
    sleep: async () => {
      if (sleepCalls++ === 0) return;
      await new Promise(() => {});
    },
    emit: (record) => audits.push(record),
  });

  const result = await process.processNext();
  assert.equal(result.outcome, "acknowledged");
  assert.equal(queue.renewed.length, 2);
  assert.equal(queue.acknowledged.length, 1);
  assert.equal(queue.released.length, 0);
  assert.equal(audits.length, 1);
  assert.equal(Object.hasOwn(audits[0], "runId"), false);
});

test("trusted Runner retries execution failures with bounded backoff", async () => {
  const queue = fakeQueue({ deliveryAttempt: 2 });
  const process = new TrustedRunnerProcess({
    queue,
    authenticator: { async authenticate(message) { return message; } },
    async execute() {
      const error = new Error("sensitive provider detail");
      error.name = "SandboxTransportError";
      throw error;
    },
    consumerId: "runner:trusted-test",
    leaseDurationSeconds: 60,
    heartbeatSeconds: 10,
    retryDelaySeconds: 30,
    now: () => new Date("2026-07-13T00:00:01Z"),
    sleep: async () => new Promise(() => {}),
  });

  const result = await process.processNext();
  assert.deepEqual(result, {
    outcome: "retried",
    deliveryAttempt: 2,
    retryDelaySeconds: 60,
    errorCode: "sandbox_transport_error",
  });
  assert.equal(queue.released[0].availableAt, "2026-07-13T00:01:01.000Z");
  assert.equal(JSON.stringify(queue.released).includes("sensitive provider detail"), false);
});

test("trusted Runner preserves an allowlisted diagnostic stage without leaking its cause", async () => {
  const queue = fakeQueue({ deliveryAttempt: 1 });
  const process = new TrustedRunnerProcess({
    queue,
    authenticator: { async authenticate(message) { return message; } },
    async execute() {
      const error = new Error("sensitive private response");
      error.diagnosticCode = "runner_container_execute_response_error";
      throw error;
    },
    consumerId: "runner:trusted-test",
    leaseDurationSeconds: 60,
    heartbeatSeconds: 10,
    now: () => new Date("2026-07-13T00:00:01Z"),
    sleep: async () => new Promise(() => {}),
  });

  const result = await process.processNext();
  assert.equal(result.errorCode, "runner_container_execute_response_error");
  assert.equal(JSON.stringify(queue.released).includes("sensitive private response"), false);
});

test("trusted Runner dead-letters invalid signatures and exhausted deliveries", async () => {
  const authenticationQueue = fakeQueue({ deliveryAttempt: 1 });
  const invalidMessageProcess = new TrustedRunnerProcess({
    queue: authenticationQueue,
    authenticator: { async authenticate() { throw new RunnerJobAuthenticationError("invalid signature"); } },
    execute: async () => assert.fail("invalid messages must never execute"),
    consumerId: "runner:trusted-test",
    leaseDurationSeconds: 60,
    heartbeatSeconds: 10,
    now: () => new Date("2026-07-13T00:00:01Z"),
    sleep: async () => new Promise(() => {}),
  });
  assert.equal((await invalidMessageProcess.processNext()).outcome, "dead_lettered");
  assert.equal(authenticationQueue.deadLetters[0].errorCode, "authentication_failed");

  const exhaustedQueue = fakeQueue({ deliveryAttempt: 3 });
  const exhaustedProcess = new TrustedRunnerProcess({
    queue: exhaustedQueue,
    authenticator: { async authenticate(message) { return message; } },
    execute: async () => { throw new Error("execution failed"); },
    consumerId: "runner:trusted-test",
    leaseDurationSeconds: 60,
    heartbeatSeconds: 10,
    maxDeliveryAttempts: 3,
    now: () => new Date("2026-07-13T00:00:01Z"),
    sleep: async () => new Promise(() => {}),
  });
  assert.equal((await exhaustedProcess.processNext()).outcome, "dead_lettered");
  assert.equal(exhaustedQueue.released.length, 0);
  assert.equal(exhaustedQueue.deadLetters.length, 1);

  const overLimitQueue = fakeQueue({ deliveryAttempt: 4 });
  const overLimitProcess = new TrustedRunnerProcess({
    queue: overLimitQueue,
    authenticator: { async authenticate() { assert.fail("an exhausted delivery must not authenticate"); } },
    execute: async () => assert.fail("an exhausted delivery must not execute"),
    consumerId: "runner:trusted-test",
    leaseDurationSeconds: 60,
    heartbeatSeconds: 10,
    maxDeliveryAttempts: 3,
    now: () => new Date("2026-07-13T00:00:01Z"),
  });
  const overLimit = await overLimitProcess.processNext();
  assert.equal(overLimit.outcome, "dead_lettered");
  assert.equal(overLimit.errorCode, "delivery_attempts_exhausted");
});

function fakeQueue({ deliveryAttempt, renew } = {}) {
  const queue = {
    delivery: {
      message: { runId: "run:trusted-test" },
      lease: {
        id: "lease:trusted-test",
        consumerId: "runner:trusted-test",
        claimedAt: "2026-07-13T00:00:00Z",
        expiresAt: "2026-07-13T00:01:00Z",
        deliveryAttempt,
      },
    },
    claimed: false,
    renewed: [],
    acknowledged: [],
    released: [],
    deadLetters: [],
    async claim() {
      if (this.claimed) return null;
      this.claimed = true;
      return this.delivery;
    },
    async renew(input) {
      this.renewed.push(input);
      return this.delivery.lease;
    },
    async acknowledge(input) {
      this.acknowledged.push(input);
      return this.delivery.message;
    },
    async release(input) {
      this.released.push(input);
      return this.delivery.message;
    },
    async deadLetter(input) {
      this.deadLetters.push(input);
      return this.delivery.message;
    },
  };
  if (renew) queue.renew = renew;
  return queue;
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}
