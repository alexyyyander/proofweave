import assert from "node:assert/strict";
import test from "node:test";
import {
  createRunnerQueueMessage,
  InMemoryRunnerQueue,
  normalizeRunnerQueueMessage,
  RunnerQueueProtocolError,
} from "../services/lean-runner/queue.mjs";

test("RunnerQueue derives and verifies an immutable source-free queue message", async () => {
  const message = await fixtureMessage();
  const normalized = await normalizeRunnerQueueMessage(message);

  assert.equal(normalized.runId, "run:queue-fixture-1");
  assert.match(normalized.requestHash, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(normalized), ["protocolVersion", "runId", "requestHash", "request", "enqueuedAt"]);
  assert.equal(JSON.stringify(normalized).includes("source.tar"), false);

  await assert.rejects(
    normalizeRunnerQueueMessage({ ...message, requestHash: `sha256:${"0".repeat(64)}` }),
    /does not match the canonical request/,
  );
});

test("in-memory RunnerQueue is idempotent and does not let a stale lease mutate delivery", async () => {
  const queue = new InMemoryRunnerQueue();
  const message = await fixtureMessage();
  const first = await queue.enqueue(message);
  const retry = await queue.enqueue({ ...message });
  assert.equal(first.created, true);
  assert.equal(retry.created, false);

  const claimed = await queue.claim({ consumerId: "runner:local-test", claimedAt: "2026-07-13T00:00:01Z" });
  assert.equal(claimed?.message.runId, "run:queue-fixture-1");
  await assert.rejects(
    queue.acknowledge({ runId: message.runId, leaseId: "lease:wrong", acknowledgedAt: "2026-07-13T00:00:02Z" }),
    RunnerQueueProtocolError,
  );
  await queue.release({ runId: message.runId, leaseId: claimed.lease.id, releasedAt: "2026-07-13T00:00:02Z" });
  const retriedClaim = await queue.claim({ consumerId: "runner:local-test", claimedAt: "2026-07-13T00:00:03Z" });
  await queue.acknowledge({
    runId: message.runId,
    leaseId: retriedClaim.lease.id,
    acknowledgedAt: "2026-07-13T00:00:04Z",
  });
  assert.equal(await queue.claim({ consumerId: "runner:local-test", claimedAt: "2026-07-13T00:00:05Z" }), null);
});

test("a queued job can be removed but a leased job remains the runner's cancellation responsibility", async () => {
  const queue = new InMemoryRunnerQueue();
  const message = await fixtureMessage();
  await queue.enqueue(message);
  assert.equal((await queue.cancelQueued({ runId: message.runId, cancelledAt: "2026-07-13T00:00:01Z" })).deliveryState, "cancelled");
  assert.equal(await queue.claim({ consumerId: "runner:local-test", claimedAt: "2026-07-13T00:00:02Z" }), null);

  const second = await fixtureMessage({ runId: "run:queue-fixture-2", idempotencyKey: "queue-fixture-2" });
  await queue.enqueue(second);
  await queue.claim({ consumerId: "runner:local-test", claimedAt: "2026-07-13T00:00:03Z" });
  assert.equal((await queue.cancelQueued({ runId: second.runId, cancelledAt: "2026-07-13T00:00:04Z" })).deliveryState, "leased");
});

async function fixtureMessage({ runId = "run:queue-fixture-1", idempotencyKey = "queue-fixture-1" } = {}) {
  return createRunnerQueueMessage({
    runId,
    enqueuedAt: "2026-07-13T00:00:00Z",
    request: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: runId,
      idempotencyKey,
      attemptId: "attempt:queue-fixture-1",
      bundle: {
        objectKey: `bundles/sha256/${"a".repeat(64)}/bundle.json`,
        contentHash: `sha256:${"a".repeat(64)}`,
        manifestHash: `sha256:${"a".repeat(64)}`,
        entryCommand: ["lake", "env", "lean", "ProofweaveFixture.lean"],
      },
      environment: {
        imageDigest: `ghcr.io/proofweave/lean-runner@sha256:${"c".repeat(64)}`,
        leanToolchain: "leanprover/lean4:v4.30.0",
        mathlibRevision: "fixture-no-mathlib",
        network: "disabled",
      },
      limits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
      policy: { requireNoSorry: true, allowedAxioms: [] },
    },
  });
}
