import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildRunnerEnvironmentReport,
  buildRunnerEnvironmentReportFromFiles,
  formatHumanReport,
  parseRenderYamlEnvVars,
  schemaVersion,
  validateRunnerEnvironmentsConfig,
} from "../scripts/check-runner-environments.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "scripts", "check-runner-environments.mjs");
const approvedDigest = "ghcr.io/alexyyyander/proofweave-lean-runner@sha256:ca896ab3945034079ab7f7cedfc7c5e665a601299c1745b51a72736420957393";
const pendingDigest = "ghcr.io/alexyyyander/proofweave-lean-runner@sha256:3a7e335f2f1acae3296f7e0c5933e5b160ccdc37fe4e363c2c81aa73118f86b0";
const lean431 = "leanprover/lean4:v4.31.0";
const lean427 = "leanprover/lean4:v4.27.0";
const mathlib431 = "9a9483a92959bc92bd6a60176dd1fe597298c1f8";
const mathlib427 = "a3a10db0e9d66acbebf76c5e6a135066525ac900";
const pendingSourceCommit = "c3461cf0d3c81edda6b1f3bd12e9b76e18bfc3e1";

function approvedEnvironment(overrides = {}) {
  return {
    profile: "mathlib-4.31-9a948",
    imageDigest: approvedDigest,
    leanToolchain: lean431,
    mathlibRevision: mathlib431,
    state: "approved",
    sourceRun: null,
    sourceCommit: null,
    ...overrides,
  };
}

function pendingEnvironment(overrides = {}) {
  return {
    profile: "mathlib-4.27-a3a10",
    imageDigest: pendingDigest,
    leanToolchain: lean427,
    mathlibRevision: mathlib427,
    state: "built_pending_template",
    sourceRun: 40469297704,
    sourceCommit: pendingSourceCommit,
    ...overrides,
  };
}

function fixtureConfig(environments = [approvedEnvironment(), pendingEnvironment()]) {
  return { schemaVersion, environments };
}

function approvedImageBinding(overrides = {}) {
  return {
    imageDigest: approvedDigest,
    leanToolchain: lean431,
    mathlibRevision: mathlib431,
    ...overrides,
  };
}

function pendingImageBinding(overrides = {}) {
  return {
    imageDigest: pendingDigest,
    leanToolchain: lean427,
    mathlibRevision: mathlib427,
    ...overrides,
  };
}

async function createFixtureDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), "pw-runner-environments-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function writeFixture(t, {
  config,
  workerApprovedImages,
  renderApprovedImages,
  renderExecutionImage,
  renderTemplateId = "cbfjgbsrgtku0c7sliu5:test-template",
  renderExecutionEnabled = "false",
}) {
  const dir = await createFixtureDir(t);
  const configPath = path.join(dir, "runner-environments.json");
  const wranglerPath = path.join(dir, "wrangler.jsonc");
  const renderPath = path.join(dir, "render.yaml");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(wranglerPath, `${JSON.stringify({
    vars: { RUNNER_APPROVED_IMAGES_JSON: JSON.stringify(workerApprovedImages) },
  }, null, 2)}\n`);
  const renderLines = [
    "services:",
    "  - type: web",
    "    name: proofweave-trusted-runner",
    "    envVars:",
    "      - key: RUNNER_EXECUTION_ENABLED",
    `        value: "${renderExecutionEnabled}"`,
    "      - key: RUNNER_APPROVED_IMAGES_JSON",
    `        value: '${JSON.stringify(renderApprovedImages).replaceAll("'", "''")}'`,
    "      - key: PROOFWEAVE_E2B_RUNNER_IMAGE",
    `        value: ${renderExecutionImage}`,
  ];
  if (renderTemplateId !== null) {
    renderLines.push(
      "      - key: PROOFWEAVE_E2B_TEMPLATE_ID",
      `        value: ${renderTemplateId}`,
    );
  }
  renderLines.push("    healthCheckPath: /healthz");
  await writeFile(renderPath, `${renderLines.join("\n")}\n`);
  return { configPath, wranglerPath, renderPath };
}

function runCli(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], { encoding: "utf8", timeout: 30_000 });
}

function fixtureArgs(paths) {
  return ["--config", paths.configPath, "--wrangler", paths.wranglerPath, "--render", paths.renderPath];
}

