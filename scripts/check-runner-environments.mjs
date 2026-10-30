#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parseApprovedImages, parseJsonc } from "./check-target-environments.mjs";
import { runnerEnvironmentKey } from "../packages/protocol/lean-runner.mjs";
import {
  normalizeRunnerExecutionEnvironments,
  parseRunnerExecutionEnvironmentsJson,
} from "../services/lean-runner/runner-availability.mjs";

export const schemaVersion = "pw-runner-environments-v2";
export const reportSchemaVersion = "pw-runner-environment-report-v4";
export const runnerEnvironmentStates = Object.freeze(["approved", "template_ready", "built_pending_template"]);

const imageDigestPattern = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const sourceCommitPattern = /^[a-f0-9]{40}$/;
const profilePattern = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const templateIdPattern = /^[a-z0-9][a-z0-9_-]{2,63}(?::[A-Za-z0-9._-]{1,64})?$/;
const templateBuildIdPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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
 * Runner image and its E2B template. States form a one-way promotion path:
 * `built_pending_template` means the image exists but no E2B template has been
 * built; `template_ready` records the immutable template identity but does not
 * approve execution; `approved` means the image and template were reviewed and
 * are deployable together. Only `approved` environments may execute, and only
 * while the deployment binds their exact template. Source provenance is
 * mandatory until approval so a digest can always be traced back to a reviewed
 * workflow run.
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
    "profile", "imageDigest", "leanToolchain", "mathlibRevision", "state", "sourceRun", "sourceCommit", "template",
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
  const state = environment.state;
  const sourceRun = environment.sourceRun;
  if (sourceRun !== null && (!Number.isSafeInteger(sourceRun) || sourceRun <= 0)) {
    throw new RunnerEnvironmentConfigError(`${label}.sourceRun must be null or a positive workflow run id.`);
  }
  const sourceCommit = environment.sourceCommit;
  if (sourceCommit !== null && (typeof sourceCommit !== "string" || !sourceCommitPattern.test(sourceCommit))) {
    throw new RunnerEnvironmentConfigError(`${label}.sourceCommit must be null or a full 40-character lowercase commit hash.`);
  }
  const template = normalizeTemplate(environment.template, label);
  if (state === "built_pending_template" && template !== null) {
    throw new RunnerEnvironmentConfigError(
      `${label} is built_pending_template and must not declare an E2B template; use template_ready once it exists.`,
    );
  }
  if (state !== "built_pending_template" && template === null) {
    throw new RunnerEnvironmentConfigError(
      `${label} is ${state} and must record its E2B template id, buildId, and sourceImageDigest.`,
    );
  }
  if ((state === "built_pending_template" || state === "template_ready") && (sourceRun === null || sourceCommit === null)) {
    throw new RunnerEnvironmentConfigError(`${label} is ${state} and must record sourceRun and sourceCommit provenance.`);
  }
  if (template !== null && template.sourceImageDigest !== imageDigest) {
    throw new RunnerEnvironmentConfigError(`${label}.template.sourceImageDigest must equal ${label}.imageDigest.`);
  }
  return { profile, imageDigest, leanToolchain, mathlibRevision, state, sourceRun, sourceCommit, template };
}

function normalizeTemplate(template, label) {
  if (template === undefined || template === null) return null;
  if (typeof template !== "object" || Array.isArray(template)) {
    throw new RunnerEnvironmentConfigError(`${label}.template must be an object or null.`);
  }
  const allowedFields = ["id", "buildId", "sourceImageDigest"];
  const extraFields = Object.keys(template).filter((key) => !allowedFields.includes(key));
  if (extraFields.length > 0) {
    throw new RunnerEnvironmentConfigError(`${label}.template contains unsupported field ${extraFields[0]}.`);
  }
  const id = boundedString(template.id, `${label}.template.id`, 128);
  if (!templateIdPattern.test(id)) {
    throw new RunnerEnvironmentConfigError(
      `${label}.template.id must be a bounded E2B template reference with an optional immutable version tag.`,
    );
  }
  const buildId = boundedString(template.buildId, `${label}.template.buildId`, 128);
  if (!templateBuildIdPattern.test(buildId)) {
    throw new RunnerEnvironmentConfigError(`${label}.template.buildId must be a bounded E2B template build id.`);
  }
  const sourceImageDigest = boundedString(template.sourceImageDigest, `${label}.template.sourceImageDigest`, 512);
  if (!imageDigestPattern.test(sourceImageDigest)) {
    throw new RunnerEnvironmentConfigError(
      `${label}.template.sourceImageDigest must be an immutable image reference pinned by @sha256:<64 lowercase hex>.`,
    );
  }
  return Object.freeze({ id, buildId, sourceImageDigest });
}

