import { canonicalJson, canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";
import {
  artifactBundleHash,
  artifactBundleV2ProtocolVersion,
  normalizeArtifactBundle,
  verifyArtifactBundleAgentSignature,
} from "./artifact-bundle.mjs";

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
  requireSha256(request.bundle.contentHash, "bundle contentHash");
  requireSha256(request.bundle.manifestHash, "bundle manifestHash");
  if (request.bundle.contentHash !== request.bundle.manifestHash) {
    throw new LeanRunnerProtocolError("bundle contentHash and manifestHash must match for canonical bundle.json.");
  }
  requireBundleKey(request.bundle.objectKey, request.bundle.contentHash);
  const entryCommand = normalizeCommand(request.bundle.entryCommand);

  requireRecord(request.environment, "environment");
  requireSha256Digest(request.environment.imageDigest, "environment imageDigest");
  requireString(request.environment.leanToolchain, "environment leanToolchain", 240);
  requireString(request.environment.mathlibRevision, "environment mathlibRevision", 160);
  if (request.environment.network !== "disabled") {
    throw new LeanRunnerProtocolError("Lean runner network must be disabled.");
  }

  const limits = normalizeLeanRunnerLimits(request.limits);

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

/** Validate deployment-owned Runner limits before they can enter a request. */
export function normalizeLeanRunnerLimits(value) {
  requireRecord(value, "limits");
  const limits = {
    cpuSeconds: boundedInteger(value.cpuSeconds, "limits.cpuSeconds", 1, 900),
    wallSeconds: boundedInteger(value.wallSeconds, "limits.wallSeconds", 1, 1_200),
    memoryMiB: boundedInteger(value.memoryMiB, "limits.memoryMiB", 128, 16_384),
    diskMiB: boundedInteger(value.diskMiB, "limits.diskMiB", 128, 16_384),
    outputBytes: boundedInteger(value.outputBytes, "limits.outputBytes", 1_024, 20_000_000),
  };
  if (limits.wallSeconds < limits.cpuSeconds) {
    throw new LeanRunnerProtocolError("wallSeconds cannot be lower than cpuSeconds.");
  }
  return Object.freeze(limits);
}

/**
 * Bind a runner job to a complete artifact manifest. Callers cannot substitute
 * a different command, Lean environment, or policy after the bundle hash has
 * been fixed.
 */
export async function createLeanRunnerRequest({
  jobId,
  idempotencyKey,
  artifactBundle,
  imageDigest,
  limits,
}) {
  const normalizedBundle = normalizeArtifactBundle(artifactBundle);
  if (normalizedBundle.protocolVersion !== artifactBundleV2ProtocolVersion) {
    throw new LeanRunnerProtocolError("Lean Runner requests require pw-artifact-bundle-v2 executable workspace evidence.");
  }
  if (!await verifyArtifactBundleAgentSignature(normalizedBundle)) {
    throw new LeanRunnerProtocolError("Runner requests require a valid Artifact Bundle Agent signature.");
  }
  const manifestHash = await artifactBundleHash(normalizedBundle);
  const hashHex = manifestHash.slice("sha256:".length);

  return normalizeLeanRunnerRequest({
    protocolVersion: leanRunnerProtocolVersion,
    jobId,
    idempotencyKey,
    attemptId: normalizedBundle.attemptId,
    bundle: {
      objectKey: `bundles/sha256/${hashHex}/bundle.json`,
      contentHash: manifestHash,
      manifestHash,
      entryCommand: normalizedBundle.entryCommand,
    },
    environment: {
      imageDigest,
      leanToolchain: normalizedBundle.environment.leanToolchain,
      mathlibRevision: normalizedBundle.environment.mathlibRevision,
      network: "disabled",
    },
    limits,
    policy: normalizedBundle.policy,
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
  requireIdentifier(result.runnerKeyId, "result runnerKeyId");
  requireBase64Url(result.runnerSignature, 64, "result runnerSignature");
  if (!["succeeded", "failed", "timed_out", "rejected", "cancelled"].includes(result.status)) {
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
  if (result.status === "cancelled" && result.kernelStatus !== "not_run") {
    throw new LeanRunnerProtocolError("A cancelled runner result cannot claim kernel acceptance.");
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
    runnerKeyId: result.runnerKeyId,
    runnerSignature: result.runnerSignature,
    status: result.status,
    exitCode: result.exitCode,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    kernelStatus: result.kernelStatus,
    checks: Object.freeze(checks),
    artifacts: Object.freeze({ ...result.artifacts }),
  });
}

/** The runner signs all result evidence except its own detached signature. */
export function runnerResultSigningPayload(result) {
  const normalized = normalizeLeanRunnerResult(result);
  return {
    protocolVersion: normalized.protocolVersion,
    jobId: normalized.jobId,
    attemptId: normalized.attemptId,
    requestHash: normalized.requestHash,
    runnerKeyId: normalized.runnerKeyId,
    status: normalized.status,
    exitCode: normalized.exitCode,
    startedAt: normalized.startedAt,
    finishedAt: normalized.finishedAt,
    kernelStatus: normalized.kernelStatus,
    checks: normalized.checks,
    artifacts: normalized.artifacts,
  };
}

/**
 * Sign normalized Runner evidence with an operator-held Ed25519 key. The
 * private key belongs only in the trusted Runner Worker; Containers and queue
 * messages receive neither it nor a caller-supplied signature.
 */
export async function signLeanRunnerResult({ result, runnerPrivateKey }) {
  requireRecord(result, "Unsigned runner result");
  if (Object.hasOwn(result, "runnerSignature")) {
    throw new LeanRunnerProtocolError("Unsigned runner result must not include runnerSignature.");
  }
  const unsigned = normalizeLeanRunnerResult({
    ...result,
    runnerSignature: emptyEd25519Signature,
  });
  let signature;
  try {
    signature = toBase64Url(await crypto.subtle.sign(
      "Ed25519",
      runnerPrivateKey,
      canonicalUtf8(runnerResultSigningPayload(unsigned)),
    ));
  } catch {
    throw new LeanRunnerProtocolError("runnerPrivateKey must be an Ed25519 signing key.");
  }
  return normalizeLeanRunnerResult({ ...unsigned, runnerSignature: signature });
}

/** Verify a result against a key selected from the control-plane allowlist. */
export async function verifyLeanRunnerResultSignature({ result, runnerPublicKey }) {
  const normalized = normalizeLeanRunnerResult(result);
  requireBase64Url(runnerPublicKey, 32, "runner public key");
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(runnerPublicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    fromBase64Url(normalized.runnerSignature),
    canonicalUtf8(runnerResultSigningPayload(normalized)),
  );
}

export function canonicalLeanRunnerRequest(request) {
  return canonicalJson(normalizeLeanRunnerRequest(request));
}

function normalizeCommand(command) {
  if (!Array.isArray(command) || command.some((part) => typeof part !== "string" || part.length === 0 || part.length > 512)) {
    throw new LeanRunnerProtocolError("bundle.entryCommand must be a bounded argument array.");
  }
  if (command[0] !== "lake" || command[1] !== "env" || command[2] !== "lean") {
    throw new LeanRunnerProtocolError("bundle.entryCommand must begin with lake env lean.");
  }
  if (command.some((part) => /[;|&><`$\n\r]/.test(part))) {
    throw new LeanRunnerProtocolError("bundle.entryCommand must not contain shell syntax.");
  }
  if (command.length !== 4) {
    throw new LeanRunnerProtocolError("bundle.entryCommand must be exactly lake env lean plus one source file.");
  }
  requireLeanSourcePath(command[3], "bundle.entryCommand source file");
  return [...command];
}

function requireLeanSourcePath(value, label) {
  if (typeof value !== "string" || !value.endsWith(".lean") || value.length > 1_024 || value.startsWith("/") || value.includes("\\") || value.includes("\0")) {
    throw new LeanRunnerProtocolError(`${label} must be a relative .lean source path.`);
  }
  const segments = value.slice(0, -".lean".length).split("/");
  if (segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_']*$/.test(segment))) {
    throw new LeanRunnerProtocolError(`${label} contains an unsafe Lean module path.`);
  }
}

function requireBundleKey(value, hash) {
  requireString(value, "bundle objectKey", 1_024);
  const match = /^bundles\/sha256\/([a-f0-9]{64})\/bundle\.json$/.exec(value);
  if (!match || match[1] !== hash.slice("sha256:".length)) {
    throw new LeanRunnerProtocolError("bundle objectKey must embed the matching canonical bundle hash.");
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

function requireBase64Url(value, length, label) {
  requireString(value, label, 256);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new LeanRunnerProtocolError(`${label} must be unpadded base64url.`);
  }
  if (fromBase64Url(value).byteLength !== length) {
    throw new LeanRunnerProtocolError(`${label} has an invalid length.`);
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

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64Url(value) {
  const binary = String.fromCharCode(...new Uint8Array(value));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

const emptyEd25519Signature = "A".repeat(86);
