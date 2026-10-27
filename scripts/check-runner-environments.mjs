#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseApprovedImages, parseJsonc } from "./check-target-environments.mjs";

export const schemaVersion = "pw-runner-environments-v1";
export const reportSchemaVersion = "pw-runner-environment-report-v1";
export const runnerEnvironmentStates = Object.freeze(["approved", "built_pending_template"]);

const imageDigestPattern = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const sourceCommitPattern = /^[a-f0-9]{40}$/;
const profilePattern = /^[a-z0-9][a-z0-9._-]{1,63}$/;

const defaultConfigPath = fileURLToPath(new URL("../config/runner-environments.json", import.meta.url));
const defaultWranglerPath = fileURLToPath(new URL("../wrangler.cloudflare.jsonc", import.meta.url));
const defaultRenderPath = fileURLToPath(new URL("../deploy/huggingface-runner/render.yaml", import.meta.url));

export class RunnerEnvironmentConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerEnvironmentConfigError";
  }
}

/**
 * The environment registry is a read-only description of every reviewed Lean
 * Runner image. `approved` means the image is deployable and used by the
 * current execution surface; `built_pending_template` means the image exists
 * but has no E2B template yet and therefore must not be executable. Source
 * provenance is mandatory for pending builds so a digest can always be traced
 * back to a reviewed workflow run.
 */
export function validateRunnerEnvironmentsConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new RunnerEnvironmentConfigError("Runner environment configuration must be an object.");
  }
  const extraKeys = Object.keys(config).filter((key) => !["schemaVersion", "environments"].includes(key));
  if (extraKeys.length > 0) {
    throw new RunnerEnvironmentConfigError(`Runner environment configuration contains unsupported field ${extraKeys[0]}.`);
  }
  if (config.schemaVersion !== schemaVersion) {
    throw new RunnerEnvironmentConfigError(`Runner environment configuration schemaVersion must be ${schemaVersion}.`);
  }
  if (!Array.isArray(config.environments) || config.environments.length === 0) {
    throw new RunnerEnvironmentConfigError("Runner environment configuration must declare at least one environment.");
  }
  const digests = new Set();
  const profiles = new Set();
  const environmentKeys = new Set();
  return Object.freeze(config.environments.map((environment, index) => {
    const normalized = normalizeEnvironment(environment, index);
    if (digests.has(normalized.imageDigest)) {
      throw new RunnerEnvironmentConfigError(
        `Runner environment image digests must be unique (duplicate ${shortDigest(normalized.imageDigest)}).`,
      );
    }
    if (profiles.has(normalized.profile)) {
      throw new RunnerEnvironmentConfigError(`Runner environment profiles must be unique (duplicate ${normalized.profile}).`);
    }
    const environmentKey = `${normalized.leanToolchain}\u0000${normalized.mathlibRevision}`;
    if (environmentKeys.has(environmentKey)) {
      throw new RunnerEnvironmentConfigError("Only one Runner environment may serve a Lean and Mathlib pair.");
    }
    digests.add(normalized.imageDigest);
    profiles.add(normalized.profile);
    environmentKeys.add(environmentKey);
    return Object.freeze(normalized);
  }));
}