/**
 * Minimal, dependency-free reader for the `services` list in a Render
 * blueprint. It extracts each service's literal `key`/`value` env pairs and
 * treats `sync: false` secrets as having no local value. This is a read-only
 * inspection of deploy configuration, not a deployment.
 */
export function parseRenderServices(text) {
  const services = [];
  let current = null;
  let envVarsIndent = null;
  let currentVar = null;
  const flushVar = () => {
    if (currentVar && currentVar.key) {
      current.envVars.set(currentVar.key, Object.freeze({ value: currentVar.value, sync: currentVar.sync }));
    }
    currentVar = null;
  };
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/\t/g, "  ");
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    const serviceMatch = line.match(/^\s*-\s+type:\s*(\S+)\s*$/);
    if (serviceMatch) {
      flushVar();
      current = { type: unquoteYamlScalar(serviceMatch[1]), name: null, envVars: new Map() };
      services.push(current);
      envVarsIndent = null;
      continue;
    }
    if (!current) continue;
    if (indent === 0 && !/^services:\s*$/.test(line.trim())) {
      flushVar();
      current = null;
      envVarsIndent = null;
      continue;
    }
    if (/^envVars:\s*$/.test(line.trim())) {
      flushVar();
      envVarsIndent = indent;
      continue;
    }
    if (envVarsIndent !== null && indent <= envVarsIndent && !/^\s*-/.test(line)) {
      flushVar();
      envVarsIndent = null;
    }
    if (envVarsIndent !== null) {
      const keyMatch = line.match(/^\s*-\s+key:\s*(.*)$/);
      if (keyMatch) {
        flushVar();
        currentVar = { key: unquoteYamlScalar(keyMatch[1]), value: null, sync: null };
        continue;
      }
      if (!currentVar) continue;
      const propertyMatch = line.match(/^\s*([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
      if (!propertyMatch) continue;
      const [, property, rawValue] = propertyMatch;
      if (property === "value") currentVar.value = unquoteYamlScalar(rawValue);
      if (property === "sync") currentVar.sync = unquoteYamlScalar(rawValue);
      continue;
    }
    const nameMatch = line.match(/^\s*name:\s*(.*)$/);
    if (nameMatch) current.name = unquoteYamlScalar(nameMatch[1]);
  }
  flushVar();
  return Object.freeze(services.map((service) => Object.freeze({
    type: service.type,
    name: service.name,
    envVars: service.envVars,
  })));
}

/** Backward-compatible single-service view used by tests and callers. */
export function parseRenderYamlEnvVars(text) {
  return parseRenderServices(text)[0]?.envVars ?? new Map();
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
  runners = null,
  renderApprovedImages = null,
  renderExecutionImage = null,
  renderTemplateId = null,
  renderTemplateBuildId = null,
  renderExecutionEnabled = null,
  renderOnlyRunId = null,
  executionEnvironments = null,
} = {}) {
  const environments = validateRunnerEnvironmentsConfig(config);
  let normalizedExecutionEnvironments;
  try {
    normalizedExecutionEnvironments = executionEnvironments === null
      ? null
      : normalizeRunnerExecutionEnvironments(executionEnvironments);
  } catch (error) {
    throw new RunnerEnvironmentConfigError(error instanceof Error ? error.message : "Runner execution environments are invalid.");
  }
  const worker = indexApprovedImages(workerApprovedImages, "Worker");
  const environmentsByDigest = new Map(environments.map((environment) => [environment.imageDigest, environment]));
  const environmentsByKey = new Map(environments.map((environment) => [runnerEnvironmentKey(environment), environment]));
  const inconsistencies = [];
  const addInconsistency = (code, message, profile = null) => {
    if (!inconsistencies.some((entry) => entry.code === code && entry.message === message)) {
      inconsistencies.push({ code, message, profile });
    }
  };

  const runnerInputs = runners ?? [{
    label: "render",
    approvedImages: renderApprovedImages,
    executionImage: renderExecutionImage,
    templateId: renderTemplateId,
    templateBuildId: renderTemplateBuildId,
    executionEnabled: renderExecutionEnabled,
    onlyRunId: renderOnlyRunId,
  }];
  const normalizedRunners = normalizeRunnerInputs(runnerInputs, environmentsByDigest, addInconsistency);

  for (const digest of worker.duplicates) {
    addInconsistency(
      "duplicate_approved_image",
      `Worker RUNNER_APPROVED_IMAGES_JSON repeats ${shortDigest(digest)}.`,
    );
  }
  for (const [digest, image] of worker.byDigest) {
    const environment = environmentsByDigest.get(digest);
    if (!environment) {
      addInconsistency(
        "unregistered_approved_image",
        `Worker approves ${shortDigest(digest)}, which is not declared in config/runner-environments.json.`,
      );
      continue;
    }
    if (
      image.leanToolchain !== environment.leanToolchain ||
      image.mathlibRevision !== environment.mathlibRevision
    ) {
      addInconsistency(
        "approved_image_environment_mismatch",
        `Worker binds ${shortDigest(digest)} to Lean ${image.leanToolchain} + Mathlib ${short(image.mathlibRevision)},`
          + ` but config declares Lean ${environment.leanToolchain} + Mathlib ${short(environment.mathlibRevision)}.`,
        environment.profile,
      );
    }
    if (environment.state === "built_pending_template") {
      addInconsistency(
        "pending_environment_approved",
        `Pending environment ${environment.profile} must not appear in the Worker dispatch allowlist before its E2B template exists.`,
        environment.profile,
      );
    }
    if (!normalizedRunners.some((runner) => runner.executionImage === digest)) {
      addInconsistency(
        "dispatch_environment_without_runner",
        `Worker dispatches ${environment.profile}, but no Runner deployment serves ${shortDigest(digest)}; its Runs would stay queued.`,
        environment.profile,
      );
    }
  }
  for (const runner of normalizedRunners) {
    if (!worker.byDigest.has(runner.executionImage)) {
      addInconsistency(
        "runner_not_in_worker_allowlist",
        `Runner ${runner.label} executes ${shortDigest(runner.executionImage)}, but the Worker dispatch allowlist does not contain it;`
          + " no Runs can reach it.",
        runner.environment?.profile ?? null,
      );
    }
  }

  if (normalizedExecutionEnvironments === null) {
    if (normalizedRunners.length > 1) {
      addInconsistency(
        "execution_declaration_missing",
        "Multiple Runner deployments require RUNNER_EXECUTION_ENVIRONMENTS_JSON so dispatch can distinguish deployed and executing environments.",
      );
    }
  } else {
    const declaredKeys = new Set();
    for (const declaration of normalizedExecutionEnvironments) {
      const key = runnerEnvironmentKey(declaration);
      declaredKeys.add(key);
      const environment = environmentsByKey.get(key);
      if (!environment) {
        addInconsistency(
          "execution_environment_unregistered",
          `RUNNER_EXECUTION_ENVIRONMENTS_JSON declares ${declaration.leanToolchain} + Mathlib ${short(declaration.mathlibRevision)},`
            + " which is not registered in config/runner-environments.json.",
        );
        continue;
      }
      if (
        environment.state === "built_pending_template" ||
        (environment.state === "template_ready" && declaration.executionEnabled)
      ) {
        addInconsistency(
          "execution_environment_not_approved",
          `RUNNER_EXECUTION_ENVIRONMENTS_JSON declares ${environment.profile} while its registry state is ${environment.state}.`,
          environment.profile,
        );
      }
      const runner = normalizedRunners.find((candidate) => candidate.environment?.profile === environment.profile);
      if (!runner) {
        addInconsistency(
          "execution_environment_not_deployed",
          `RUNNER_EXECUTION_ENVIRONMENTS_JSON declares ${environment.profile}, but no Runner deployment serves it.`,
          environment.profile,
        );
        continue;
      }
      if ((runner.executionEnabled === "true") !== declaration.executionEnabled) {
        addInconsistency(
          "execution_environment_flag_mismatch",
          `RUNNER_EXECUTION_ENVIRONMENTS_JSON says ${environment.profile} executionEnabled=${declaration.executionEnabled},`
            + ` but Runner ${runner.label} declares ${runner.executionEnabled}.`,
          environment.profile,
        );
      }
    }
    for (const runner of normalizedRunners) {
      if (!runner.environment) continue;
      if (!declaredKeys.has(runnerEnvironmentKey(runner.environment))) {
        addInconsistency(
          "runner_missing_execution_declaration",
          `Runner ${runner.label} serves ${runner.environment.profile}, but RUNNER_EXECUTION_ENVIRONMENTS_JSON does not declare it.`,
          runner.environment.profile,
        );
      }
    }
  }

  const rows = environments.map((environment) => {
    const workerImage = worker.byDigest.get(environment.imageDigest) ?? null;
    const workerApproved = Boolean(
      workerImage &&
      workerImage.leanToolchain === environment.leanToolchain &&
      workerImage.mathlibRevision === environment.mathlibRevision,
    );
    const environmentRunners = normalizedRunners.filter((runner) => runner.executionImage === environment.imageDigest);
    const runnerLabels = environmentRunners.map((runner) => runner.label);
    const templateRegistered = environment.template !== null
      && environment.template.sourceImageDigest === environment.imageDigest;
    const ready = environment.state === "approved" && templateRegistered;
    const dispatchable = workerApproved;
    const routed = environmentRunners.length > 0;
    const executionSelected = environmentRunners.some((runner) => runner.executionSelected);
    const executing = environmentRunners.some((runner) => runner.executing);

    const executionBlockers = [];
    if (environment.state !== "approved") executionBlockers.push("environment_state_not_approved");
    if (!templateRegistered) executionBlockers.push("missing_e2b_template");
    if (!workerApproved) executionBlockers.push("not_in_worker_allowlist");
    if (!routed) executionBlockers.push("no_runner_deployment");
    if (routed && !executionSelected && environmentRunners.some((runner) => !runner.templateMatchesRegistry)) {
      executionBlockers.push("runner_template_mismatch");
    }
    if (routed && executionSelected && !executing && environmentRunners.every((runner) => runner.executionEnabled !== "true")) {
      executionBlockers.push("runner_execution_disabled");
    }

    return {
      profile: environment.profile,
      state: environment.state,
      imageDigest: environment.imageDigest,
      leanToolchain: environment.leanToolchain,
      mathlibRevision: environment.mathlibRevision,
      sourceRun: environment.sourceRun,
      sourceCommit: environment.sourceCommit,
      template: environment.template,
      deployment: {
        workerApproved,
        runnerLabels,
        executionSelected,
        executing,
      },
      ready,
      dispatchable,
      routed,
      executionSelected,
      executing,
      executionBlockers,
    };
  });

  const runnerReports = normalizedRunners.map((runner) => ({
    label: runner.label,
    approvedImages: runner.approvedImages.map(pickImageBinding),
    executionImage: runner.executionImage,
    executionEnvironment: runner.environment?.profile ?? null,
    templateId: runner.templateId,
    templateBuildId: runner.templateBuildId,
    templateMatchesRegistry: runner.templateMatchesRegistry,
    executionEnabled: runner.executionEnabled,
    controlledSingleRun: runner.controlledSingleRun,
    onlyRunId: runner.onlyRunId,
  }));

  const summary = {
    environments: rows.length,
    approved: rows.filter((row) => row.state === "approved").length,
    templateReady: rows.filter((row) => row.state === "template_ready").length,
    pending: rows.filter((row) => row.state === "built_pending_template").length,
    runners: runnerReports.length,
    dispatchable: rows.filter((row) => row.dispatchable).length,
    routed: rows.filter((row) => row.routed).length,
    selected: rows.filter((row) => row.executionSelected).length,
    executing: rows.filter((row) => row.executing).length,
    inconsistencies: inconsistencies.length,
  };

  return {
    reportSchemaVersion,
    configSchemaVersion: schemaVersion,
    deployment: {
      worker: {
        approvedImages: workerApprovedImages.map(pickImageBinding),
        executionEnvironments: normalizedExecutionEnvironments,
        executionDeclared: normalizedExecutionEnvironments !== null,
      },
      runners: runnerReports,
      render: runnerReports[0],
    },
    environments: rows,
    inconsistencies,
    summary,
    ok: inconsistencies.length === 0,
  };
}

