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
  parseRenderServices,
  parseRenderYamlEnvVars,
  reportSchemaVersion,
  schemaVersion,
  validateRunnerEnvironmentsConfig,
} from "../scripts/check-runner-environments.mjs";
import {
  formatEnvironmentAssignments,
  generateRunnerEnvironmentConfig,
  generationSchemaVersion,
  RunnerEnvironmentGenerationError,
} from "../scripts/generate-runner-environment-config.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(root, "scripts", "check-runner-environments.mjs");
const generatorPath = path.join(root, "scripts", "generate-runner-environment-config.mjs");
const configPath = path.join(root, "config", "runner-environments.json");
const approvedDigest = "ghcr.io/alexyyyander/proofweave-lean-runner@sha256:ca896ab3945034079ab7f7cedfc7c5e665a601299c1745b51a72736420957393";
const pendingDigest = "ghcr.io/alexyyyander/proofweave-lean-runner@sha256:3a7e335f2f1acae3296f7e0c5933e5b160ccdc37fe4e363c2c81aa73118f86b0";
const lean431 = "leanprover/lean4:v4.31.0";
const lean427 = "leanprover/lean4:v4.27.0";
const mathlib431 = "9a9483a92959bc92bd6a60176dd1fe597298c1f8";
const mathlib427 = "a3a10db0e9d66acbebf76c5e6a135066525ac900";
const pendingSourceCommit = "c3461cf0d3c81edda6b1f3bd12e9b76e18bfc3e1";
const approvedTemplate = Object.freeze({
  id: "cbfjgbsrgtku0c7sliu5:workspace-modes-20261019-617de06",
  buildId: "4fd0e92f-9513-4c3d-8af3-6492e86c3f24",
  sourceImageDigest: approvedDigest,
});
const pendingTemplate = Object.freeze({
  id: "c5e6a7b8c9d0e1f2g3h4:mathlib-4.27-a3a10",
  buildId: "7c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f",
  sourceImageDigest: pendingDigest,
});

function approvedEnvironment(overrides = {}) {
  return {
    profile: "mathlib-4.31-9a948",
    imageDigest: approvedDigest,
    leanToolchain: lean431,
    mathlibRevision: mathlib431,
    state: "approved",
    sourceRun: null,
    sourceCommit: null,
    template: { ...approvedTemplate },
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
    template: null,
    ...overrides,
  };
}

function templateReadyEnvironment(overrides = {}) {
  return pendingEnvironment({
    state: "template_ready",
    template: { ...pendingTemplate },
    ...overrides,
  });
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
  renderTemplateId = approvedTemplate.id,
  renderTemplateBuildId = approvedTemplate.buildId,
  renderExecutionEnabled = "false",
  renderOnlyRunId = null,
}) {
  const dir = await createFixtureDir(t);
  const fixtureConfigPath = path.join(dir, "runner-environments.json");
  const wranglerPath = path.join(dir, "wrangler.jsonc");
  const renderPath = path.join(dir, "render.yaml");
  await writeFile(fixtureConfigPath, `${JSON.stringify(config, null, 2)}\n`);
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
  ];
  if (renderOnlyRunId !== null) {
    renderLines.push(
      "      - key: RUNNER_ONLY_RUN_ID",
      `        value: ${renderOnlyRunId}`,
    );
  }
  renderLines.push(
    "      - key: RUNNER_APPROVED_IMAGES_JSON",
    `        value: '${JSON.stringify(renderApprovedImages).replaceAll("'", "''")}'`,
    "      - key: PROOFWEAVE_E2B_RUNNER_IMAGE",
    `        value: ${renderExecutionImage}`,
  );
  if (renderTemplateId !== null) {
    renderLines.push(
      "      - key: PROOFWEAVE_E2B_TEMPLATE_ID",
      `        value: ${renderTemplateId}`,
    );
  }
  if (renderTemplateBuildId !== null) {
    renderLines.push(
      "      - key: PROOFWEAVE_E2B_TEMPLATE_BUILD_ID",
      `        value: ${renderTemplateBuildId}`,
    );
  }
  renderLines.push("    healthCheckPath: /healthz");
  await writeFile(renderPath, `${renderLines.join("\n")}\n`);
  return { configPath: fixtureConfigPath, wranglerPath, renderPath };
}