function normalizeEnvironment(environment, index) {
  const label = `environments[${index}]`;
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new RunnerEnvironmentConfigError(`${label} must be an object.`);
  }
  const allowedFields = [
    "profile", "imageDigest", "leanToolchain", "mathlibRevision", "state", "sourceRun", "sourceCommit",
  ];
  const extraFields = Object.keys(environment).filter((key) => !allowedFields.includes(key));
  if (extraFields.length > 0) {
    throw new RunnerEnvironmentConfigError(`${label} contains unsupported field ${extraFields[0]}.`);
  }
  const profile = boundedString(environment.profile, `${label}.profile`, 64);
  if (!profilePattern.test(profile)) {
    throw new RunnerEnvironmentConfigError(`${label}.profile must be a bounded lowercase profile name.`);
  }
  const imageDigest = boundedString(environment.imageDigest, `${label}.imageDigest`, 512);
  if (!imageDigestPattern.test(imageDigest)) {
    throw new RunnerEnvironmentConfigError(
      `${label}.imageDigest must be an immutable image reference pinned by @sha256:<64 lowercase hex>.`,
    );
  }
  const leanToolchain = boundedString(environment.leanToolchain, `${label}.leanToolchain`, 240);
  const mathlibRevision = boundedString(environment.mathlibRevision, `${label}.mathlibRevision`, 160);
  if (!runnerEnvironmentStates.includes(environment.state)) {
    throw new RunnerEnvironmentConfigError(`${label}.state must be one of ${runnerEnvironmentStates.join(", ")}.`);
  }
  const sourceRun = environment.sourceRun;
  if (sourceRun !== null && (!Number.isSafeInteger(sourceRun) || sourceRun <= 0)) {
    throw new RunnerEnvironmentConfigError(`${label}.sourceRun must be null or a positive workflow run id.`);
  }
  const sourceCommit = environment.sourceCommit;
  if (sourceCommit !== null && (typeof sourceCommit !== "string" || !sourceCommitPattern.test(sourceCommit))) {
    throw new RunnerEnvironmentConfigError(`${label}.sourceCommit must be null or a full 40-character lowercase commit hash.`);
  }
  if (environment.state === "built_pending_template" && (sourceRun === null || sourceCommit === null)) {
    throw new RunnerEnvironmentConfigError(`${label} is built_pending_template and must record sourceRun and sourceCommit provenance.`);
  }
  return { profile, imageDigest, leanToolchain, mathlibRevision, state: environment.state, sourceRun, sourceCommit };
}

/**
 * Minimal, dependency-free reader for the single `envVars` list in the
 * Render blueprint. It extracts literal `key`/`value` pairs and treats
 * `sync: false` secrets as having no local value. This is a read-only
 * inspection of deploy configuration, not a deployment.
 */
export function parseRenderYamlEnvVars(text) {
  const values = new Map();
  let current = null;
  let inEnvVars = false;
  let envVarsIndent = -1;
  const flush = () => {
    if (current && current.key) values.set(current.key, Object.freeze({ value: current.value, sync: current.sync }));
    current = null;
  };
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ");
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (!inEnvVars) {
      if (/^envVars:\s*$/.test(line.trim())) {
        inEnvVars = true;
        envVarsIndent = indent;
      }
      continue;
    }
    if (indent <= envVarsIndent && !/^\s*-/.test(line)) {
      flush();
      inEnvVars = false;
      continue;
    }
    const keyMatch = line.match(/^\s*-\s+key:\s*(.*)$/);
    if (keyMatch) {
      flush();
      current = { key: unquoteYamlScalar(keyMatch[1]), value: null, sync: null };
      continue;
    }
    if (!current) continue;
    const propertyMatch = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!propertyMatch) continue;
    const [, property, rawValue] = propertyMatch;
    if (property === "value") current.value = unquoteYamlScalar(rawValue);
    if (property === "sync") current.sync = unquoteYamlScalar(rawValue);
  }
  flush();
  return values;
}

function unquoteYamlScalar(rawValue) {
  const value = String(rawValue).trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return JSON.parse(value);
  }
  return value;
}

