import assert from "node:assert/strict";
import test from "node:test";
import { HostedTrustedRunnerService } from "../services/lean-runner/hosted-trusted-runner.mjs";

const wakeToken = "wake-token-0123456789abcdef-0123456789abcdef";
const imageDigest = `ghcr.io/proofweave/lean-runner@sha256:${"a".repeat(64)}`;
const templateId = "template_proofweave_lean_v1:reviewed";
const templateBuildId = "9420e83e-3c6d-48b8-94fe-a73807af5797";

test("hosted Runner exposes health and authenticated wake without accepting work", async (t) => {
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
      PROOFWEAVE_E2B_RUNNER_IMAGE: imageDigest,
      PROOFWEAVE_E2B_TEMPLATE_ID: templateId,
      PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: templateBuildId,
      RUNNER_APPROVED_IMAGES_JSON: JSON.stringify([{
        imageDigest,
        leanToolchain: "leanprover/lean4:v4.31.0",
        mathlibRevision: "mathlib-revision",
      }]),
    },
    runtimeFactory: async () => ({
      async run({ signal }) {
        runStarted = true;
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      },
      async close() { closeCount += 1; },
    }),
  });
  t.after(() => service.close());
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
  assert.deepEqual(healthBody.runnerPolicy, {
    state: "configured",
    sandboxImageDigest: imageDigest,
    templateId,
    templateBuildId,
    approvedImages: [{
      imageDigest,
      leanToolchain: "leanprover/lean4:v4.31.0",
      mathlibRevision: "mathlib-revision",
    }],
    sandboxImageApproved: true,
  });
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

test("hosted Runner reports degraded health without exposing startup error text", async (t) => {
  const service = new HostedTrustedRunnerService({
    environment: {
      PORT: "0",
      HOST: "127.0.0.1",
      PROOFWEAVE_RUNNER_WAKE_TOKEN: wakeToken,
      PROOFWEAVE_RUNNER_PROVIDER: "e2b",
      PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: "invalid build id",
      E2B_API_KEY: "private-e2b-sentinel",
    },
    runtimeFactory: async () => {
      throw new TypeError("secret database URL must never be returned");
    },
  });
  t.after(() => service.close());
  await service.start();
  await waitFor(() => service.state === "degraded");

  const health = await fetch(`http://127.0.0.1:${service.port}/healthz`);
  assert.equal(health.status, 503);
  const body = await health.json();
  assert.equal(body.failureCode, "type_error");
  assert.equal(body.runnerPolicy.templateId, null);
  assert.equal(body.runnerPolicy.templateBuildId, null);
  const rendered = JSON.stringify(body);
  assert.doesNotMatch(rendered, /secret database URL/);
  assert.doesNotMatch(rendered, /private-e2b-sentinel/);
  await service.close();
});

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition was not reached.");
}