function runCli(args, script = scriptPath) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 30_000 });
}

function fixtureArgs(paths) {
  return ["--config", paths.configPath, "--wrangler", paths.wranglerPath, "--render", paths.renderPath];
}

async function readRepositoryConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

test("repository configuration registers 4.31 as approved with its template and 4.27 as built pending template", async () => {
  const report = await buildRunnerEnvironmentReportFromFiles();

  assert.equal(report.configSchemaVersion, schemaVersion);
  assert.equal(report.reportSchemaVersion, reportSchemaVersion);
  assert.equal(report.summary.environments, 2);
  assert.equal(report.summary.approved, 1);
  assert.equal(report.summary.templateReady, 0);
  assert.equal(report.summary.pending, 1);
  assert.equal(report.summary.runners, 1);
  assert.equal(report.summary.dispatchable, 1);
  assert.equal(report.summary.routed, 1);
  assert.equal(report.summary.selected, 1);
  assert.equal(report.summary.executing, 0);
  assert.equal(report.ok, true);
  assert.deepEqual(report.inconsistencies, []);

  assert.deepEqual(report.deployment.worker.approvedImages, [approvedImageBinding()]);
  assert.deepEqual(report.deployment.render.approvedImages, [approvedImageBinding()]);
  assert.equal(report.deployment.render.executionImage, approvedDigest);
  assert.equal(report.deployment.render.executionEnvironment, "mathlib-4.31-9a948");
  assert.equal(report.deployment.render.templateId, approvedTemplate.id);
  assert.equal(report.deployment.render.templateBuildId, approvedTemplate.buildId);
  assert.equal(report.deployment.render.templateMatchesRegistry, true);
  assert.equal(report.deployment.render.executionEnabled, "false");
  assert.equal(report.deployment.render.controlledSingleRun, false);
  assert.equal(report.deployment.render.onlyRunId, null);

  const approved = report.environments.find((entry) => entry.profile === "mathlib-4.31-9a948");
  assert.ok(approved);
  assert.equal(approved.state, "approved");
  assert.equal(approved.imageDigest, approvedDigest);
  assert.equal(approved.leanToolchain, lean431);
  assert.equal(approved.mathlibRevision, mathlib431);
  assert.deepEqual(approved.template, approvedTemplate);
  assert.equal(approved.ready, true);
  assert.equal(approved.dispatchable, true);
  assert.equal(approved.executionSelected, true);
  assert.equal(approved.executing, false);
  assert.deepEqual(approved.executionBlockers, ["runner_execution_disabled"]);
  assert.deepEqual(approved.deployment, {
    workerApproved: true,
    runnerLabels: ["proofweave-trusted-runner"],
    executionSelected: true,
    executing: false,
  });

  const pending = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.ok(pending);
  assert.equal(pending.state, "built_pending_template");
  assert.equal(pending.imageDigest, pendingDigest);
  assert.equal(pending.leanToolchain, lean427);
  assert.equal(pending.mathlibRevision, mathlib427);
  assert.equal(pending.sourceRun, 40469297704);
  assert.equal(pending.sourceCommit, pendingSourceCommit);
  assert.equal(pending.template, null);
  assert.equal(pending.ready, false);
  assert.equal(pending.dispatchable, false);
  assert.equal(pending.executionSelected, false);
  assert.equal(pending.executing, false);
  assert.ok(pending.executionBlockers.includes("environment_state_not_approved"));
  assert.ok(pending.executionBlockers.includes("missing_e2b_template"));
  assert.ok(pending.executionBlockers.includes("not_in_worker_allowlist"));
  assert.ok(pending.executionBlockers.includes("no_runner_deployment"));
  assert.deepEqual(pending.deployment, {
    workerApproved: false,
    runnerLabels: [],
    executionSelected: false,
    executing: false,
  });

  const human = formatHumanReport(report);
  assert.match(human, /built_pending_template/);
  assert.match(human, /environment_state_not_approved/);
  assert.match(human, /template registered: yes/);
  assert.match(human, /executing: no/);
  assert.match(human, /Inconsistencies: none/);
});

