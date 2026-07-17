import { normalizeLeanRunnerResult } from "../protocol/lean-runner.mjs";

export const runStates = [
  "queued",
  "preparing",
  "running",
  "cancel_requested",
  "succeeded",
  "failed",
  "timed_out",
  "rejected",
  "cancelled",
];

export const terminalRunStates = [
  "succeeded",
  "failed",
  "timed_out",
  "rejected",
  "cancelled",
];

export class RunStateError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunStateError";
  }
}

/** Create an immutable control-plane projection before it is handed to a queue. */
export function createQueuedRun(input) {
  requireRecord(input, "Run");
  rejectExtraKeys(input, ["id", "attemptId", "idempotencyKey", "requestHash", "artifactBundleHash", "queuedAt"], "Run");
  requireIdentifier(input.id, "Run id");
  requireIdentifier(input.attemptId, "Run attemptId");
  requireIdentifier(input.idempotencyKey, "Run idempotencyKey");
  requireSha256(input.requestHash, "Run requestHash");
  requireSha256(input.artifactBundleHash, "Run artifactBundleHash");
  requireUtcInstant(input.queuedAt, "Run queuedAt");

  return freezeRun({
    id: input.id,
    attemptId: input.attemptId,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    artifactBundleHash: input.artifactBundleHash,
    state: "queued",
    queuedAt: input.queuedAt,
    preparingAt: null,
    startedAt: null,
    cancelRequestedAt: null,
    finishedAt: null,
    runnerResultHash: null,
  });
}

/** Reserve a queued Run for idempotent private workspace preparation. */
export function markRunPreparing(run, preparingAt) {
  const normalized = normalizeRun(run);
  assertState(normalized, "queued", "begin workspace preparation");
  requireUtcInstant(preparingAt, "Run preparingAt");
  assertAtOrAfter(preparingAt, normalized.queuedAt, "Run preparingAt");
  return freezeRun({ ...normalized, state: "preparing", preparingAt });
}

export function markRunStarted(run, startedAt) {
  const normalized = normalizeRun(run);
  assertState(normalized, "preparing", "start");
  requireUtcInstant(startedAt, "Run startedAt");
  assertAtOrAfter(startedAt, normalized.preparingAt, "Run startedAt");
  return freezeRun({ ...normalized, state: "running", startedAt });
}

/**
 * A queued job can be removed immediately. A running container must first
 * acknowledge cancellation with a terminal runner result.
 */
export function requestRunCancellation(run, requestedAt) {
  const normalized = normalizeRun(run);
  if (isTerminalRunState(normalized.state) || normalized.state === "cancel_requested") {
    throw new RunStateError(`Run cannot be cancelled from ${normalized.state}.`);
  }
  requireUtcInstant(requestedAt, "Run cancellation requestedAt");
  assertAtOrAfter(requestedAt, normalized.startedAt ?? normalized.preparingAt ?? normalized.queuedAt, "Run cancellation requestedAt");

  if (["queued", "preparing"].includes(normalized.state)) {
    return freezeRun({ ...normalized, state: "cancelled", cancelRequestedAt: requestedAt, finishedAt: requestedAt });
  }
  return freezeRun({ ...normalized, state: "cancel_requested", cancelRequestedAt: requestedAt });
}

/** Record one immutable runner result; it is evidence, never a receipt. */
export function recordRunnerResult(run, result, resultHash) {
  const normalizedRun = normalizeRun(run);
  if (!["running", "cancel_requested"].includes(normalizedRun.state)) {
    throw new RunStateError(`Run cannot receive a runner result from ${normalizedRun.state}.`);
  }
  requireSha256(resultHash, "Runner result hash");
  const normalizedResult = normalizeLeanRunnerResult(result);
  if (normalizedResult.jobId !== normalizedRun.id || normalizedResult.attemptId !== normalizedRun.attemptId) {
    throw new RunStateError("Runner result does not belong to this Run.");
  }
  if (normalizedResult.requestHash !== normalizedRun.requestHash) {
    throw new RunStateError("Runner result does not cover this Run request hash.");
  }
  assertAtOrAfter(normalizedResult.startedAt, normalizedRun.startedAt, "Runner result startedAt");
  if (normalizedResult.status === "cancelled" && normalizedRun.state !== "cancel_requested") {
    throw new RunStateError("A runner may report cancellation only after a control-plane cancellation request.");
  }

  return freezeRun({
    ...normalizedRun,
    state: normalizedResult.status,
    finishedAt: normalizedResult.finishedAt,
    runnerResultHash: resultHash,
  });
}

