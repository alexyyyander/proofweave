import {
  leanRunnerRequestHash,
  normalizeLeanRunnerRequest,
} from "../../packages/protocol/lean-runner.mjs";

export const runnerQueueProtocolVersion = "pw-runner-queue-v1";

export class RunnerQueueProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerQueueProtocolError";
  }
}

/**
 * Build the only payload a control plane may put on a runner queue. It carries
 * a validated, source-free runner request and its canonical hash; it never
 * carries source bytes, environment secrets, or a shell command.
 */
export async function createRunnerQueueMessage({ runId, request, enqueuedAt }) {
  requireIdentifier(runId, "runId");
  requireUtcInstant(enqueuedAt, "enqueuedAt");
  const normalizedRequest = normalizeLeanRunnerRequest(request);
  if (normalizedRequest.jobId !== runId) {
    throw new RunnerQueueProtocolError("Queue runId must equal the runner request jobId.");
  }

  return Object.freeze({
    protocolVersion: runnerQueueProtocolVersion,
    runId,
    requestHash: await leanRunnerRequestHash(normalizedRequest),
    request: normalizedRequest,
    enqueuedAt,
  });
}

/** Re-derive the request hash rather than trusting a queue-provider payload. */
export async function normalizeRunnerQueueMessage(message) {
  requireRecord(message, "Runner queue message");
  rejectExtraKeys(message, ["protocolVersion", "runId", "requestHash", "request", "enqueuedAt"], "Runner queue message");
  if (message.protocolVersion !== runnerQueueProtocolVersion) {
    throw new RunnerQueueProtocolError("Unsupported RunnerQueue protocol version.");
  }
  requireSha256(message.requestHash, "Runner queue requestHash");
  const normalized = await createRunnerQueueMessage(message);
  if (normalized.requestHash !== message.requestHash) {
    throw new RunnerQueueProtocolError("Runner queue requestHash does not match the canonical request.");
  }
  return normalized;
}

/**
 * Provider-neutral queue interface.
 *
 * A production adapter must implement these asynchronous operations with
 * at-least-once delivery. It must authenticate the control-plane publisher
 * and runner consumer outside this interface. Run lifecycle state remains in
 * D1RunStore; this interface transports an immutable request only.
 */
export const runnerQueueInterface = Object.freeze({
  enqueue: "enqueue(message) -> { message, created, deliveryState }",
  claim: "claim({ consumerId, claimedAt }) -> { message, lease } | null",
  acknowledge: "acknowledge({ runId, leaseId, acknowledgedAt }) -> message",
  release: "release({ runId, leaseId, releasedAt }) -> message",
  cancelQueued: "cancelQueued({ runId, cancelledAt }) -> { deliveryState, message? }",
});

/**
 * A deterministic in-memory reference adapter for protocol tests and local
 * control-plane wiring. It is deliberately not a production queue, has no
 * authentication, and never invokes Lean or any submitted code.
 */
export class InMemoryRunnerQueue {
  constructor() {
    this.byRunId = new Map();
    this.byIdempotency = new Map();
    this.order = [];
    this.leaseSequence = 0;
  }

  async enqueue(message) {
    const normalized = await normalizeRunnerQueueMessage(message);
    const idempotencyIdentity = `${normalized.request.attemptId}\u0000${normalized.request.idempotencyKey}`;
    const existingRun = this.byRunId.get(normalized.runId);
    const existingIdempotency = this.byIdempotency.get(idempotencyIdentity);

    if (existingRun && existingRun.message.requestHash !== normalized.requestHash) {
      throw new RunnerQueueProtocolError("A RunnerQueue runId cannot be reused for a different request.");
    }
    if (existingIdempotency && existingIdempotency.message.requestHash !== normalized.requestHash) {
      throw new RunnerQueueProtocolError("A RunnerQueue idempotency key cannot be reused for a different request.");
    }
    if (existingRun || existingIdempotency) {
      const existing = existingRun ?? existingIdempotency;
      return Object.freeze({
        message: existing.message,
        created: false,
        deliveryState: existing.deliveryState,
      });
    }

    const record = {
      message: normalized,
      deliveryState: "queued",
      lease: null,
    };
    this.byRunId.set(normalized.runId, record);
    this.byIdempotency.set(idempotencyIdentity, record);
    this.order.push(normalized.runId);
    return Object.freeze({ message: normalized, created: true, deliveryState: "queued" });
  }

  async claim({ consumerId, claimedAt }) {
    requireIdentifier(consumerId, "consumerId");
    requireUtcInstant(claimedAt, "claimedAt");
    const record = this.order
      .map((runId) => this.byRunId.get(runId))
      .find((candidate) => candidate?.deliveryState === "queued");
    if (!record) return null;

    const lease = Object.freeze({
      id: `lease:${record.message.runId}:${++this.leaseSequence}`,
      consumerId,
      claimedAt,
    });
    record.deliveryState = "leased";
    record.lease = lease;
    return Object.freeze({ message: record.message, lease });
  }

  async acknowledge({ runId, leaseId, acknowledgedAt }) {
    const record = this.requireLeasedRecord(runId, leaseId);
    requireUtcInstant(acknowledgedAt, "acknowledgedAt");
    record.deliveryState = "acknowledged";
    record.lease = null;
    return record.message;
  }

  async release({ runId, leaseId, releasedAt }) {
    const record = this.requireLeasedRecord(runId, leaseId);
    requireUtcInstant(releasedAt, "releasedAt");
    record.deliveryState = "queued";
    record.lease = null;
    return record.message;
  }

  async cancelQueued({ runId, cancelledAt }) {
    requireIdentifier(runId, "runId");
    requireUtcInstant(cancelledAt, "cancelledAt");
    const record = this.byRunId.get(runId);
    if (!record) return Object.freeze({ deliveryState: "not_found" });
    if (record.deliveryState === "queued") {
      record.deliveryState = "cancelled";
      return Object.freeze({ deliveryState: "cancelled", message: record.message });
    }
    return Object.freeze({ deliveryState: record.deliveryState, message: record.message });
  }

  requireLeasedRecord(runId, leaseId) {
    requireIdentifier(runId, "runId");
    requireIdentifier(leaseId, "leaseId");
    const record = this.byRunId.get(runId);
    if (!record || record.deliveryState !== "leased" || record.lease?.id !== leaseId) {
      throw new RunnerQueueProtocolError("RunnerQueue operation requires the active lease for this run.");
    }
    return record;
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunnerQueueProtocolError(`${label} must be an object.`);
  }
}

function rejectExtraKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new RunnerQueueProtocolError(`${label} has an unsupported field: ${key}.`);
    }
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,191}$/.test(value)) {
    throw new RunnerQueueProtocolError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RunnerQueueProtocolError(`${label} must be a sha256 digest.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new RunnerQueueProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}