test("repository configuration registers 4.31 as approved and 4.27 as built pending template", async () => {
  const report = await buildRunnerEnvironmentReportFromFiles();

  assert.equal(report.configSchemaVersion, schemaVersion);
  assert.equal(report.summary.environments, 2);
  assert.equal(report.summary.approved, 1);
  assert.equal(report.summary.pending, 1);
  assert.equal(report.summary.admissible, 1);
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.ok, true);
  assert.deepEqual(report.inconsistencies, []);

  assert.deepEqual(report.deployment.worker.approvedImages, [approvedImageBinding()]);
  assert.deepEqual(report.deployment.render.approvedImages, [approvedImageBinding()]);
  assert.equal(report.deployment.render.executionImage, approvedDigest);
  assert.equal(report.deployment.render.templateId, "cbfjgbsrgtku0c7sliu5:workspace-modes-20261019-617de06");
  assert.equal(report.deployment.render.executionEnabled, "false");

  const approved = report.environments.find((entry) => entry.profile === "mathlib-4.31-9a948");
  assert.ok(approved);
  assert.equal(approved.state, "approved");
  assert.equal(approved.imageDigest, approvedDigest);
  assert.equal(approved.leanToolchain, lean431);
  assert.equal(approved.mathlibRevision, mathlib431);
  assert.equal(approved.admissible, true);
  assert.equal(approved.blocked, false);
  assert.deepEqual(approved.blockers, []);
  assert.deepEqual(approved.deployment, {
    workerApproved: true,
    renderApproved: true,
    executionImage: true,
    e2bTemplateConfigured: true,
    e2bTemplateBound: true,
  });

  const pending = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.ok(pending);
  assert.equal(pending.state, "built_pending_template");
  assert.equal(pending.imageDigest, pendingDigest);
  assert.equal(pending.leanToolchain, lean427);
  assert.equal(pending.mathlibRevision, mathlib427);
  assert.equal(pending.sourceRun, 40469297704);
  assert.equal(pending.sourceCommit, pendingSourceCommit);
  assert.equal(pending.admissible, false);
  assert.equal(pending.blocked, true);
  assert.ok(pending.blockers.includes("environment_state_pending"));
  assert.ok(pending.blockers.includes("missing_e2b_template"));
  assert.ok(pending.blockers.includes("missing_worker_approval"));
  assert.ok(pending.blockers.includes("missing_render_approval"));
  assert.ok(pending.blockers.includes("execution_image_not_switched"));
  assert.equal(pending.deployment.workerApproved, false);
  assert.equal(pending.deployment.renderApproved, false);
  assert.equal(pending.deployment.executionImage, false);
  assert.equal(pending.deployment.e2bTemplateBound, false);

  const human = formatHumanReport(report);
  assert.match(human, /built_pending_template/);
  assert.match(human, /missing_e2b_template/);
  assert.match(human, /Inconsistencies: none/);
});

test("render.yaml parser reads pinned deployment values without evaluating secrets", async () => {
  const values = parseRenderYamlEnvVars(
    await readFile(path.join(root, "deploy", "huggingface-runner", "render.yaml"), "utf8"),
  );
  assert.equal(values.get("PROOFWEAVE_E2B_RUNNER_IMAGE").value, approvedDigest);
  assert.equal(values.get("PROOFWEAVE_E2B_TEMPLATE_ID").value, "cbfjgbsrgtku0c7sliu5:workspace-modes-20261019-617de06");
  assert.equal(values.get("PROOFWEAVE_E2B_TEMPLATE_BUILD_ID").value, "4fd0e92f-9513-4c3d-8af3-6492e86c3f24");
  assert.equal(values.get("RUNNER_EXECUTION_ENABLED").value, "false");
  const renderApproved = JSON.parse(values.get("RUNNER_APPROVED_IMAGES_JSON").value);
  assert.deepEqual(renderApproved, [approvedImageBinding()]);
  assert.equal(values.get("TURSO_AUTH_TOKEN").value, null);
  assert.equal(values.get("TURSO_AUTH_TOKEN").sync, "false");
});