test("render.yaml parser reads pinned deployment values without evaluating secrets", async () => {
  const values = parseRenderYamlEnvVars(
    await readFile(path.join(root, "deploy", "huggingface-runner", "render.yaml"), "utf8"),
  );
  assert.equal(values.get("PROOFWEAVE_E2B_RUNNER_IMAGE").value, approvedDigest);
  assert.equal(values.get("PROOFWEAVE_E2B_TEMPLATE_ID").value, approvedTemplate.id);
  assert.equal(values.get("PROOFWEAVE_E2B_TEMPLATE_BUILD_ID").value, approvedTemplate.buildId);
  assert.equal(values.get("RUNNER_EXECUTION_ENABLED").value, "false");
  const renderApproved = JSON.parse(values.get("RUNNER_APPROVED_IMAGES_JSON").value);
  assert.deepEqual(renderApproved, [approvedImageBinding()]);
  assert.equal(values.get("TURSO_AUTH_TOKEN").value, null);
  assert.equal(values.get("TURSO_AUTH_TOKEN").sync, "false");
});

test("render.yaml parser reads every Runner service with its own env vars", () => {
  const services = parseRenderServices([
    "services:",
    "  - type: web",
    "    name: proofweave-trusted-runner-431",
    "    envVars:",
    "      - key: RUNNER_EXECUTION_ENABLED",
    '        value: "false"',
    "      - key: RUNNER_APPROVED_IMAGES_JSON",
    '        value: \'[{"imageDigest":"a"}]\'',
    "    healthCheckPath: /healthz",
    "  - type: web",
    "    name: proofweave-trusted-runner-427",
    "    envVars:",
    "      - key: RUNNER_EXECUTION_ENABLED",
    '        value: "true"',
    "      - key: RUNNER_ONLY_RUN_ID",
    "        value: run:controlled",
    "    healthCheckPath: /healthz",
    "",
  ].join("\n"));

  assert.equal(services.length, 2);
  assert.equal(services[0].name, "proofweave-trusted-runner-431");
  assert.equal(services[0].envVars.get("RUNNER_EXECUTION_ENABLED").value, "false");
  assert.equal(services[0].envVars.get("RUNNER_APPROVED_IMAGES_JSON").value, '[{"imageDigest":"a"}]');
  assert.equal(services[1].name, "proofweave-trusted-runner-427");
  assert.equal(services[1].envVars.get("RUNNER_EXECUTION_ENABLED").value, "true");
  assert.equal(services[1].envVars.get("RUNNER_ONLY_RUN_ID").value, "run:controlled");
});

test("configuration validation rejects schema, digest, template, and state violations", () => {
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
      approvedEnvironment({
        imageDigest: pendingDigest,
        leanToolchain: lean427,
        mathlibRevision: mathlib427,
        template: { ...approvedTemplate, sourceImageDigest: pendingDigest },
      }),
    ])),
    /profiles must be unique/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([
      approvedEnvironment(),
      approvedEnvironment({
        profile: "same-pair",
        imageDigest: pendingDigest,
        template: { ...approvedTemplate, sourceImageDigest: pendingDigest },
      }),
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
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([pendingEnvironment({ template: { ...pendingTemplate } })])),
    /must not declare an E2B template/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([approvedEnvironment({ template: null })])),
    /must record its E2B template/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([templateReadyEnvironment({ template: null })])),
    /must record its E2B template/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([templateReadyEnvironment({ sourceCommit: null })])),
    /sourceRun and sourceCommit/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([
      templateReadyEnvironment({ template: { ...pendingTemplate, sourceImageDigest: approvedDigest } }),
    ])),
    /sourceImageDigest must equal/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([
      approvedEnvironment({ template: { ...approvedTemplate, extra: "x" } }),
    ])),
    /template contains unsupported field/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([
      approvedEnvironment({ template: { ...approvedTemplate, id: "Invalid Template!" } }),
    ])),
    /template\.id/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([
      approvedEnvironment({ template: { ...approvedTemplate, buildId: "build id with spaces" } }),
    ])),
    /template\.buildId/,
  );
  assert.throws(
    () => validateRunnerEnvironmentsConfig(fixtureConfig([
      approvedEnvironment({ template: { ...approvedTemplate, sourceImageDigest: "ghcr.io/example/runner:latest" } }),
    ])),
    /template\.sourceImageDigest/,
  );
});

