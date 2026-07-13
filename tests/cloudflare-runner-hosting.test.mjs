import assert from "node:assert/strict";
import test from "node:test";
import {
  CloudflareRunnerQueue,
  CloudflareRunnerQueueError,
  consumeCloudflareRunnerBatch,
} from "../services/lean-runner/cloudflare-queues.mjs";
import { cloudflareLeanContainerPolicy, assertPinnedRunnerImage } from "../services/lean-runner/cloudflare-container-policy.mjs";
import { createRunnerQueueMessage, RunnerJobAuthenticator } from "../services/lean-runner/queue.mjs";

test("Cloudflare Queue producer sends only normalized signed RunnerQueue envelopes", async () => {
  const messages = [];
  const queue = new CloudflareRunnerQueue({
    queue: { send: async (message) => { messages.push(message); } },
  });
  const { message } = await fixtureMessage();

  const delivered = await queue.enqueue(message);
  assert.equal(delivered.created, true);
  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], message);

  assert.throws(
    () => new CloudflareRunnerQueue({ queue: {} }),
    CloudflareRunnerQueueError,
  );
});

test("Cloudflare Queue consumer authenticates before durable execution and retries failures", async () => {
  const { message, publicKey } = await fixtureMessage();
  const invalid = { ...message, controlPlaneSignature: mutateBase64Url(message.controlPlaneSignature) };
  const validDelivery = fakeDelivery(message);
  const invalidDelivery = fakeDelivery(invalid);
  const executed = [];
  const result = await consumeCloudflareRunnerBatch({
    batch: { messages: [validDelivery, invalidDelivery] },
    authenticator: new RunnerJobAuthenticator({
      issuerKeys: [{ id: "control-plane:closed-alpha", publicKey }],
    }),
    execute: async (authenticated) => { executed.push(authenticated.runId); },
    retryDelaySeconds: 60,
  });

  assert.deepEqual(executed, [message.runId]);
  assert.deepEqual(result, { acknowledged: 1, retried: 1 });
  assert.equal(validDelivery.acknowledged, true);
  assert.deepEqual(invalidDelivery.retries, [{ delaySeconds: 60 }]);
});

test("closed-alpha Container policy disables Internet and rejects unpinned images", () => {
  assert.equal(cloudflareLeanContainerPolicy.enableInternet, false);
  assert.equal(cloudflareLeanContainerPolicy.maxInstances, 1);
  assert.equal(cloudflareLeanContainerPolicy.port, 8080);
  assert.equal(cloudflareLeanContainerPolicy.pingEndpoint, "localhost/ready");
  assert.deepEqual(cloudflareLeanContainerPolicy.entrypoint, [
    "node",
    "/opt/proofweave/services/lean-runner/container-http-server.mjs",
  ]);
  assert.equal(
    assertPinnedRunnerImage(`registry.cloudflare.com/example/lean-runner@sha256:${"a".repeat(64)}`),
    `registry.cloudflare.com/example/lean-runner@sha256:${"a".repeat(64)}`,
  );
  assert.throws(() => assertPinnedRunnerImage("registry.cloudflare.com/example/lean-runner:latest"));
});

async function fixtureMessage() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const message = await createRunnerQueueMessage({
    runId: "run:cloudflare-queue-fixture",
    enqueuedAt: "2026-07-13T00:00:00Z",
    controlPlaneKeyId: "control-plane:closed-alpha",
    controlPlanePrivateKey: pair.privateKey,
    request: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: "run:cloudflare-queue-fixture",
      idempotencyKey: "cloudflare-queue-fixture",
      attemptId: "attempt:cloudflare-queue-fixture",
      bundle: {
        objectKey: `bundles/sha256/${"a".repeat(64)}/bundle.json`,
        contentHash: `sha256:${"a".repeat(64)}`,
        manifestHash: `sha256:${"a".repeat(64)}`,
        entryCommand: ["lake", "env", "lean", "ProofweaveFixture.lean"],
      },
      environment: {
        imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
        leanToolchain: "leanprover/lean4:v4.30.0",
        mathlibRevision: "fixture-no-mathlib",
        network: "disabled",
      },
      limits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
      policy: { requireNoSorry: true, allowedAxioms: [] },
    },
  });
  return { message, publicKey };
}

function fakeDelivery(body) {
  return {
    body,
    acknowledged: false,
    retries: [],
    ack() { this.acknowledged = true; },
    retry(options) { this.retries.push(options); },
  };
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function mutateBase64Url(value) {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}