export function buildRunnerEnvironmentReport({
  config,
  workerApprovedImages,
  renderApprovedImages,
  renderExecutionImage,
  renderTemplateId = null,
  renderTemplateBuildId = null,
  renderExecutionEnabled = null,
} = {}) {
  const environments = validateRunnerEnvironmentsConfig(config);
  if (typeof renderExecutionImage !== "string" || !imageDigestPattern.test(renderExecutionImage)) {
    throw new RunnerEnvironmentConfigError(
      "render.yaml PROOFWEAVE_E2B_RUNNER_IMAGE must be an immutable image reference pinned by @sha256:<64 lowercase hex>.",
    );
  }
  if (renderTemplateId !== null && (typeof renderTemplateId !== "string" || renderTemplateId.trim() === "")) {
    throw new RunnerEnvironmentConfigError("render.yaml PROOFWEAVE_E2B_TEMPLATE_ID must be a non-empty string when configured.");
  }
  const worker = indexApprovedImages(workerApprovedImages, "Worker");
  const render = indexApprovedImages(renderApprovedImages, "Render");
  const environmentsByDigest = new Map(environments.map((environment) => [environment.imageDigest, environment]));
  const inconsistencies = [];
  const addInconsistency = (code, message, profile = null) => {
    if (!inconsistencies.some((entry) => entry.code === code && entry.message === message)) {
      inconsistencies.push({ code, message, profile });
    }
  };

  for (const [label, index] of [["Worker", worker], ["Render", render]]) {
    for (const digest of index.duplicates) {
      addInconsistency(
        "duplicate_approved_image",
        `${label} RUNNER_APPROVED_IMAGES_JSON repeats ${shortDigest(digest)}.`,
      );
    }
    for (const [digest, image] of index.byDigest) {
      const environment = environmentsByDigest.get(digest);
      if (!environment) {
        addInconsistency(
          "unregistered_approved_image",
          `${label} approves ${shortDigest(digest)}, which is not declared in config/runner-environments.json.`,
        );
        continue;
      }
      if (
        image.leanToolchain !== environment.leanToolchain ||
        image.mathlibRevision !== environment.mathlibRevision
      ) {
        addInconsistency(
          "approved_image_environment_mismatch",
          `${label} binds ${shortDigest(digest)} to Lean ${image.leanToolchain} + Mathlib ${short(image.mathlibRevision)},`
            + ` but config declares Lean ${environment.leanToolchain} + Mathlib ${short(environment.mathlibRevision)}.`,
          environment.profile,
        );
      }
    }
  }
  if (!environmentsByDigest.has(renderExecutionImage)) {
    addInconsistency(
      "unknown_execution_image",
      `Render execution image ${shortDigest(renderExecutionImage)} is not declared in config/runner-environments.json.`,
    );
  }

  const templateConfigured = typeof renderTemplateId === "string" && renderTemplateId.trim() !== "";
  const rows = environments.map((environment) => {
    const workerImage = worker.byDigest.get(environment.imageDigest) ?? null;
    const renderImage = render.byDigest.get(environment.imageDigest) ?? null;
    const workerApproved = Boolean(
      workerImage &&
      workerImage.leanToolchain === environment.leanToolchain &&
      workerImage.mathlibRevision === environment.mathlibRevision,
    );
    const renderApproved = Boolean(
      renderImage &&
      renderImage.leanToolchain === environment.leanToolchain &&
      renderImage.mathlibRevision === environment.mathlibRevision,
    );
    const executionImageMatch = renderExecutionImage === environment.imageDigest;
    const e2bTemplateBound = templateConfigured && executionImageMatch;

    const blockers = [];
    if (environment.state === "built_pending_template") blockers.push("environment_state_pending");
    if (!e2bTemplateBound) blockers.push("missing_e2b_template");
    if (!workerApproved) blockers.push("missing_worker_approval");
    if (!renderApproved) blockers.push("missing_render_approval");
    if (!executionImageMatch) blockers.push("execution_image_not_switched");

    const admissible = environment.state === "approved" && blockers.length === 0;
    if (environment.state === "approved" && !admissible) {
      addInconsistency(
        "approved_environment_not_admissible",
        `Approved environment ${environment.profile} is not deployable: ${blockers.join(", ")}.`,
        environment.profile,
      );
    }
    if (environment.state === "built_pending_template" && (renderApproved || executionImageMatch)) {
      addInconsistency(
        "pending_environment_approved",
        `Pending environment ${environment.profile} must not be approved for Render execution before its E2B template exists.`,
        environment.profile,
      );
    }

    return {
      profile: environment.profile,
      state: environment.state,
      imageDigest: environment.imageDigest,
      leanToolchain: environment.leanToolchain,
      mathlibRevision: environment.mathlibRevision,
      sourceRun: environment.sourceRun,
      sourceCommit: environment.sourceCommit,
      deployment: {
        workerApproved,
        renderApproved,
        executionImage: executionImageMatch,
        e2bTemplateConfigured: templateConfigured,
        e2bTemplateBound,
      },
      admissible,
      blocked: !admissible,
      blockers,
    };
  });

  const summary = {
    environments: rows.length,
    approved: rows.filter((row) => row.state === "approved").length,
    pending: rows.filter((row) => row.state === "built_pending_template").length,
    admissible: rows.filter((row) => row.admissible).length,
    blocked: rows.filter((row) => !row.admissible).length,
    inconsistencies: inconsistencies.length,
  };

  return {
    reportSchemaVersion,
    configSchemaVersion: schemaVersion,
    deployment: {
      worker: { approvedImages: workerApprovedImages.map(pickImageBinding) },
      render: {
        approvedImages: renderApprovedImages.map(pickImageBinding),
        executionImage: renderExecutionImage,
        templateId: renderTemplateId,
        templateBuildId: renderTemplateBuildId,
        executionEnabled: renderExecutionEnabled,
      },
    },
    environments: rows,
    inconsistencies,
    summary,
    ok: inconsistencies.length === 0,
  };
}