test("configuration validation rejects schema, digest, duplicate, and state violations", () => {
  assert.throws(() => validateRunnerEnvironmentsConfig(null), /must be an object/);
  assert.throws(
    () => validateRunnerEnvironmentsConfig({ schemaVersion: "other", environments: [approvedEnvironment()] }),
    /schemaVersion/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig({ schemaVersion, environments: [] }),
    /at least one environment/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig({ schemaVersion, environments: [approvedEnvironment()], extra: true }),
    /unsupported field/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([approvedEnvironment({ unexpected: 1 })])),
    /unsupported field/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([approvedEnvironment({ imageDigest: "ghcr.io/example/runner@sha256:abc" })])),
    /imageDigest/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([approvedEnvironment({ imageDigest: approvedDigest.toUpperCase() })])),
    /imageDigest/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([approvedEnvironment({ imageDigest: `${approvedDigest.split("@")[0]}:latest` })])),
    /imageDigest/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([approvedEnvironment(), approvedEnvironment({ profile: "duplicate-digest" })])),
    /digests must be unique/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([
      approvedEnvironment(),
      approvedEnvironment({ imageDigest: pendingDigest, leanToolchain: lean427, mathlibRevision: mathlib427 }),
    ])),
    /profiles must be unique/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([
      approvedEnvironment(),
      approvedEnvironment({ profile: "same-pair", imageDigest: pendingDigest }),
    ])),
    /Lean and Mathlib pair/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([approvedEnvironment({ state: "draft" })])),
    /state must be one of/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([pendingEnvironment({ sourceRun: null })])),
    /sourceRun/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([approvedEnvironment({ sourceCommit: "8bd7409" })])),
    /sourceCommit/,
  );
});

test("a pending environment pre-approved only in the Worker allowlist remains blocked", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
    renderTemplateId: "cbfjgbsrgtku0c7sliu5:test-template",
  });

  const pending = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(pending.deployment.workerApproved, true);
  assert.equal(pending.deployment.renderApproved, false);
  assert.equal(pending.deployment.executionImage, false);
  assert.equal(pending.admissible, false);
  assert.ok(pending.blockers.includes("missing_e2b_template"));
  assert.ok(!pending.blockers.includes("missing_worker_approval"));
  assert.equal(report.ok, true);
  assert.deepEqual(report.inconsistencies, []);
});

test("a pending environment approved for Render execution is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderExecutionImage: pendingDigest,
    renderTemplateId: "cbfjgbsrgtku0c7sliu5:test-template",
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "pending_environment_approved"));
  const pending = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(pending.admissible, false);
  assert.ok(pending.blockers.includes("environment_state_pending"));
  assert.ok(!pending.blockers.includes("missing_e2b_template"));
});

test("strict mode exits 0 on the repository configuration and --json emits a report", () => {
  const result = runCli(["--strict", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reportSchemaVersion, "pw-runner-environment-report-v1");
  assert.deepEqual(report.summary, {
    environments: 2,
    approved: 1,
    pending: 1,
    admissible: 1,
    blocked: 1,
    inconsistencies: 0,
  });
  assert.equal(report.ok, true);
});

test("strict mode exits 1 when a pending environment is approved for Render execution", async (t) => {
  const paths = await writeFixture(t, {
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderExecutionImage: pendingDigest,
  });

  const loose = runCli(fixtureArgs(paths));
  assert.equal(loose.status, 0, loose.stderr);
  assert.match(loose.stdout, /pending_environment_approved/);
  assert.match(loose.stdout, /Rerun with --strict/);

  const strict = runCli([...fixtureArgs(paths), "--strict"]);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /pending_environment_approved/);
});

test("strict mode exits 1 when an approved environment is missing from a deployment allowlist", async (t) => {
  const paths = await writeFixture(t, {
    config: fixtureConfig(),
    workerApprovedImages: [pendingImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
  });

  const strict = runCli([...fixtureArgs(paths), "--strict"]);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /approved_environment_not_admissible/);
  assert.match(strict.stdout, /missing_worker_approval/);
});

test("strict mode exits 1 when a deployment approves an unregistered image", async (t) => {
  const strangerDigest = `ghcr.io/alexyyyander/proofweave-lean-runner@sha256:${"d".repeat(64)}`;
  const paths = await writeFixture(t, {
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding()],
    renderApprovedImages: [approvedImageBinding(), approvedImageBinding({ imageDigest: strangerDigest })],
    renderExecutionImage: approvedDigest,
  });

  const strict = runCli([...fixtureArgs(paths), "--strict"]);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /unregistered_approved_image/);
});

test("strict mode exits 1 when a deployment binds a digest to a different Lean environment", async (t) => {
  const paths = await writeFixture(t, {
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding({ mathlibRevision: mathlib427 })],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
  });

  const strict = runCli([...fixtureArgs(paths), "--strict"]);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /approved_image_environment_mismatch/);
});

test("malformed configuration fails closed without --strict", async (t) => {
  const paths = await writeFixture(t, {
    config: fixtureConfig([approvedEnvironment({ imageDigest: "ghcr.io/example/runner@sha256:abc" })]),
    workerApprovedImages: [approvedImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
  });

  const result = runCli(fixtureArgs(paths));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /imageDigest/);
});
