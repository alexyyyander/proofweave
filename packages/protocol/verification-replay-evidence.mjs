import { canonicalJson, sha256Canonical } from "./canonical-json.mjs";
import { normalizeLeanRunnerResult } from "./lean-runner.mjs";

export const verificationReplayEvidenceProtocolVersion = "pw-verification-replay-evidence-v1";

export class VerificationReplayEvidenceProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationReplayEvidenceProtocolError";
  }
}

/**
 * Immutable infrastructure evidence emitted only for a review-assignment
 * fresh replay. It intentionally records the full signed Runner result, but
 * never makes a mathematical or human-review claim by itself.
 */
export async function normalizeVerificationReplayEvidence(evidence) {
  requireRecord(evidence, "Verification replay evidence");
  rejectExtraKeys(evidence, [
    "protocolVersion", "id", "replayId", "assignmentId", "runId",
    "artifactBundleHash", "runnerResultHash", "runnerResult", "recordedAt",
  ]);
  if (evidence.protocolVersion !== verificationReplayEvidenceProtocolVersion) {
    throw new VerificationReplayEvidenceProtocolError("Unsupported verification replay evidence protocol version.");
  }
  for (const [label, value] of Object.entries({
    id: evidence.id,
    replayId: evidence.replayId,
    assignmentId: evidence.assignmentId,
    runId: evidence.runId,
  })) {
    requireIdentifier(value, `Verification replay evidence ${label}`);
  }
  requireSha256(evidence.artifactBundleHash, "Verification replay evidence artifactBundleHash");
  requireSha256(evidence.runnerResultHash, "Verification replay evidence runnerResultHash");
  requireUtcInstant(evidence.recordedAt, "Verification replay evidence recordedAt");

  let runnerResult;
  try {
    runnerResult = normalizeLeanRunnerResult(evidence.runnerResult);
  } catch (cause) {
    throw new VerificationReplayEvidenceProtocolError(
      cause instanceof Error ? `Verification replay evidence runnerResult is invalid: ${cause.message}` : "Verification replay evidence runnerResult is invalid.",
    );
  }
  if (runnerResult.jobId !== evidence.runId || runnerResult.artifacts.manifestHash !== evidence.artifactBundleHash) {
    throw new VerificationReplayEvidenceProtocolError("Verification replay evidence Runner result does not match its Run or Artifact Bundle.");
  }
  if (await sha256Canonical(runnerResult) !== evidence.runnerResultHash) {
    throw new VerificationReplayEvidenceProtocolError("Verification replay evidence runnerResultHash does not match its canonical Runner result.");
  }

  return Object.freeze({
    protocolVersion: verificationReplayEvidenceProtocolVersion,
    id: evidence.id,
    replayId: evidence.replayId,
    assignmentId: evidence.assignmentId,
    runId: evidence.runId,
    artifactBundleHash: evidence.artifactBundleHash,
    runnerResultHash: evidence.runnerResultHash,
    runnerResult,
    recordedAt: evidence.recordedAt,
  });
}

export async function canonicalVerificationReplayEvidence(evidence) {
  return canonicalJson(await normalizeVerificationReplayEvidence(evidence));
}

export async function verificationReplayEvidenceHash(evidence) {
  return sha256Canonical(await normalizeVerificationReplayEvidence(evidence));
}

function rejectExtraKeys(value, allowed) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new VerificationReplayEvidenceProtocolError(`Verification replay evidence contains unsupported field ${extra}.`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VerificationReplayEvidenceProtocolError(`${label} must be an object.`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
    throw new VerificationReplayEvidenceProtocolError(`${label} must be a non-empty identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new VerificationReplayEvidenceProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new VerificationReplayEvidenceProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}