test("an approved environment that is not the deployed execution image remains ready but not dispatchable", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment({ state: "approved" })]),
    workerApprovedImages: [approvedImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
    renderTemplateId: approvedTemplate.id,
    renderTemplateBuildId: approvedTemplate.buildId,
    renderExecutionEnabled: "false",
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.inconsistencies, []);
  assert.equal(report.summary.approved, 2);
  assert.equal(report.summary.runners, 1);
  assert.equal(report.summary.dispatchable, 1);
  assert.equal(report.summary.routed, 1);
  assert.equal(report.summary.selected, 1);
  assert.equal(report.summary.executing, 0);

  const second = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(second.ready, true);
  assert.equal(second.dispatchable, false);
  assert.equal(second.routed, false);
  assert.equal(second.executionSelected, false);
  assert.equal(second.executing, false);
  assert.notEqual(second.template, null);
  assert.ok(second.executionBlockers.includes("not_in_worker_allowlist"));
  assert.ok(second.executionBlockers.includes("no_runner_deployment"));
});

test("a pending environment in the Worker allowlist is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
    renderTemplateId: approvedTemplate.id,
    renderTemplateBuildId: approvedTemplate.buildId,
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "pending_environment_approved"));
  assert.ok(report.inconsistencies.some((entry) => entry.code === "dispatch_environment_without_runner"));
  const pending = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(pending.deployment.workerApproved, true);
  assert.equal(pending.dispatchable, true);
  assert.equal(pending.routed, false);
  assert.equal(pending.ready, false);
  assert.equal(pending.executionSelected, false);
  assert.ok(pending.executionBlockers.includes("missing_e2b_template"));
});

test("a pending environment approved for Render execution is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig(),
    workerApprovedImages: [pendingImageBinding()],
    renderApprovedImages: [pendingImageBinding()],
    renderExecutionImage: pendingDigest,
    renderTemplateId: approvedTemplate.id,
    renderTemplateBuildId: approvedTemplate.buildId,
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "pending_environment_approved"));
  assert.ok(report.inconsistencies.some((entry) => entry.code === "runner_template_unregistered"));
  const pending = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(pending.ready, false);
  assert.equal(pending.executionSelected, false);
  assert.ok(pending.executionBlockers.includes("environment_state_not_approved"));
  assert.ok(pending.executionBlockers.includes("missing_e2b_template"));
});

test("a template_ready environment pre-staged as the disabled execution image is consistent", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment()]),
    workerApprovedImages: [pendingImageBinding()],
    renderApprovedImages: [pendingImageBinding()],
    renderExecutionImage: pendingDigest,
    renderTemplateId: pendingTemplate.id,
    renderTemplateBuildId: pendingTemplate.buildId,
    renderExecutionEnabled: "false",
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.inconsistencies, []);
  assert.equal(report.summary.approved, 1);
  assert.equal(report.summary.templateReady, 1);
  assert.equal(report.summary.runners, 1);
  assert.equal(report.summary.dispatchable, 1);
  assert.equal(report.summary.routed, 1);
  assert.equal(report.summary.selected, 1);
  assert.equal(report.summary.executing, 0);
  assert.equal(report.deployment.render.executionEnvironment, "mathlib-4.27-a3a10");
  assert.equal(report.deployment.render.templateMatchesRegistry, true);

  const staged = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(staged.ready, false);
  assert.equal(staged.dispatchable, true);
  assert.equal(staged.routed, true);
  assert.equal(staged.executionSelected, true);
  assert.equal(staged.executing, false);
  assert.deepEqual(staged.executionBlockers, ["environment_state_not_approved", "runner_execution_disabled"]);
});

