import { runnerEnvironmentKey } from "../../packages/protocol/lean-runner.mjs";

export const runnerAvailabilitySchemaVersion = "pw-runner-availability-v1";

const imageDigestPattern = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;

export class RunnerAvailabilityConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerAvailabilityConfigurationError";
  }
}

/**
 * Parse the Worker's approved-image allowlist into a public availability
 * description. Malformed configuration fails closed instead of presenting a
 * target as executable.
 */
export function parseRunnerApprovedImagesJson(value) {
  if (value === null || value === undefined || String(value).trim() === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new RunnerAvailabilityConfigurationError("RUNNER_APPROVED_IMAGES_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed) || parsed.length > 8) {
    throw new RunnerAvailabilityConfigurationError("RUNNER_APPROVED_IMAGES_JSON must contain at most 8 approved images.");
  }
  return Object.freeze(parsed.map((image, index) => {
    if (!image || typeof image !== "object" || Array.isArray(image)) {
      throw new RunnerAvailabilityConfigurationError(`RUNNER_APPROVED_IMAGES_JSON[${index}] must be an object.`);
    }
    if (typeof image.imageDigest !== "string" || !imageDigestPattern.test(image.imageDigest)) {
      throw new RunnerAvailabilityConfigurationError(
        `RUNNER_APPROVED_IMAGES_JSON[${index}].imageDigest must be an immutable image reference.`,
      );
    }
    return Object.freeze({
      imageDigest: image.imageDigest,
      leanToolchain: boundedString(image.leanToolchain, `RUNNER_APPROVED_IMAGES_JSON[${index}].leanToolchain`, 240),
      mathlibRevision: boundedString(image.mathlibRevision, `RUNNER_APPROVED_IMAGES_JSON[${index}].mathlibRevision`, 160),
    });
  }));
}

/**
 * Parse the Worker's deployment declaration: which exact Lean environments
 * currently have a Runner process, and whether each one may execute. A null
 * declaration preserves the single-Runner legacy behavior.
 */
export function parseRunnerExecutionEnvironmentsJson(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  let parsed;
  try {
    parsed = JSON.parse(String(value));
  } catch {
    throw new RunnerAvailabilityConfigurationError("RUNNER_EXECUTION_ENVIRONMENTS_JSON must be valid JSON.");
  }
  return normalizeRunnerExecutionEnvironments(parsed);
}

export function normalizeRunnerExecutionEnvironments(parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 8) {
    throw new RunnerAvailabilityConfigurationError("Runner execution environments must contain 1 to 8 entries.");
  }
  const keys = new Set();
  return Object.freeze(parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new RunnerAvailabilityConfigurationError(`Runner execution environments[${index}] must be an object.`);
    }
    const extra = Object.keys(entry).find((key) => !["leanToolchain", "mathlibRevision", "executionEnabled"].includes(key));
    if (extra) {
      throw new RunnerAvailabilityConfigurationError(`Runner execution environments[${index}] contains unsupported field ${extra}.`);
    }
    const leanToolchain = boundedString(entry.leanToolchain, `Runner execution environments[${index}].leanToolchain`, 240);
    const mathlibRevision = boundedString(entry.mathlibRevision, `Runner execution environments[${index}].mathlibRevision`, 160);
    if (typeof entry.executionEnabled !== "boolean") {
      throw new RunnerAvailabilityConfigurationError(`Runner execution environments[${index}].executionEnabled must be a boolean.`);
    }
    const key = runnerEnvironmentKey({ leanToolchain, mathlibRevision });
    if (keys.has(key)) {
      throw new RunnerAvailabilityConfigurationError("Runner execution environments must be unique per Lean and Mathlib pair.");
    }
    keys.add(key);
    return Object.freeze({ leanToolchain, mathlibRevision, executionEnabled: entry.executionEnabled });
  }));
}

export function parseRunnerAvailability({ approvedImagesJson, executionEnvironmentsJson }) {
  return buildRunnerAvailability({
    approvedImages: parseRunnerApprovedImagesJson(approvedImagesJson),
    executionEnvironments: parseRunnerExecutionEnvironmentsJson(executionEnvironmentsJson),
  });
}

