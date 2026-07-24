import assert from "node:assert/strict";
import test from "node:test";
import { HostedTrustedRunnerService } from "../services/lean-runner/hosted-trusted-runner.mjs";

const wakeToken = "wake-token-0123456789abcdef-0123456789abcdef";

test("hosted Runner exposes health and authenticated wake without accepting work", async () => {
  let runStarted = false;
  let closeCount = 0;
  const service = new HostedTrustedRunnerService({
    environment: {
      PORT: "0",
      HOST: "127.0.0.1",
      PROOFWEAVE_RUNNER_WAKE_TOKEN: wakeToken,
      PROOFWEAVE_RUNNER_PROVIDER: "e2b",
      PROOFWEAVE_RUNNER_REVISION: "test-revision",
      RENDER_GIT_COMMIT: "47fa209a9aef5de9f76f5e2c04b9a1bfddb01872",
    },
    runtimeFactory: async () => ({
      async run({ signal }) {
        runStarted = true;
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      },
      async close() { closeCount += 1; },
    }),
  });
  await service.start();
  await waitFor(() => runStarted);
  const origin = `http://127.0.0.1:${service.port}`;

  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.service, "proofweave-trusted-runner");
  assert.equal(healthBody.state, "ready");
  assert.equal(healthBody.provider, "e2b");
  assert.equal(healthBody.revision, "47fa209a9aef5de9f76f5e2c04b9a1bfddb01872");
  assert.equal(healthBody.lastWakeAt, null);
  assert.equal(healthBody.executionBoundary, "isolated-sandbox-only");
  assert.match(healthBody.startedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal((await fetch(`${origin}/v1/wake`, { method: "POST" })).status, 401);
  const wake = await fetch(`${origin}/v1/wake`, {
    method: "POST",
    headers: { authorization: `Bearer ${wakeToken}` },
  });
  assert.equal(wake.status, 202);
  assert.deepEqual(await wake.json(), {
    accepted: true,
    state: "ready",
    revision: "47fa209a9aef5de9f76f5e2c04b9a1bfddb01872",
  });

  const rejectedWorkspace = await fetch(`${origin}/v1/runs/run-1/workspace`, { method: "POST" });
  assert.equal(rejectedWorkspace.status, 404);

  await service.close();
  assert.equal(closeCount, 1);
});

test("hosted Runner reports degraded health without exposing startup error text", async () => {
  const service = new HostedTrustedRunnerService({
    environment: {
      PORT: "0",
      HOST: "127.0.0.1",
      PROOFWEAVE_RUNNER_WAKE_TOKEN: wakeToken,
      PROOFWEAVE_RUNNER_PROVIDER: "e2b",
    },
    runtimeFactory: async () => {
      throw new TypeError("secret database URL must never be returned");
    },
  });
  await service.start();
  await waitFor(() => service.state === "degraded");

  const health = await fetch(`http://127.0.0.1:${service.port}/healthz`);
  assert.equal(health.status, 503);
  const body = await health.text();
  assert.match(body, /"failureCode":"type_error"/);
  assert.doesNotMatch(body, /secret database URL/);
  await service.close();
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition was not reached.");
}