test("a template_ready environment executing with execution enabled is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment()]),
    workerApprovedImages: [pendingImageBinding()],
    renderApprovedImages: [pendingImageBinding()],
    renderExecutionImage: pendingDigest,
    renderTemplateId: pendingTemplate.id,
    renderTemplateBuildId: pendingTemplate.buildId,
    renderExecutionEnabled: "true",
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "execution_image_not_approved"));
});

test("a controlled single Run permits a template_ready execution environment", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment()]),
    workerApprovedImages: [pendingImageBinding()],
    renderApprovedImages: [pendingImageBinding()],
    renderExecutionImage: pendingDigest,
    renderTemplateId: pendingTemplate.id,
    renderTemplateBuildId: pendingTemplate.buildId,
    renderExecutionEnabled: "true",
    renderOnlyRunId: "run:first-closure",
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.inconsistencies, []);
  assert.equal(report.deployment.render.controlledSingleRun, true);
  assert.equal(report.deployment.render.onlyRunId, "run:first-closure");
  assert.equal(report.summary.executing, 1);
  const staged = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(staged.executionSelected, true);
  assert.equal(staged.executing, true);
});

test("a Render allowlist with more than one image is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment({ state: "approved" })]),
    workerApprovedImages: [approvedImageBinding()],
    renderApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderExecutionImage: approvedDigest,
    renderTemplateId: approvedTemplate.id,
    renderTemplateBuildId: approvedTemplate.buildId,
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "runner_allowlist_not_single"));
});

test("a Render execution image that differs from the single Render-approved image is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment({ state: "approved" })]),
    workerApprovedImages: [approvedImageBinding()],
    renderApprovedImages: [pendingImageBinding()],
    renderExecutionImage: approvedDigest,
    renderTemplateId: approvedTemplate.id,
    renderTemplateBuildId: approvedTemplate.buildId,
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "runner_execution_image_mismatch"));
});

test("a Worker allowlist that omits the execution image is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment({ state: "approved" })]),
    workerApprovedImages: [pendingImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
    renderTemplateId: approvedTemplate.id,
    renderTemplateBuildId: approvedTemplate.buildId,
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "runner_not_in_worker_allowlist"));
  assert.ok(report.inconsistencies.some((entry) => entry.code === "dispatch_environment_without_runner"));
});

test("a Render template that does not match the registry is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
    renderTemplateId: "cbfjgbsrgtku0c7sliu5:some-other-tag",
    renderTemplateBuildId: "00000000-0000-0000-0000-000000000000",
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "runner_template_id_mismatch"));
  assert.ok(report.inconsistencies.some((entry) => entry.code === "runner_template_build_id_mismatch"));
  const approved = report.environments.find((entry) => entry.profile === "mathlib-4.31-9a948");
  assert.equal(approved.executionSelected, false);
  assert.equal(approved.executing, false);
  assert.ok(approved.executionBlockers.includes("runner_template_mismatch"));
});

test("strict mode exits 0 on the repository configuration and --json emits a report", () => {
  const result = runCli(["--strict", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.reportSchemaVersion, "pw-runner-environment-report-v4");
  assert.deepEqual(report.summary, {
    environments: 2,
    approved: 1,
    templateReady: 0,
    pending: 1,
    runners: 1,
    dispatchable: 1,
    routed: 1,
    selected: 1,
    executing: 0,
    inconsistencies: 0,
  });
  assert.equal(report.ok, true);
});

test("strict mode exits 1 when a pending environment is approved for Render execution", async (t) => {
  const paths = await writeFixture(t, {
    config: fixtureConfig(),
    workerApprovedImages: [pendingImageBinding()],
    renderApprovedImages: [pendingImageBinding()],
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

test("two Runner deployments can serve two approved environments with routed dispatch", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment({ state: "approved" })]),
    workerApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    runners: [
      {
        label: "runner-4.31",
        approvedImages: [approvedImageBinding()],
        executionImage: approvedDigest,
        templateId: approvedTemplate.id,
        templateBuildId: approvedTemplate.buildId,
        executionEnabled: "false",
      },
      {
        label: "runner-4.27",
        approvedImages: [pendingImageBinding()],
        executionImage: pendingDigest,
        templateId: pendingTemplate.id,
        templateBuildId: pendingTemplate.buildId,
        executionEnabled: "true",
      },
    ],
  });

  assert.equal(report.ok, true);
  assert.deepEqual(report.inconsistencies, []);
  assert.equal(report.summary.runners, 2);
  assert.equal(report.summary.dispatchable, 2);
  assert.equal(report.summary.routed, 2);
  assert.equal(report.summary.selected, 2);
  assert.equal(report.summary.executing, 1);
  const four27 = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.deepEqual(four27.deployment.runnerLabels, ["runner-4.27"]);
  assert.equal(four27.executing, true);
  const four31 = report.environments.find((entry) => entry.profile === "mathlib-4.31-9a948");
  assert.deepEqual(four31.deployment.runnerLabels, ["runner-4.31"]);
  assert.equal(four31.executing, false);
  assert.deepEqual(four31.executionBlockers, ["runner_execution_disabled"]);
});

