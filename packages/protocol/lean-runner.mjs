import { canonicalJson, sha256Canonical } from "./canonical-json.mjs";

export const leanRunnerProtocolVersion = "pw-lean-runner-v1";

export class LeanRunnerProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "LeanRunnerProtocolError";
  }
}

/**
 * Validate the control-plane request accepted by an isolated Lean runner. The
 * request intentionally contains a content-addressed bundle reference only;
 * it never embeds source code, credentials, or arbitrary shell text.
 */
export function normalizeLeanRunnerRequest(request) {
  requireRecord(request, "Runner request");
  if (request.protocolVersion !== leanRunnerProtocolVersion) {
    throw new LeanRunnerProtocolError("Unsupported Lean runner protocol version.");
  }
  requireIdentifier(request.jobId, "jobId");
  requireIdentifier(request.idempotencyKey, "idempotencyKey");
  requireIdentifier(request.attemptId, "attemptId");
  requireRecord(request.bundle, "bundle");
  requireBundleKey(request.bundle.objectKey);
  requireSha256(request.bundle.contentHash, "bundle contentHash");
  requireSha256(request.bundle.manifestHash, "bundle manifestHash");
  const entryCommand = normalizeCommand(request.bundle.entryCommand);

  requireRecord(request.environment, "environment");
  requireSha256Digest(request.environment.imageDigest, "environment imageDigest");
  requireString(request.environment.leanToolchain, "environment leanToolchain", 240);
  requireString(request.environment.mathlibRevision, "environment mathlibRevision", 160);
  if (request.environment.network !== "disabled") {
    throw new LeanRunnerProtocolError("Lean runner network must be disabled.");
  }

  requireRecord(request.limits, "limits");
  const limits = {
    cpuSeconds: boundedInteger(request.limits.cpuSeconds, "limits.cpuSeconds", 1, 900),
    wallSeconds: boundedInteger(request.limits.wallSeconds, "limits.wallSeconds", 1, 1_200),
    memoryMiB: boundedInteger(request.limits.memoryMiB, "limits.memoryMiB", 128, 16_384),
    diskMiB: boundedInteger(request.limits.diskMiB, "limits.diskMiB", 128, 16_384),
    outputBytes: boundedInteger(request.limits.outputBytes, "limits.outputBytes", 1_024, 20_000_000),
  };
  if (limits.wallSeconds < limits.cpuSeconds) {
    throw new LeanRunnerProtocolError("wallSeconds cannot be lower than cpuSeconds.");
  }

  requireRecord(request.policy, "policy");
  if (request.policy.requireNoSorry !== true) {
    throw new LeanRunnerProtocolError("Runner policy must require a sorry audit.");
  }
  if (!Array.isArray(request.policy.allowedAxioms) || !request.policy.allowedAxioms.every(isQualifiedName)) {
    throw new LeanRunnerProtocolError("policy.allowedAxioms must be an array of qualified names.");
  }

  return Object.freeze({
    protocolVersion: leanRunnerProtocolVersion,
    jobId: request.jobId,
    idempotencyKey: request.idempotencyKey,
    attemptId: request.attemptId,
    bundle: Object.freeze({
      objectKey: request.bundle.objectKey,
      contentHash: request.bundle.contentHash,
      manifestHash: request.bundle.manifestHash,
      entryCommand: Object.freeze(entryCommand),
    }),
    environment: Object.freeze({
      imageDigest: request.environment.imageDigest,
      leanToolchain: request.environment.leanToolchain,
      mathlibRevision: request.environment.mathlibRevision,
      network: "disabled",
    }),
    limits: Object.freeze(limits),
    policy: Object.freeze({
      requireNoSorry: true,
      allowedAxioms: Object.freeze([...request.policy.allowedAxioms].sort()),
    }),
  });
}

export async function leanRunnerRequestHash(request) {
  return sha256Canonical(normalizeLeanRunnerRequest(request));
}

