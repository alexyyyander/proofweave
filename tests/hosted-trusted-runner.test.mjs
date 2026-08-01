import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { HostedTrustedRunnerService } from "../services/lean-runner/hosted-trusted-runner.mjs";
import { tursoDatabaseFingerprint } from "../db/control-plane-authority.mjs";

const wakeToken = "wake-token-0123456789abcdef-0123456789abcdef";
const tursoUrl = "libsql://proofweave-release-diagnostics.example";
const tursoToken = "private-turso-token-sentinel-0123456789";
const imageDigest = `ghcr.io/proofweave/lean-runner@sha256:${"a".repeat(64)}`;
const templateId = "template_proofweave_lean_v1:reviewed";
const templateBuildId = "9420e83e-3c6d-48b8-94fe-a73807af5797";
const sitesVersion = "release-140";
const siteProjectId = `appgprj_${"f".repeat(32)}`;

test("checked-in Render defaults cannot auto-deploy or execute during a cutover", async () => {
  const blueprint = await readFile(
    new URL("../deploy/huggingface-runner/render.yaml", import.meta.url),
    "utf8",
  );
  assert.match(blueprint, /autoDeployTrigger:\s*off/);
  assert.match(blueprint, /key:\s*RUNNER_EXECUTION_ENABLED\s+value:\s*\"false\"/);
  assert.doesNotMatch(blueprint, /autoDeployTrigger:\s*commit/);
});

test("hosted Runner exposes health and authenticated wake without accepting work", async (t) => {
  let runStarted = false;
  let closeCount = 0;
  let runtimeOptions;
  const audits = [];
  const service = new HostedTrustedRunnerService({
    environment: {
      PORT: "0",
      HOST: "127.0.0.1",
      PROOFWEAVE_RUNNER_WAKE_TOKEN: wakeToken,
      RUNNER_EXECUTION_ENABLED: "true",
      PROOFWEAVE_RUNNER_PROVIDER: "e2b",
      PROOFWEAVE_RUNNER_REVISION: "test-revision",
      RENDER_GIT_COMMIT: "47fa209a9aef5de9f76f5e2c04b9a1bfddb01872",
      PROOFWEAVE_RELEASE_SITES_VERSION: sitesVersion,
      PROOFWEAVE_RELEASE_SITE_PROJECT_ID: siteProjectId,
      PROOFWEAVE_E2B_RUNNER_IMAGE: imageDigest,
      PROOFWEAVE_E2B_TEMPLATE_ID: templateId,
      PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: templateBuildId,
      RUNNER_APPROVED_IMAGES_JSON: JSON.stringify([{
        imageDigest,
        leanToolchain: "leanprover/lean4:v4.31.0",
        mathlibRevision: "mathlib-revision",
      }]),
      TURSO_DATABASE_URL: tursoUrl,
      TURSO_AUTH_TOKEN: tursoToken,
    },
    runtimeFactory: async (options) => {
      runtimeOptions = options;
      return ({
      releaseDiagnostics: readyDiagnostics("47fa209a9aef5de9f76f5e2c04b9a1bfddb01872"),
      async run({ signal }) {
        runStarted = true;
        await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      },
      wake() {},
      async close() { closeCount += 1; },
      });
    },
    emit: (record) => audits.push(record),
  });
  t.after(() => service.close());
  await service.start();
  await waitFor(() => runStarted);
  assert.equal(runtimeOptions.environment.RUNNER_EXECUTION_ENABLED, "true");
  assert.equal(typeof runtimeOptions.emit, "function");
  assert.equal(typeof runtimeOptions.now, "function");
  runtimeOptions.emit({ kind: "phase-fixture" });
  assert.equal(audits.some((record) => record.kind === "phase-fixture"), true);
  const origin = `http://127.0.0.1:${service.port}`;

  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  const healthBody = await health.json();
  assert.equal(healthBody.service, "proofweave-trusted-runner");
  assert.equal(healthBody.state, "ready");
  assert.equal(healthBody.provider, "e2b");
  assert.equal(healthBody.revision, "47fa209a9aef5de9f76f5e2c04b9a1bfddb01872");
  assert.equal(healthBody.lastWakeAt, null);
  assert.equal(healthBody.executionEnabled, true);
  assert.deepEqual(
    healthBody.releaseDiagnostics,
    readyDiagnostics("47fa209a9aef5de9f76f5e2c04b9a1bfddb01872"),
  );
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
  assert.ok(Number(health.headers.get("content-length")) < 4_096);
  assert.doesNotMatch(JSON.stringify(healthBody), /private-turso-token-sentinel|proofweave-release-diagnostics\.example|wake-token/);

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
      RUNNER_EXECUTION_ENABLED: "true",
      RENDER_GIT_COMMIT: "b".repeat(40),
      PROOFWEAVE_RELEASE_SITES_VERSION: sitesVersion,
      PROOFWEAVE_RELEASE_SITE_PROJECT_ID: siteProjectId,
      PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: "invalid build id",
      TURSO_DATABASE_URL: tursoUrl,
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
  assert.equal(body.failureCode, "hosted_trusted_runner_configuration_error");
  assert.deepEqual(body.releaseDiagnostics, {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "degraded",
    authority: "invalid",
    databaseFingerprint: null,
    ledgerHead: null,
    sourceRevision: "b".repeat(40),
    sitesVersion,
    siteProjectId,
    failureCode: "control_plane_configuration_invalid",
  });
  assert.equal(body.runnerPolicy.templateId, null);
  assert.equal(body.runnerPolicy.templateBuildId, null);
  const rendered = JSON.stringify(body);
  assert.doesNotMatch(rendered, /secret database URL/);
  assert.doesNotMatch(rendered, /private-e2b-sentinel/);
  const wake = await fetch(`http://127.0.0.1:${service.port}/v1/wake`, {
    method: "POST",
    headers: { authorization: `Bearer ${wakeToken}` },
  });
  assert.equal(wake.status, 503);
  assert.deepEqual(await wake.json(), { error: "runner_unavailable" });
  await service.close();
});

test("hosted Runner remains degraded when the actual Turso ledger cannot be verified", async (t) => {
  const service = new HostedTrustedRunnerService({
    environment: {
      PORT: "0",
      HOST: "127.0.0.1",
      PROOFWEAVE_RUNNER_WAKE_TOKEN: wakeToken,
      PROOFWEAVE_RUNNER_PROVIDER: "e2b",
      RUNNER_EXECUTION_ENABLED: "true",
      RENDER_GIT_COMMIT: "c".repeat(40),
      PROOFWEAVE_RELEASE_SITES_VERSION: sitesVersion,
      PROOFWEAVE_RELEASE_SITE_PROJECT_ID: siteProjectId,
      PROOFWEAVE_E2B_RUNNER_IMAGE: imageDigest,
      PROOFWEAVE_E2B_TEMPLATE_ID: templateId,
      PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: templateBuildId,
      RUNNER_APPROVED_IMAGES_JSON: JSON.stringify([{
        imageDigest,
        leanToolchain: "leanprover/lean4:v4.31.0",
        mathlibRevision: "mathlib-revision",
      }]),
      TURSO_DATABASE_URL: tursoUrl,
      TURSO_AUTH_TOKEN: tursoToken,
    },
    runtimeFactory: async () => {
      throw new TypeError(`database verification failed ${tursoUrl} ${tursoToken}`);
    },
  });
  t.after(() => service.close());
  await service.start();
  await waitFor(() => service.state === "degraded");

  const response = await fetch(`http://127.0.0.1:${service.port}/healthz`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.deepEqual(body.releaseDiagnostics, {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "degraded",
    authority: "turso",
    databaseFingerprint: tursoDatabaseFingerprint(tursoUrl),
    ledgerHead: null,
    sourceRevision: "c".repeat(40),
    sitesVersion,
    siteProjectId,
    failureCode: "control_plane_verification_failed",
  });
  assert.doesNotMatch(JSON.stringify(body), /private-turso-token-sentinel|proofweave-release-diagnostics\.example/);
});

test("hosted Runner verifies Turso and stays healthy but non-executing while paused", async (t) => {
  let runtimeStarted = false;
  const service = new HostedTrustedRunnerService({
    environment: {
      PORT: "0",
      HOST: "127.0.0.1",
      PROOFWEAVE_RUNNER_WAKE_TOKEN: wakeToken,
      RUNNER_EXECUTION_ENABLED: "false",
      PROOFWEAVE_RUNNER_PROVIDER: "e2b",
      RENDER_GIT_COMMIT: "e".repeat(40),
      PROOFWEAVE_RELEASE_SITES_VERSION: sitesVersion,
      PROOFWEAVE_RELEASE_SITE_PROJECT_ID: siteProjectId,
      PROOFWEAVE_E2B_RUNNER_IMAGE: imageDigest,
      PROOFWEAVE_E2B_TEMPLATE_ID: templateId,
      PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: templateBuildId,
      RUNNER_APPROVED_IMAGES_JSON: JSON.stringify([{
        imageDigest,
        leanToolchain: "leanprover/lean4:v4.31.0",
        mathlibRevision: "mathlib-revision",
      }]),
      TURSO_DATABASE_URL: tursoUrl,
      TURSO_AUTH_TOKEN: tursoToken,
    },
    diagnosticsFactory: async () => readyDiagnostics("e".repeat(40)),
    runtimeFactory: async () => {
      runtimeStarted = true;
      throw new Error("paused Runner must not create its queue runtime");
    },
  });
  t.after(() => service.close());
  await service.start();
  await waitFor(() => service.state === "paused");

  const origin = `http://127.0.0.1:${service.port}`;
  const health = await fetch(`${origin}/healthz`);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.state, "paused");
  assert.equal(body.executionEnabled, false);
  assert.deepEqual(body.releaseDiagnostics, readyDiagnostics("e".repeat(40)));
  assert.equal(runtimeStarted, false);
  assert.equal((await fetch(`${origin}/v1/wake`, {
    method: "POST",
    headers: { authorization: `Bearer ${wakeToken}` },
  })).status, 503);
});

function readyDiagnostics(sourceRevision) {
  return {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "ready",
    authority: "turso",
    databaseFingerprint: tursoDatabaseFingerprint(tursoUrl),
    ledgerHead: "0043_add_runner_queue_event_sequence.sql",
    sourceRevision,
    sitesVersion,
    siteProjectId,
    failureCode: null,
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition was not reached.");
}
