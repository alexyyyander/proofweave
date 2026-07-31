import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GithubIndependentLiveReleaseBindingError,
  inspectRunnerReleaseHealth,
  runnerReleaseHealthModes,
} from "../scripts/lib/github-independent-live-release-binding.mjs";

const revision = "a".repeat(40);
const databaseFingerprint = "0123456789abcdef";
const ledgerHead = "0043_add_runner_queue_event_sequence.sql";
const siteProjectId = `appgprj_${"f".repeat(32)}`;
const sitesVersion = "release-140";
const imageDigest = `registry.example/proofweave@sha256:${"1".repeat(64)}`;
const templateId = "template-production";
const templateBuildId = "build-production";
const leanToolchain = "v4.30.0";
const mathlibRevision = "2".repeat(40);

test("Runner release health defaults to live execution and accepts ready only", async () => {
  const result = await inspect(readyHealth());
  assert.equal(result.state, "ready");
  assert.equal(result.executionEnabled, true);

  await rejected(pausedHealth(), undefined, "RUNNER_HEALTH_MISMATCH");
});

test("Phase 6 mode accepts only a paused, non-executing Runner", async () => {
  const result = await inspect(pausedHealth(), runnerReleaseHealthModes.phase6Paused);
  assert.equal(result.state, "paused");
  assert.equal(result.executionEnabled, false);

  await rejected(
    readyHealth(),
    runnerReleaseHealthModes.phase6Paused,
    "RUNNER_HEALTH_MISMATCH",
  );
});

test("Runner release health rejects an unknown mode before network access", async () => {
  let fetches = 0;
  await assert.rejects(
    inspectRunnerReleaseHealth({
      fetcher: async () => {
        fetches += 1;
        return jsonResponse(pausedHealth());
      },
      runnerOrigin: "https://runner.example",
      expected: expectedRelease(),
      mode: "paused",
    }),
    (error) => error instanceof GithubIndependentLiveReleaseBindingError
      && error.code === "RUNNER_HEALTH_MODE_INVALID",
  );
  assert.equal(fetches, 0);
});

test("Phase 6 mode rejects every release identity and approved policy drift", async (context) => {
  const cases = [
    ["top-level revision", (health) => { health.revision = "b".repeat(40); }, "RUNNER_HEALTH_MISMATCH"],
    [
      "diagnostics revision",
      (health) => { health.releaseDiagnostics.sourceRevision = "b".repeat(40); },
      "RUNNER_RELEASE_IDENTITY_MISMATCH",
    ],
    [
      "Sites version",
      (health) => { health.releaseDiagnostics.sitesVersion = "release-139"; },
      "RUNNER_RELEASE_IDENTITY_MISMATCH",
    ],
    [
      "Sites project",
      (health) => {
        health.releaseDiagnostics.siteProjectId = `appgprj_${"e".repeat(32)}`;
      },
      "RUNNER_RELEASE_IDENTITY_MISMATCH",
    ],
    [
      "database fingerprint",
      (health) => { health.releaseDiagnostics.databaseFingerprint = "fedcba9876543210"; },
      "LIVE_RELEASE_AUTHORITY_MISMATCH",
    ],
    [
      "migration ledger",
      (health) => {
        health.releaseDiagnostics.ledgerHead = "0042_add_jacobian_counterexample_audit.sql";
      },
      "LIVE_RELEASE_AUTHORITY_MISMATCH",
    ],
    [
      "template",
      (health) => { health.runnerPolicy.templateId = "template-other"; },
      "RUNNER_POLICY_MISMATCH",
    ],
    [
      "template build",
      (health) => { health.runnerPolicy.templateBuildId = "build-other"; },
      "RUNNER_POLICY_MISMATCH",
    ],
    [
      "sandbox image",
      (health) => {
        health.runnerPolicy.sandboxImageDigest =
          `registry.example/proofweave@sha256:${"3".repeat(64)}`;
      },
      "RUNNER_POLICY_MISMATCH",
    ],
    [
      "approved image",
      (health) => {
        health.runnerPolicy.approvedImages[0].imageDigest =
          `registry.example/proofweave@sha256:${"3".repeat(64)}`;
      },
      "RUNNER_POLICY_MISMATCH",
    ],
    [
      "Lean toolchain",
      (health) => { health.runnerPolicy.approvedImages[0].leanToolchain = "v4.29.0"; },
      "RUNNER_POLICY_MISMATCH",
    ],
    [
      "Mathlib revision",
      (health) => { health.runnerPolicy.approvedImages[0].mathlibRevision = "3".repeat(40); },
      "RUNNER_POLICY_MISMATCH",
    ],
    [
      "image approval",
      (health) => { health.runnerPolicy.sandboxImageApproved = false; },
      "RUNNER_POLICY_MISMATCH",
    ],
  ];

  for (const [name, mutate, code] of cases) {
    await context.test(name, async () => {
      const health = pausedHealth();
      mutate(health);
      await rejected(health, runnerReleaseHealthModes.phase6Paused, code);
    });
  }
});

async function inspect(health, mode) {
  return inspectRunnerReleaseHealth({
    fetcher: async () => jsonResponse(health),
    runnerOrigin: "https://runner.example",
    expected: expectedRelease(),
    ...(mode === undefined ? {} : { mode }),
  });
}

async function rejected(health, mode, code) {
  await assert.rejects(
    inspect(health, mode),
    (error) => error instanceof GithubIndependentLiveReleaseBindingError
      && error.code === code,
  );
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function readyHealth() {
  return runnerHealth("ready", true);
}

function pausedHealth() {
  return runnerHealth("paused", false);
}

function runnerHealth(state, executionEnabled) {
  return {
    service: "proofweave-trusted-runner",
    state,
    provider: "e2b",
    revision,
    lastWakeAt: null,
    executionEnabled,
    releaseDiagnostics: {
      schemaVersion: "pw-live-release-diagnostics-v2",
      state: "ready",
      authority: "turso",
      databaseFingerprint,
      ledgerHead,
      sourceRevision: revision,
      sitesVersion,
      siteProjectId,
      failureCode: null,
    },
    runnerPolicy: {
      state: "configured",
      sandboxImageDigest: imageDigest,
      templateId,
      templateBuildId,
      approvedImages: [{
        imageDigest,
        leanToolchain,
        mathlibRevision,
      }],
      sandboxImageApproved: true,
    },
    executionBoundary: "isolated-sandbox-only",
  };
}

function expectedRelease() {
  return {
    revision,
    sitesVersion,
    siteProjectId,
    databaseFingerprint,
    ledgerHead,
    imageDigest,
    templateId,
    templateBuildId,
    leanToolchain,
    mathlibRevision,
  };
}