test("a dispatched environment without a Runner deployment is an inconsistency", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment({ state: "approved" })]),
    workerApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    runners: [{
      label: "runner-4.31",
      approvedImages: [approvedImageBinding()],
      executionImage: approvedDigest,
      templateId: approvedTemplate.id,
      templateBuildId: approvedTemplate.buildId,
      executionEnabled: "true",
    }],
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "dispatch_environment_without_runner"));
  const four27 = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(four27.dispatchable, true);
  assert.equal(four27.routed, false);
  assert.ok(four27.executionBlockers.includes("no_runner_deployment"));
});

test("a Runner deployment missing from the Worker allowlist cannot receive Runs", () => {
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment({ state: "approved" })]),
    workerApprovedImages: [approvedImageBinding()],
    runners: [
      {
        label: "runner-4.31",
        approvedImages: [approvedImageBinding()],
        executionImage: approvedDigest,
        templateId: approvedTemplate.id,
        templateBuildId: approvedTemplate.buildId,
        executionEnabled: "true",
      },
      {
        label: "runner-4.27",
        approvedImages: [pendingImageBinding()],
        executionImage: pendingDigest,
        templateId: pendingTemplate.id,
        templateBuildId: pendingTemplate.buildId,
        executionEnabled: "true",
      },
    ],
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "runner_not_in_worker_allowlist"));
  const four27 = report.environments.find((entry) => entry.profile === "mathlib-4.27-a3a10");
  assert.equal(four27.routed, true);
  assert.equal(four27.dispatchable, false);
  assert.ok(four27.executionBlockers.includes("not_in_worker_allowlist"));
});

test("two Runner deployments for the same environment are an inconsistency", () => {
  const runner = {
    approvedImages: [approvedImageBinding()],
    executionImage: approvedDigest,
    templateId: approvedTemplate.id,
    templateBuildId: approvedTemplate.buildId,
    executionEnabled: "true",
  };
  const report = buildRunnerEnvironmentReport({
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding()],
    runners: [
      { label: "runner-a", ...runner },
      { label: "runner-b", ...runner },
    ],
  });

  assert.equal(report.ok, false);
  assert.ok(report.inconsistencies.some((entry) => entry.code === "duplicate_runner_environment"));
  assert.ok(report.inconsistencies.some((entry) => entry.code === "duplicate_runner_execution_image"));
});

test("strict mode validates multiple Render runner configurations", async (t) => {
  const paths = await writeFixture(t, {
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment({ state: "approved" })]),
    workerApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
    renderExecutionEnabled: "false",
  });
  const secondRenderPath = path.join(path.dirname(paths.renderPath), "render-4.27.yaml");
  await writeFile(secondRenderPath, [
    "services:",
    "  - type: web",
    "    name: proofweave-trusted-runner-427",
    "    envVars:",
    "      - key: RUNNER_EXECUTION_ENABLED",
    "        value: \"true\"",
    "      - key: RUNNER_APPROVED_IMAGES_JSON",
    `        value: '${JSON.stringify([pendingImageBinding()]).replaceAll("'", "''")}'`,
    "      - key: PROOFWEAVE_E2B_RUNNER_IMAGE",
    `        value: ${pendingDigest}`,
    "      - key: PROOFWEAVE_E2B_TEMPLATE_ID",
    `        value: ${pendingTemplate.id}`,
    "      - key: PROOFWEAVE_E2B_TEMPLATE_BUILD_ID",
    `        value: ${pendingTemplate.buildId}`,
    "    healthCheckPath: /healthz",
    "",
  ].join("\n"));

  const result = runCli([
    ...fixtureArgs(paths),
    "--render", secondRenderPath,
    "--strict",
    "--json",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.runners, 2);
  assert.equal(report.summary.routed, 2);
  assert.equal(report.summary.executing, 1);
});