export async function buildRunnerEnvironmentReportFromFiles({
  configPath = defaultConfigPath,
  wranglerPath = defaultWranglerPath,
  renderPath = defaultRenderPath,
} = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const wrangler = parseJsonc(await readFile(wranglerPath, "utf8"));
  const workerApprovedImages = parseApprovedImages(wrangler?.vars?.RUNNER_APPROVED_IMAGES_JSON);
  const renderEnvVars = parseRenderYamlEnvVars(await readFile(renderPath, "utf8"));
  const renderApprovedImages = parseApprovedImages(
    requireRenderEnvValue(renderEnvVars, "RUNNER_APPROVED_IMAGES_JSON"),
  );
  const renderExecutionImage = requireRenderEnvValue(renderEnvVars, "PROOFWEAVE_E2B_RUNNER_IMAGE");
  return buildRunnerEnvironmentReport({
    config,
    workerApprovedImages,
    renderApprovedImages,
    renderExecutionImage,
    renderTemplateId: optionalRenderEnvValue(renderEnvVars, "PROOFWEAVE_E2B_TEMPLATE_ID"),
    renderTemplateBuildId: optionalRenderEnvValue(renderEnvVars, "PROOFWEAVE_E2B_TEMPLATE_BUILD_ID"),
    renderExecutionEnabled: optionalRenderEnvValue(renderEnvVars, "RUNNER_EXECUTION_ENABLED"),
  });
}

function indexApprovedImages(images, label) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new RunnerEnvironmentConfigError(`${label} approved images must be a non-empty array.`);
  }
  const byDigest = new Map();
  const duplicates = [];
  for (const image of images) {
    if (!image || typeof image !== "object" || Array.isArray(image)) {
      throw new RunnerEnvironmentConfigError(`${label} approved images must be objects.`);
    }
    if (typeof image.imageDigest !== "string" || !imageDigestPattern.test(image.imageDigest)) {
      throw new RunnerEnvironmentConfigError(
        `${label} approved image digest must be an immutable image reference pinned by @sha256:<64 lowercase hex>.`,
      );
    }
    const leanToolchain = boundedString(image.leanToolchain, `${label} approved image Lean toolchain`, 240);
    const mathlibRevision = boundedString(image.mathlibRevision, `${label} approved image Mathlib revision`, 160);
    if (byDigest.has(image.imageDigest)) {
      duplicates.push(image.imageDigest);
      continue;
    }
    byDigest.set(image.imageDigest, Object.freeze({
      imageDigest: image.imageDigest,
      leanToolchain,
      mathlibRevision,
    }));
  }
  return { byDigest, duplicates: [...new Set(duplicates)] };
}

