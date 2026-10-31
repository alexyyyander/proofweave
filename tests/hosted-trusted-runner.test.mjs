import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@libsql/client";
import { HostedTrustedRunnerService } from "../services/lean-runner/hosted-trusted-runner.mjs";
import { inspectLiveControlPlaneDiagnostics, tursoDatabaseFingerprint } from "../db/control-plane-authority.mjs";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  applyProofweaveMigrations,
  loadProofweaveMigrations,
  verifyProofweaveControlPlane,
} from "../services/database/libsql-migrations.mjs";

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

for (const scenario of [
  { name: "current 0050 history", status: 200 },
  {
    name: "0050 history with the bounded 0039 legacy identity",
    status: 200,
    async prepare(database) {
      await database.prepare(
        "UPDATE _proofweave_migrations SET sha256 = ?, statement_count = ? WHERE name = ?",
      ).bind("03f7f5819c18255fb8264b8fe3c0c4c4d7458dd050b7bd1a6b8a8249cefe001c", 12, "0039_decouple_attempt_authority.sql").run();
    },
  },
  { name: "missing 0050 migration", status: 503, omitLatest: true, error: /not current: 50 applied, 1 pending/ },
  {
    name: "altered 0050 hash",
    status: 503,
    error: /integrity mismatch for 0050_add_runner_queue_environment.sql/,
    async prepare(database) {
      await database.prepare("UPDATE _proofweave_migrations SET sha256 = ? WHERE name = ?")
        .bind("0".repeat(64), "0050_add_runner_queue_environment.sql").run();
    },
  },
  {
    name: "altered 0050 statement count",
    status: 503,
    error: /integrity mismatch for 0050_add_runner_queue_environment.sql/,
    async prepare(database) {
      await database.prepare("UPDATE _proofweave_migrations SET statement_count = statement_count + 1 WHERE name = ?")
        .bind("0050_add_runner_queue_environment.sql").run();
    },
  },
  {
    name: "unknown 0051 migration",
    status: 503,
    error: /unsupported history length/,
    async prepare(database) {
      await database.prepare("INSERT INTO _proofweave_migrations (name, sha256, applied_at, statement_count) VALUES (?, ?, ?, ?)")
        .bind("0051_unknown.sql", "a".repeat(64), "2026-10-19T00:00:00.000Z", 1).run();
    },
  },
  {
    name: "missing required runs table",
    status: 503,
    error: /missing required tables: runs/,
    async prepare(database) {
      await database.prepare("DROP TABLE runs").run();
    },
  },
  { name: "database read failure", status: 503, failReads: true, error: /private database read failure/ },
]) {
  test(`paused Runner uses real migration verification: ${scenario.name}`, { timeout: 10_000 }, async (t) => {
    const database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
    let service;
    t.after(async () => {
      try { await service?.close(); } finally { database.close(); }
    });
    const migrations = await loadProofweaveMigrations();
    assert.equal(migrations.at(-1).name, "0050_add_runner_queue_environment.sql");
    await applyProofweaveMigrations({ database, migrations: scenario.omitLatest ? migrations.slice(0, -1) : migrations });
    await scenario.prepare?.(database);
    const ledgerSql = "SELECT * FROM _proofweave_migrations ORDER BY name";
    const before = await database.prepare(ledgerSql).all();
    const writeAttempts = [];
    const readOnlyDatabase = {
      prepare(sql) {
        if (!/^SELECT\b/.test(sql) && sql !== "PRAGMA table_info(_proofweave_migrations)") {
          writeAttempts.push(sql);
          throw new Error("paused verification must not prepare writes");
        }
        if (scenario.failReads) throw new Error(`private database read failure: ${tursoUrl} ${tursoToken}`);
        const statement = database.prepare(sql);
        return {
          first: statement.first.bind(statement),
          all: statement.all.bind(statement),
          run() { writeAttempts.push(sql); throw new Error("paused verification must not run writes"); },
        };
      },
      batch() { writeAttempts.push("batch"); throw new Error("paused verification must not batch writes"); },
    };
    const revision = "e".repeat(40);
    let runtimeCalls = 0;
    let verificationError = null;
    const audits = [];
    service = new HostedTrustedRunnerService({
      environment: pausedEnvironment(revision),
      diagnosticsFactory: () => inspectLiveControlPlaneDiagnostics({
        authority: "turso",
        databaseUrl: tursoUrl,
        database: readOnlyDatabase,
        releaseIdentity: { sourceRevision: revision, sitesVersion, siteProjectId },
        async verifyDatabase({ database }) {
          try { return await verifyProofweaveControlPlane({ database, migrations }); }
          catch (error) { verificationError = error; throw error; }
        },
      }),
      runtimeFactory: async () => {
        runtimeCalls += 1;
        throw new Error("paused Runner must not create its queue runtime");
      },
      emit: (record) => audits.push(record),
    });
    await service.start();
    await service.workerPromise;

    const origin = `http://127.0.0.1:${service.port}`;
    const health = await fetch(`${origin}/healthz`);
    const body = await health.json();
    assert.equal(health.status, scenario.status);
    assert.equal(body.state, scenario.status === 200 ? "paused" : "degraded");
    assert.equal(body.executionEnabled, false);
    assert.equal(body.lastWakeAt, null);
    assert.deepEqual(body.releaseDiagnostics, {
      ...readyDiagnostics(revision),
      state: scenario.status === 200 ? "ready" : "degraded",
      ledgerHead: scenario.status === 200 ? migrations.at(-1).name : null,
      failureCode: scenario.status === 200 ? null : "control_plane_verification_failed",
    });
    if (scenario.error) assert.match(verificationError?.message ?? "", scenario.error);
    else assert.equal(verificationError, null);
    assert.ok(audits.some((record) => record.outcome === (scenario.status === 200 ? "paused" : "startup_or_worker_error")));
    assert.doesNotMatch(JSON.stringify({ body, audits }), /private database read failure|private-turso-token-sentinel|proofweave-release-diagnostics\.example/);

    const wake = await fetch(`${origin}/v1/wake`, {
      method: "POST",
      headers: { authorization: `Bearer ${wakeToken}` },
    });
    assert.equal(wake.status, 503);
    assert.deepEqual(await wake.json(), { error: "runner_unavailable" });
    assert.equal(service.lastWakeAt, null);
    assert.equal(runtimeCalls, 0);
    assert.deepEqual(writeAttempts, [], "even rejected verification must not attempt writes");
    assert.deepEqual(await database.prepare(ledgerSql).all(), before);
  });
}

function pausedEnvironment(revision) {
  return {
    PORT: "0",
    HOST: "127.0.0.1",
    PROOFWEAVE_RUNNER_WAKE_TOKEN: wakeToken,
    RUNNER_EXECUTION_ENABLED: "false",
    PROOFWEAVE_RUNNER_PROVIDER: "e2b",
    RENDER_GIT_COMMIT: revision,
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
  };
}

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