test("strict mode exits 1 when a Worker dispatch environment is not the execution environment", async (t) => {
  const paths = await writeFixture(t, {
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding(), pendingImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
  });

  const strict = runCli([...fixtureArgs(paths), "--strict"]);
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /dispatch_environment_without_runner/);
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
  assert.match(strict.stdout, /runner_allowlist_not_single/);
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

test("generator defaults to every approved environment without execution settings", async () => {
  const report = generateRunnerEnvironmentConfig({ config: await readRepositoryConfig() });

  assert.equal(report.schemaVersion, generationSchemaVersion);
  assert.equal(report.registrySchemaVersion, schemaVersion);
  assert.equal(report.surface, "all");
  assert.deepEqual(report.profiles, ["mathlib-4.31-9a948"]);
  assert.equal(report.executionProfile, null);
  assert.deepEqual(report.values, {
    RUNNER_APPROVED_IMAGES_JSON: [approvedImageBinding()],
  });

  const envOutput = formatEnvironmentAssignments(report.values);
  assert.match(envOutput, /^RUNNER_APPROVED_IMAGES_JSON='\[/);
  assert.doesNotMatch(envOutput, /PROOFWEAVE_E2B/);
});

test("generator emits the execution image and template identity from the registry", async () => {
  const report = generateRunnerEnvironmentConfig({
    config: await readRepositoryConfig(),
    executionProfile: "mathlib-4.31-9a948",
    surface: "render",
  });

  assert.equal(report.executionProfile, "mathlib-4.31-9a948");
  assert.deepEqual(report.values, {
    RUNNER_APPROVED_IMAGES_JSON: [approvedImageBinding()],
    PROOFWEAVE_E2B_RUNNER_IMAGE: approvedDigest,
    PROOFWEAVE_E2B_TEMPLATE_ID: approvedTemplate.id,
    PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: approvedTemplate.buildId,
  });

  const values = parseRenderYamlEnvVars(
    await readFile(path.join(root, "deploy", "huggingface-runner", "render.yaml"), "utf8"),
  );
  assert.equal(values.get("PROOFWEAVE_E2B_RUNNER_IMAGE").value, report.values.PROOFWEAVE_E2B_RUNNER_IMAGE);
  assert.equal(values.get("PROOFWEAVE_E2B_TEMPLATE_ID").value, report.values.PROOFWEAVE_E2B_TEMPLATE_ID);
  assert.equal(values.get("PROOFWEAVE_E2B_TEMPLATE_BUILD_ID").value, report.values.PROOFWEAVE_E2B_TEMPLATE_BUILD_ID);
});

test("generator emits only the execution environment unless additional profiles are explicit", () => {
  const report = generateRunnerEnvironmentConfig({
    config: fixtureConfig([approvedEnvironment(), templateReadyEnvironment()]),
    executionProfile: "mathlib-4.27-a3a10",
    surface: "render",
  });

  assert.deepEqual(report.profiles, ["mathlib-4.27-a3a10"]);
  assert.deepEqual(report.values.RUNNER_APPROVED_IMAGES_JSON, [pendingImageBinding()]);
  assert.equal(report.values.PROOFWEAVE_E2B_RUNNER_IMAGE, pendingDigest);
});

test("generator stages a template_ready environment but refuses built_pending_template", async () => {
  const stagingConfig = fixtureConfig([approvedEnvironment(), templateReadyEnvironment()]);
  const report = generateRunnerEnvironmentConfig({
    config: stagingConfig,
    profiles: ["mathlib-4.31-9a948", "mathlib-4.27-a3a10"],
    executionProfile: "mathlib-4.27-a3a10",
    surface: "render",
  });

  assert.deepEqual(report.profiles, ["mathlib-4.31-9a948", "mathlib-4.27-a3a10"]);
  assert.deepEqual(report.values.RUNNER_APPROVED_IMAGES_JSON, [
    approvedImageBinding(),
    pendingImageBinding(),
  ]);
  assert.equal(report.values.PROOFWEAVE_E2B_RUNNER_IMAGE, pendingDigest);
  assert.equal(report.values.PROOFWEAVE_E2B_TEMPLATE_ID, pendingTemplate.id);
  assert.equal(report.values.PROOFWEAVE_E2B_TEMPLATE_BUILD_ID, pendingTemplate.buildId);

  const pendingConfig = fixtureConfig();
  assert.throws(
    () => generateRunnerEnvironmentConfig({ config: pendingConfig, profiles: ["mathlib-4.27-a3a10"] }),
    (error) => error instanceof RunnerEnvironmentGenerationError && /built_pending_template/.test(error.message),
  );
  assert.throws(
    () => generateRunnerEnvironmentConfig({ config: pendingConfig, executionProfile: "mathlib-4.27-a3a10" }),
    /has no E2B template/,
  );
});

test("generator rejects unknown profiles, invalid surfaces, and missing execution profile", async () => {
  const config = await readRepositoryConfig();
  assert.throws(
    () => generateRunnerEnvironmentConfig({ config, profiles: ["mathlib-9.99-missing"] }),
    /Unknown Runner environment profile/,
  );
  assert.throws(
    () => generateRunnerEnvironmentConfig({ config, executionProfile: "mathlib-9.99-missing" }),
    /Unknown Runner execution environment profile/,
  );
  assert.throws(
    () => generateRunnerEnvironmentConfig({ config, surface: "browser" }),
    /--surface must be one of/,
  );
  assert.throws(
    () => generateRunnerEnvironmentConfig({ config, surface: "render" }),
    /requires --execution-profile/,
  );
  assert.throws(
    () => generateRunnerEnvironmentConfig({ config, surface: "worker", executionProfile: "mathlib-4.31-9a948" }),
    /does not emit execution settings/,
  );
});

test("generator CLI emits env and json output and fails closed on bad input", async (t) => {
  const envResult = runCli(["--execution-profile", "mathlib-4.31-9a948", "--surface", "render"], generatorPath);
  assert.equal(envResult.status, 0, envResult.stderr);
  assert.match(envResult.stdout, /RUNNER_APPROVED_IMAGES_JSON='/);
  assert.match(envResult.stdout, new RegExp(`PROOFWEAVE_E2B_TEMPLATE_ID='${approvedTemplate.id.replaceAll(".", "\\.")}'`));

  const jsonResult = runCli(["--execution-profile", "mathlib-4.31-9a948", "--surface", "render", "--format", "json"], generatorPath);
  assert.equal(jsonResult.status, 0, jsonResult.stderr);
  const report = JSON.parse(jsonResult.stdout);
  assert.equal(report.schemaVersion, generationSchemaVersion);
  assert.deepEqual(report.profiles, ["mathlib-4.31-9a948"]);

  const help = runCli(["--help"], generatorPath);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage:/);

  assert.equal(runCli(["--profile", "mathlib-4.27-a3a10"], generatorPath).status, 1);
  assert.equal(runCli(["--unknown"], generatorPath).status, 1);

  const paths = await writeFixture(t, {
    config: fixtureConfig(),
    workerApprovedImages: [approvedImageBinding()],
    renderApprovedImages: [approvedImageBinding()],
    renderExecutionImage: approvedDigest,
  });
  const fixture = runCli(["--config", paths.configPath, "--execution-profile", "mathlib-4.31-9a948"], generatorPath);
  assert.equal(fixture.status, 0, fixture.stderr);
  assert.match(fixture.stdout, /RUNNER_APPROVED_IMAGES_JSON=/);

  const missing = runCli(["--config", path.join(tmpdir(), "pw-missing-registry.json")], generatorPath);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Unable to read/);
});