export function isTerminalRunState(state) {
  return terminalRunStates.includes(state);
}

function normalizeRun(run) {
  requireRecord(run, "Run");
  rejectExtraKeys(run, ["id", "attemptId", "idempotencyKey", "requestHash", "artifactBundleHash", "state", "queuedAt", "preparingAt", "startedAt", "cancelRequestedAt", "finishedAt", "runnerResultHash"], "Run");
  requireIdentifier(run.id, "Run id");
  requireIdentifier(run.attemptId, "Run attemptId");
  requireIdentifier(run.idempotencyKey, "Run idempotencyKey");
  requireSha256(run.requestHash, "Run requestHash");
  requireSha256(run.artifactBundleHash, "Run artifactBundleHash");
  if (!runStates.includes(run.state)) throw new RunStateError("Run state is invalid.");
  requireUtcInstant(run.queuedAt, "Run queuedAt");
  requireNullableInstant(run.preparingAt, "Run preparingAt");
  requireNullableInstant(run.startedAt, "Run startedAt");
  requireNullableInstant(run.cancelRequestedAt, "Run cancelRequestedAt");
  requireNullableInstant(run.finishedAt, "Run finishedAt");
  requireNullableSha256(run.runnerResultHash, "Run runnerResultHash");

  if (run.state === "queued" && (run.preparingAt || run.startedAt || run.cancelRequestedAt || run.finishedAt || run.runnerResultHash)) {
    throw new RunStateError("A queued Run cannot contain execution state.");
  }
  if (run.state === "preparing" && (!run.preparingAt || run.startedAt || run.cancelRequestedAt || run.finishedAt || run.runnerResultHash)) {
    throw new RunStateError("A preparing Run must reserve a workspace and cannot contain execution state.");
  }
  if (["running", "cancel_requested"].includes(run.state) && (!run.preparingAt || !run.startedAt || run.finishedAt || run.runnerResultHash)) {
    throw new RunStateError("An active Run must have started and cannot contain a terminal result.");
  }
  if (run.state === "cancel_requested" && !run.cancelRequestedAt) {
    throw new RunStateError("A cancellation-requested Run must record its request time.");
  }
  if (isTerminalRunState(run.state) && !run.finishedAt) {
    throw new RunStateError("A terminal Run must record a finish time.");
  }
  if (run.state === "cancelled") {
    if (!run.cancelRequestedAt || (run.startedAt && !run.runnerResultHash) || (!run.startedAt && run.runnerResultHash)) {
      throw new RunStateError("A cancelled Run must retain either a queued cancellation or a runner acknowledgement.");
    }
  } else if (isTerminalRunState(run.state) && !run.runnerResultHash) {
    throw new RunStateError("A runner-completed Run must retain its result hash.");
  }
  if (isTerminalRunState(run.state) && run.state !== "cancelled" && (!run.preparingAt || !run.startedAt)) {
    throw new RunStateError("A runner-completed Run must retain preparation and start times.");
  }

  return freezeRun({ ...run });
}

function freezeRun(run) {
  return Object.freeze({ ...run });
}

function assertState(run, expected, action) {
  if (run.state !== expected) throw new RunStateError(`Run cannot ${action} from ${run.state}.`);
}

function assertAtOrAfter(value, baseline, label) {
  if (Date.parse(value) < Date.parse(baseline)) {
    throw new RunStateError(`${label} cannot precede the prior Run state.`);
  }
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new RunStateError(`${label} contains unsupported field ${extra}.`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RunStateError(`${label} must be an object.`);
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) throw new RunStateError(`${label} must be a non-empty identifier.`);
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new RunStateError(`${label} must be sha256:<hex>.`);
}

function requireNullableSha256(value, label) {
  if (value !== null) requireSha256(value, label);
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new RunStateError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireNullableInstant(value, label) {
  if (value !== null) requireUtcInstant(value, label);
}