export function buildRunnerAvailability({ approvedImages, executionEnvironments = null }) {
  if (!Array.isArray(approvedImages)) {
    throw new RunnerAvailabilityConfigurationError("Runner availability requires an approved image array.");
  }
  const approvedKeys = new Set();
  for (const image of approvedImages) {
    const key = runnerEnvironmentKey(image);
    if (approvedKeys.has(key)) {
      throw new RunnerAvailabilityConfigurationError("Runner approved images must be unique per Lean and Mathlib pair.");
    }
    approvedKeys.add(key);
  }
  const executionByKey = new Map();
  for (const entry of executionEnvironments ?? []) {
    const key = runnerEnvironmentKey(entry);
    if (executionByKey.has(key)) {
      throw new RunnerAvailabilityConfigurationError("Runner execution environments must be unique per Lean and Mathlib pair.");
    }
    if (!approvedKeys.has(key)) {
      throw new RunnerAvailabilityConfigurationError(
        `Runner execution environment ${entry.leanToolchain} + Mathlib ${entry.mathlibRevision} has no approved image.`,
      );
    }
    executionByKey.set(key, entry);
  }
  const environments = approvedImages.map((image) => {
    const execution = executionByKey.get(runnerEnvironmentKey(image)) ?? null;
    return Object.freeze({
      leanToolchain: image.leanToolchain,
      mathlibRevision: image.mathlibRevision,
      imageDigest: image.imageDigest,
      approved: true,
      deployed: execution !== null,
      executionEnabled: execution === null ? null : execution.executionEnabled,
    });
  });
  return Object.freeze({
    schemaVersion: runnerAvailabilitySchemaVersion,
    state: environments.length === 0 ? "unconfigured" : "configured",
    executionDeclared: executionEnvironments !== null,
    environments: Object.freeze(environments),
  });
}

/**
 * Public status for one target's exact Lean and Mathlib pin. The status never
 * implies that a local Agent or a queued Run can execute immediately.
 */
export function runnerEnvironmentAvailability(availability, environment) {
  if (availability?.state === "invalid") {
    return Object.freeze({
      status: "unavailable",
      label: "Hosted Runner configuration invalid",
      detail: "The deployment's Runner availability declaration is invalid; hosted execution cannot be promised.",
    });
  }
  if (!availability || availability.state !== "configured") {
    return Object.freeze({
      status: "unavailable",
      label: "Hosted Runner not configured",
      detail: "No approved hosted Lean Runner image is available for this deployment.",
    });
  }
  const key = runnerEnvironmentKey(environment);
  const entry = availability.environments.find((candidate) => runnerEnvironmentKey(candidate) === key);
  if (!entry) {
    return Object.freeze({
      status: "unavailable",
      label: "No hosted Runner image",
      detail: "This exact Lean and Mathlib pin has no approved hosted Runner image.",
    });
  }
  if (entry.deployed && entry.executionEnabled === true) {
    return Object.freeze({
      status: "executable",
      label: "Hosted Runner ready",
      detail: "A Runner for this exact Lean and Mathlib pin is deployed and execution is enabled.",
    });
  }
  if (entry.deployed) {
    return Object.freeze({
      status: "paused",
      label: "Hosted Runner paused",
      detail: "A Runner for this pin is deployed, but execution is disabled. You can prepare locally; a hosted Run will be rejected until execution is enabled.",
    });
  }
  if (availability.executionDeclared) {
    return Object.freeze({
      status: "unavailable",
      label: "Hosted Runner not deployed",
      detail: "This pin is approved in the registry but no Runner is currently deployed for it.",
    });
  }
  return Object.freeze({
    status: "approved",
    label: "Hosted Runner approved",
    detail: "This pin has an approved Runner image, but the deployment has not declared its live execution status.",
  });
}

export function runnerEnvironmentDispatchDecision({ executionEnvironments, environment }) {
  if (executionEnvironments === null) return Object.freeze({ allowed: true, reason: null });
  const key = runnerEnvironmentKey(environment);
  const entry = executionEnvironments.find((candidate) => runnerEnvironmentKey(candidate) === key);
  if (!entry) return Object.freeze({ allowed: false, reason: "not_deployed" });
  if (entry.executionEnabled !== true) return Object.freeze({ allowed: false, reason: "execution_disabled" });
  return Object.freeze({ allowed: true, reason: null });
}

function boundedString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new RunnerAvailabilityConfigurationError(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}