/** Validate a signed runner result without upgrading it into a receipt. */
export function normalizeLeanRunnerResult(result) {
  requireRecord(result, "Runner result");
  if (result.protocolVersion !== leanRunnerProtocolVersion) {
    throw new LeanRunnerProtocolError("Unsupported Lean runner result version.");
  }
  requireIdentifier(result.jobId, "result jobId");
  requireIdentifier(result.attemptId, "result attemptId");
  requireSha256(result.requestHash, "result requestHash");
  if (!["succeeded", "failed", "timed_out", "rejected"].includes(result.status)) {
    throw new LeanRunnerProtocolError("Runner result status is invalid.");
  }
  if (!Number.isInteger(result.exitCode) || result.exitCode < 0 || result.exitCode > 255) {
    throw new LeanRunnerProtocolError("Runner result exitCode is invalid.");
  }
  requireIsoInstant(result.startedAt, "result startedAt");
  requireIsoInstant(result.finishedAt, "result finishedAt");
  if (Date.parse(result.finishedAt) < Date.parse(result.startedAt)) {
    throw new LeanRunnerProtocolError("Runner result finishedAt precedes startedAt.");
  }
  requireRecord(result.checks, "result checks");
  const checks = {
    network: requireCheck(result.checks.network, "network"),
    noSorry: requireCheck(result.checks.noSorry, "noSorry"),
    allowedAxioms: requireCheck(result.checks.allowedAxioms, "allowedAxioms"),
    leanBuild: requireCheck(result.checks.leanBuild, "leanBuild"),
  };
  if (!["accepted", "rejected", "not_run"].includes(result.kernelStatus)) {
    throw new LeanRunnerProtocolError("Runner result kernelStatus is invalid.");
  }
  requireRecord(result.artifacts, "result artifacts");
  requireSha256(result.artifacts.manifestHash, "result artifacts.manifestHash");
  requireSha256(result.artifacts.stdoutHash, "result artifacts.stdoutHash");
  requireSha256(result.artifacts.stderrHash, "result artifacts.stderrHash");

  if (result.status === "succeeded") {
    if (result.exitCode !== 0 || result.kernelStatus !== "accepted" || Object.values(checks).some((value) => value !== "passed")) {
      throw new LeanRunnerProtocolError("A succeeded runner result requires clean accepted checks.");
    }
  }
  if (checks.network !== "passed") {
    throw new LeanRunnerProtocolError("Every runner result must evidence disabled network execution.");
  }
  if (result.status !== "succeeded" && result.kernelStatus === "accepted" && checks.leanBuild !== "passed") {
    throw new LeanRunnerProtocolError("A kernel-accepted result requires a passing Lean build.");
  }

  return Object.freeze({
    protocolVersion: leanRunnerProtocolVersion,
    jobId: result.jobId,
    attemptId: result.attemptId,
    requestHash: result.requestHash,
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    kernelStatus: result.kernelStatus,
    checks: Object.freeze(checks),
    artifacts: Object.freeze({ ...result.artifacts }),
  });
}

export function canonicalLeanRunnerRequest(request) {
  return canonicalJson(normalizeLeanRunnerRequest(request));
}

function normalizeCommand(command) {
  if (!Array.isArray(command) || command.length < 3 || command.length > 32 || command.some((part) => typeof part !== "string" || part.length === 0 || part.length > 512)) {
    throw new LeanRunnerProtocolError("bundle.entryCommand must be a bounded argument array.");
  }
  if (command[0] !== "lake" || command[1] !== "env" || command[2] !== "lean") {
    throw new LeanRunnerProtocolError("bundle.entryCommand must begin with lake env lean.");
  }
  if (command.some((part) => /[;|&><`$\n\r]/.test(part))) {
    throw new LeanRunnerProtocolError("bundle.entryCommand must not contain shell syntax.");
  }
  return [...command];
}

function requireBundleKey(value) {
  requireString(value, "bundle objectKey", 1_024);
  if (!value.startsWith("bundles/sha256/") || value.includes("..") || value.includes("\\")) {
    throw new LeanRunnerProtocolError("bundle objectKey is not a safe content-addressed R2 key.");
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new LeanRunnerProtocolError(`${label} must be a sha256:<hex> value.`);
  }
}

function requireSha256Digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.replace(/^.*@/, ""))) {
    throw new LeanRunnerProtocolError(`${label} must include a pinned sha256 image digest.`);
  }
}

function boundedInteger(value, label, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new LeanRunnerProtocolError(`${label} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function requireCheck(value, label) {
  if (!["passed", "failed", "not_run"].includes(value)) {
    throw new LeanRunnerProtocolError(`result checks.${label} is invalid.`);
  }
  return value;
}

function requireIdentifier(value, label) {
  requireString(value, label, 240);
}

function requireIsoInstant(value, label) {
  requireString(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new LeanRunnerProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LeanRunnerProtocolError(`${label} must be an object.`);
  }
}

function requireString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new LeanRunnerProtocolError(`${label} must be a non-empty string.`);
  }
}

function isQualifiedName(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*$/.test(value);
}