function normalizeRunnerInputs(inputs, environmentsByDigest, addInconsistency) {
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 8) {
    throw new RunnerEnvironmentConfigError("Runner deployments must contain 1 to 8 render configurations.");
  }
  const labels = new Set();
  const environmentOwners = new Map();
  const imageOwners = new Map();
  return Object.freeze(inputs.map((input, index) => {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new RunnerEnvironmentConfigError(`runners[${index}] must be an object.`);
    }
    const label = boundedString(input.label ?? `runner-${index + 1}`, `runners[${index}].label`, 64);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(label)) {
      throw new RunnerEnvironmentConfigError(`runners[${index}].label must be a bounded runner label.`);
    }
    if (labels.has(label)) {
      throw new RunnerEnvironmentConfigError(`Runner deployment labels must be unique (duplicate ${label}).`);
    }
    labels.add(label);
    if (typeof input.executionImage !== "string" || !imageDigestPattern.test(input.executionImage)) {
      throw new RunnerEnvironmentConfigError(
        `Runner ${label} execution image must be an immutable image reference pinned by @sha256:<64 lowercase hex>.`,
      );
    }
    const executionImage = input.executionImage;
    const approvedImages = input.approvedImages;
    const approvedIndex = indexApprovedImages(approvedImages, `Runner ${label}`);
    if (input.templateId !== null && input.templateId !== undefined
      && (typeof input.templateId !== "string" || input.templateId.trim() === "")) {
      throw new RunnerEnvironmentConfigError(`Runner ${label} E2B template id must be a non-empty string when configured.`);
    }
    if (input.templateBuildId !== null && input.templateBuildId !== undefined
      && (typeof input.templateBuildId !== "string" || input.templateBuildId.trim() === "")) {
      throw new RunnerEnvironmentConfigError(`Runner ${label} E2B template build id must be a non-empty string when configured.`);
    }
    if (input.executionEnabled !== null && input.executionEnabled !== undefined
      && !["true", "false"].includes(input.executionEnabled)) {
      throw new RunnerEnvironmentConfigError(`Runner ${label} RUNNER_EXECUTION_ENABLED must be true or false when configured.`);
    }
    if (input.onlyRunId !== null && input.onlyRunId !== undefined
      && (typeof input.onlyRunId !== "string" || input.onlyRunId.trim() === "")) {
      throw new RunnerEnvironmentConfigError(`Runner ${label} RUNNER_ONLY_RUN_ID must be a non-empty identifier when configured.`);
    }
    const templateId = input.templateId ?? null;
    const templateBuildId = input.templateBuildId ?? null;
    const executionEnabled = input.executionEnabled ?? null;
    const onlyRunId = input.onlyRunId ?? null;
    const environment = environmentsByDigest.get(executionImage) ?? null;
    const templateMatchesRegistry = Boolean(
      environment?.template &&
      templateId === environment.template.id &&
      templateBuildId === environment.template.buildId,
    );
    const controlledSingleRun = onlyRunId !== null;
    const executionSelected = Boolean(
      environment &&
      approvedIndex.byDigest.has(executionImage) &&
      templateMatchesRegistry,
    );
    const executionPermitted = executionSelected && (environment.state === "approved" || controlledSingleRun);
    const executing = executionPermitted && executionEnabled === "true";

    for (const digest of approvedIndex.duplicates) {
      addInconsistency(
        "duplicate_approved_image",
        `Runner ${label} RUNNER_APPROVED_IMAGES_JSON repeats ${shortDigest(digest)}.`,
        environment?.profile ?? null,
      );
    }
    for (const [digest, image] of approvedIndex.byDigest) {
      const approvedEnvironment = environmentsByDigest.get(digest);
      if (!approvedEnvironment) {
        addInconsistency(
          "unregistered_approved_image",
          `Runner ${label} approves ${shortDigest(digest)}, which is not declared in config/runner-environments.json.`,
        );
        continue;
      }
      if (
        image.leanToolchain !== approvedEnvironment.leanToolchain ||
        image.mathlibRevision !== approvedEnvironment.mathlibRevision
      ) {
        addInconsistency(
          "approved_image_environment_mismatch",
          `Runner ${label} binds ${shortDigest(digest)} to Lean ${image.leanToolchain} + Mathlib ${short(image.mathlibRevision)},`
            + ` but config declares Lean ${approvedEnvironment.leanToolchain} + Mathlib ${short(approvedEnvironment.mathlibRevision)}.`,
          approvedEnvironment.profile,
        );
      }
    }
    if (approvedImages.length !== 1) {
      addInconsistency(
        "runner_allowlist_not_single",
        `Runner ${label} RUNNER_APPROVED_IMAGES_JSON must contain exactly one execution image, but declares ${approvedImages.length}.`,
        environment?.profile ?? null,
      );
    } else if ([...approvedIndex.byDigest.keys()][0] !== executionImage) {
      addInconsistency(
        "runner_execution_image_mismatch",
        `Runner ${label} approves ${shortDigest([...approvedIndex.byDigest.keys()][0])}, but its execution image is ${shortDigest(executionImage)}.`,
        environment?.profile ?? null,
      );
    }
    if (!environment) {
      addInconsistency(
        "runner_unknown_execution_image",
        `Runner ${label} execution image ${shortDigest(executionImage)} is not declared in config/runner-environments.json.`,
      );
    } else {
      if (environment.template) {
        if (templateId !== environment.template.id) {
          addInconsistency(
            "runner_template_id_mismatch",
            `Runner ${label} PROOFWEAVE_E2B_TEMPLATE_ID is ${templateId ?? "unset"},`
              + ` but ${environment.profile} records ${environment.template.id}.`,
            environment.profile,
          );
        }
        if (templateBuildId !== environment.template.buildId) {
          addInconsistency(
            "runner_template_build_id_mismatch",
            `Runner ${label} PROOFWEAVE_E2B_TEMPLATE_BUILD_ID is ${templateBuildId ?? "unset"},`
              + ` but ${environment.profile} records ${environment.template.buildId}.`,
            environment.profile,
          );
        }
      } else if (templateId !== null || templateBuildId !== null) {
        addInconsistency(
          "runner_template_unregistered",
          `Runner ${label} configures an E2B template but ${environment.profile} has no registered template.`,
          environment.profile,
        );
      }
      if (environment.state === "built_pending_template") {
        addInconsistency(
          "pending_environment_approved",
          `Runner ${label} executes pending environment ${environment.profile} before its E2B template exists.`,
          environment.profile,
        );
      }
      if (environment.state === "template_ready" && executionEnabled === "true" && !controlledSingleRun) {
        addInconsistency(
          "execution_image_not_approved",
          `Runner ${label} executes template_ready environment ${environment.profile} with RUNNER_EXECUTION_ENABLED=true;`
            + " promote it to approved or set RUNNER_ONLY_RUN_ID for a controlled single-Run window.",
          environment.profile,
        );
      }
      if (environmentOwners.has(environment.profile)) {
        addInconsistency(
          "duplicate_runner_environment",
          `Runner ${label} duplicates runner ${environmentOwners.get(environment.profile)} for ${environment.profile}.`,
          environment.profile,
        );
      } else {
        environmentOwners.set(environment.profile, label);
      }
    }
    if (imageOwners.has(executionImage)) {
      addInconsistency(
        "duplicate_runner_execution_image",
        `Runner ${label} reuses the execution image of runner ${imageOwners.get(executionImage)}.`,
        environment?.profile ?? null,
      );
    } else {
      imageOwners.set(executionImage, label);
    }

    return Object.freeze({
      label,
      approvedImages,
      executionImage,
      templateId,
      templateBuildId,
      executionEnabled,
      onlyRunId,
      environment,
      templateMatchesRegistry,
      controlledSingleRun,
      executionSelected,
      executionPermitted,
      executing,
    });
  }));
}
export async function buildRunnerEnvironmentReportFromFiles({
  configPath = defaultConfigPath,
  wranglerPath = defaultWranglerPath,
  renderPaths = null,
  renderPath = defaultRenderPath,
} = {}) {
  const paths = renderPaths ?? [renderPath];
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new RunnerEnvironmentConfigError("At least one Render configuration path is required.");
  }
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const wrangler = parseJsonc(await readFile(wranglerPath, "utf8"));
  const workerApprovedImages = parseApprovedImages(wrangler?.vars?.RUNNER_APPROVED_IMAGES_JSON);
  const executionEnvironments = parseRunnerExecutionEnvironmentsJson(
    wrangler?.vars?.RUNNER_EXECUTION_ENVIRONMENTS_JSON ?? null,
  );
  const runners = [];
  for (const path of paths) {
    const services = parseRenderServices(await readFile(path, "utf8"));
    const renderServices = services.length > 0 ? services : [Object.freeze({ name: null, envVars: new Map() })];
    for (const service of renderServices) {
      const envVars = service.envVars;
      runners.push({
        label: service.name
          ? sanitizeRunnerLabel(service.name) ?? runnerLabelFromPath(path)
          : runnerLabelFromPath(path),
        approvedImages: parseApprovedImages(
          requireRenderEnvValue(envVars, "RUNNER_APPROVED_IMAGES_JSON"),
        ),
        executionImage: requireRenderEnvValue(envVars, "PROOFWEAVE_E2B_RUNNER_IMAGE"),
        templateId: optionalRenderEnvValue(envVars, "PROOFWEAVE_E2B_TEMPLATE_ID"),
        templateBuildId: optionalRenderEnvValue(envVars, "PROOFWEAVE_E2B_TEMPLATE_BUILD_ID"),
        executionEnabled: optionalRenderEnvValue(envVars, "RUNNER_EXECUTION_ENABLED"),
        onlyRunId: optionalRenderEnvValue(envVars, "RUNNER_ONLY_RUN_ID"),
      });
    }
  }
  return buildRunnerEnvironmentReport({ config, workerApprovedImages, runners, executionEnvironments });
}