function requireRenderEnvValue(values, key) {
  const entry = values.get(key);
  if (!entry || typeof entry.value !== "string" || entry.value.trim() === "") {
    throw new RunnerEnvironmentConfigError(`render.yaml must define a literal value for ${key}.`);
  }
  return entry.value;
}

function optionalRenderEnvValue(values, key) {
  const entry = values.get(key);
  if (!entry || typeof entry.value !== "string" || entry.value.trim() === "") return null;
  return entry.value;
}

function pickImageBinding(image) {
  return {
    imageDigest: image.imageDigest,
    leanToolchain: image.leanToolchain,
    mathlibRevision: image.mathlibRevision,
  };
}

function boundedString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new RunnerEnvironmentConfigError(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}

function shortDigest(value) {
  const marker = "@sha256:";
  const index = typeof value === "string" ? value.indexOf(marker) : -1;
  if (index === -1) return String(value);
  return `${value.slice(0, index)}${marker}${value.slice(index + marker.length, index + marker.length + 12)}…`;
}

function short(value) {
  return typeof value === "string" && value.length > 12 ? `${value.slice(0, 12)}…` : String(value);
}

function yesNo(value) {
  return value ? "yes" : "no";
}

export function formatHumanReport(report) {
  const lines = [
    `Runner environment registry check (${report.configSchemaVersion})`,
    `Worker approved images: ${report.deployment.worker.approvedImages.length}`
      + ` | Render approved images: ${report.deployment.render.approvedImages.length}`,
    `Render execution image: ${shortDigest(report.deployment.render.executionImage)}`
      + ` | E2B template: ${report.deployment.render.templateId ?? "not configured"}`
      + ` | RUNNER_EXECUTION_ENABLED: ${report.deployment.render.executionEnabled ?? "unset"}`,
    "",
  ];
  for (const environment of report.environments) {
    const source = `source run ${environment.sourceRun ?? "n/a"}`
      + ` | commit ${environment.sourceCommit ? `${environment.sourceCommit.slice(0, 12)}…` : "n/a"}`;
    lines.push(
      `- [${environment.state}] ${environment.profile}`
        + ` | Lean ${environment.leanToolchain}`
        + ` | Mathlib ${short(environment.mathlibRevision)}`
        + ` | ${shortDigest(environment.imageDigest)}`
        + ` | ${source}`,
    );
    lines.push(
      `  worker allowlist: ${yesNo(environment.deployment.workerApproved)}`
        + ` | render allowlist: ${yesNo(environment.deployment.renderApproved)}`
        + ` | execution image: ${yesNo(environment.deployment.executionImage)}`
        + ` | E2B template bound: ${yesNo(environment.deployment.e2bTemplateBound)}`
        + ` | admissible: ${yesNo(environment.admissible)}`,
    );
    if (environment.blockers.length > 0) {
      lines.push(`  blockers: ${environment.blockers.join(", ")}`);
    }
  }
  if (report.inconsistencies.length === 0) {
    lines.push("", "Inconsistencies: none");
  } else {
    lines.push("", `Configuration inconsistencies: ${report.inconsistencies.length}`);
    for (const inconsistency of report.inconsistencies) {
      lines.push(`- [${inconsistency.code}] ${inconsistency.message}`);
    }
    lines.push("", "Rerun with --strict to fail on configuration inconsistencies.");
  }
  lines.push(
    "",
    `Summary: ${report.summary.environments} environments`
      + ` | approved ${report.summary.approved}`
      + ` | pending ${report.summary.pending}`
      + ` | admissible ${report.summary.admissible}`
      + ` | blocked ${report.summary.blocked}`
      + ` | inconsistencies ${report.summary.inconsistencies}`,
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const report = await buildRunnerEnvironmentReportFromFiles({
    configPath: readFlag("--config") ?? defaultConfigPath,
    wranglerPath: readFlag("--wrangler") ?? defaultWranglerPath,
    renderPath: readFlag("--render") ?? defaultRenderPath,
  });
  if (args.has("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatHumanReport(report));
  }
  if (args.has("--strict") && report.inconsistencies.length > 0) {
    process.exitCode = 1;
  }
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