function runnerLabelFromPath(path) {
  const name = basename(String(path)).replace(/\.ya?ml$/i, "");
  return name || "render";
}

function sanitizeRunnerLabel(value) {
  const label = String(value)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return label || null;
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
  const runners = report.deployment.runners ?? (report.deployment.render ? [report.deployment.render] : []);
  const lines = [
    `Runner environment registry check (${report.configSchemaVersion})`,
    `Worker dispatch images: ${report.deployment.worker.approvedImages.length}`
      + ` | execution declarations: ${report.deployment.worker.executionDeclared
        ? report.deployment.worker.executionEnvironments.length
        : "not declared"}`
      + ` | Runner deployments: ${runners.length}`,
  ];
  for (const runner of runners) {
    lines.push(
      `- runner ${runner.label}`
        + ` | image ${shortDigest(runner.executionImage)}`
        + ` | environment: ${runner.executionEnvironment ?? "unregistered"}`
        + ` | E2B template: ${runner.templateId ?? "not configured"}`
        + ` | RUNNER_EXECUTION_ENABLED: ${runner.executionEnabled ?? "unset"}`
        + ` | controlled single run: ${yesNo(runner.controlledSingleRun)}`,
    );
  }
  lines.push("");
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
      `  template: ${environment.template
        ? `${environment.template.id} | build ${environment.template.buildId}`
        : "none"}`,
    );
    lines.push(
      `  worker allowlist: ${yesNo(environment.deployment.workerApproved)}`
        + ` | runner deployments: ${environment.deployment.runnerLabels.length > 0
          ? environment.deployment.runnerLabels.join(", ")
          : "none"}`
        + ` | template registered: ${yesNo(environment.template !== null
          && environment.template.sourceImageDigest === environment.imageDigest)}`,
    );
    lines.push(
      `  ready: ${yesNo(environment.ready)}`
        + ` | dispatchable: ${yesNo(environment.dispatchable)}`
        + ` | routed: ${yesNo(environment.routed)}`
        + ` | execution selected: ${yesNo(environment.executionSelected)}`
        + ` | executing: ${yesNo(environment.executing)}`,
    );
    if (environment.executionBlockers.length > 0) {
      lines.push(`  execution blockers: ${environment.executionBlockers.join(", ")}`);
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
      + ` | template_ready ${report.summary.templateReady}`
      + ` | pending ${report.summary.pending}`
      + ` | runners ${report.summary.runners}`
      + ` | dispatchable ${report.summary.dispatchable}`
      + ` | routed ${report.summary.routed}`
      + ` | selected ${report.summary.selected}`
      + ` | executing ${report.summary.executing}`
      + ` | inconsistencies ${report.summary.inconsistencies}`,
  );
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const renderPaths = readFlags("--render");
  const report = await buildRunnerEnvironmentReportFromFiles({
    configPath: readFlag("--config") ?? defaultConfigPath,
    wranglerPath: readFlag("--wrangler") ?? defaultWranglerPath,
    ...(renderPaths.length === 0 ? {} : { renderPaths }),
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

function readFlags(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== name) continue;
    const value = process.argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a path`);
    values.push(value);
    index += 1;
  }
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
