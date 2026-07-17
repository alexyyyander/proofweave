import {
  leanRunnerRequestHash,
  normalizeLeanRunnerRequest,
} from "../../packages/protocol/lean-runner.mjs";
import { canonicalUtf8 } from "../../packages/protocol/canonical-json.mjs";

export const runnerQueueProtocolVersion = "pw-runner-queue-v1";

export class RunnerQueueProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerQueueProtocolError";
  }
}

export class RunnerJobAuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RunnerJobAuthenticationError";
  }
}

/**
 * Build the only payload a control plane may put on a runner queue. It carries
 * a validated, source-free runner request and its canonical hash; it never
 * carries source bytes, environment secrets, or a shell command.
 */
export async function createRunnerQueueMessage({
  runId,
  request,
  enqueuedAt,
  controlPlaneKeyId,
  controlPlanePrivateKey,
}) {
  const unsigned = await createUnsignedRunnerQueueMessage({
    runId,
    request,
    enqueuedAt,
    controlPlaneKeyId,
  });
  let controlPlaneSignature;
  try {
    controlPlaneSignature = toBase64Url(await crypto.subtle.sign(
      "Ed25519",
      controlPlanePrivateKey,
      canonicalUtf8(runnerQueueSigningPayload(unsigned)),
    ));
  } catch {
    throw new RunnerQueueProtocolError("controlPlanePrivateKey must be an Ed25519 signing key.");
  }
  return normalizeRunnerQueueMessage({ ...unsigned, controlPlaneSignature });
}

async function createUnsignedRunnerQueueMessage({ runId, request, enqueuedAt, controlPlaneKeyId }) {
  requireIdentifier(runId, "runId");
  requireUtcInstant(enqueuedAt, "enqueuedAt");
  requireIdentifier(controlPlaneKeyId, "controlPlaneKeyId");
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
    controlPlaneKeyId,
  });
}

/** Re-derive the request hash rather than trusting a queue-provider payload. */
export async function normalizeRunnerQueueMessage(message) {
  requireRecord(message, "Runner queue message");
  rejectExtraKeys(message, [
    "protocolVersion", "runId", "requestHash", "request", "enqueuedAt",
    "controlPlaneKeyId", "controlPlaneSignature",
  ], "Runner queue message");
  if (message.protocolVersion !== runnerQueueProtocolVersion) {
    throw new RunnerQueueProtocolError("Unsupported RunnerQueue protocol version.");
  }
  requireSha256(message.requestHash, "Runner queue requestHash");
  requireIdentifier(message.controlPlaneKeyId, "controlPlaneKeyId");
  requireBase64Url(message.controlPlaneSignature, 64, "controlPlaneSignature");
  const normalized = await createUnsignedRunnerQueueMessage(message);
  if (normalized.requestHash !== message.requestHash) {
    throw new RunnerQueueProtocolError("Runner queue requestHash does not match the canonical request.");
  }
  return Object.freeze({ ...normalized, controlPlaneSignature: message.controlPlaneSignature });
}

/** The control plane signs every immutable queue field except its own signature. */
export function runnerQueueSigningPayload(message) {
  requireRecord(message, "Runner queue message");
  return {
    protocolVersion: message.protocolVersion,
    runId: message.runId,
    requestHash: message.requestHash,
    request: message.request,
    enqueuedAt: message.enqueuedAt,
    controlPlaneKeyId: message.controlPlaneKeyId,
  };
}

/** Verify a queue message against one operator-provisioned control-plane key. */
export async function verifyRunnerQueueMessageSignature({ message, controlPlanePublicKey }) {
  const normalized = await normalizeRunnerQueueMessage(message);
  requireBase64Url(controlPlanePublicKey, 32, "controlPlanePublicKey");
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(controlPlanePublicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    fromBase64Url(normalized.controlPlaneSignature),
    canonicalUtf8(runnerQueueSigningPayload(normalized)),
  );
}

/**
 * Runner-side key allowlist. Container deployments receive only public issuer
 * keys; the matching signing key stays in the control-plane secret store.
 */
export class RunnerJobAuthenticator {
  constructor({ issuerKeys }) {
    if (!Array.isArray(issuerKeys) || issuerKeys.length === 0) {
      throw new RunnerJobAuthenticationError("RunnerJobAuthenticator requires at least one issuer key.");
    }
    this.issuerKeys = new Map();
    for (const issuer of issuerKeys) {
      requireRecord(issuer, "Runner job issuer key");
      rejectExtraKeys(issuer, ["id", "publicKey"], "Runner job issuer key");
      requireIdentifier(issuer.id, "Runner job issuer key id");
      requireBase64Url(issuer.publicKey, 32, "Runner job issuer publicKey");
      if (this.issuerKeys.has(issuer.id)) {
        throw new RunnerJobAuthenticationError("Runner job issuer key ids must be unique.");
      }
      this.issuerKeys.set(issuer.id, issuer.publicKey);
    }
  }

  async authenticate(message) {
    const normalized = await normalizeRunnerQueueMessage(message);
    const publicKey = this.issuerKeys.get(normalized.controlPlaneKeyId);
    if (!publicKey) {
      throw new RunnerJobAuthenticationError("Runner queue message issuer key is not allowlisted.");
    }
    if (!await verifyRunnerQueueMessageSignature({ message: normalized, controlPlanePublicKey: publicKey })) {
      throw new RunnerJobAuthenticationError("Runner queue message control-plane signature is invalid.");
    }
    return normalized;
  }
}

/**
 * Provider-neutral queue interface.
 *
 * A production adapter must implement these asynchronous operations with
 * at-least-once delivery. A runner must authenticate every message with
 * RunnerJobAuthenticator before it uses the request. Run lifecycle state
 * remains in D1RunStore; this interface transports an immutable request only.
 */
export const runnerQueueInterface = Object.freeze({
  enqueue: "enqueue(message) -> { message, created, deliveryState }",
  claim: "claim({ consumerId, claimedAt, leaseDurationSeconds }) -> { message, lease } | null",
  renew: "renew({ runId, leaseId, renewedAt, leaseDurationSeconds }) -> lease",
  acknowledge: "acknowledge({ runId, leaseId, acknowledgedAt }) -> message",
  release: "release({ runId, leaseId, releasedAt, availableAt?, errorCode? }) -> message",
  deadLetter: "deadLetter({ runId, leaseId, deadLetteredAt, errorCode }) -> message",
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
      availableAt: normalized.enqueuedAt,
      deliveryAttempts: 0,
      lastErrorCode: null,
    };
    this.byRunId.set(normalized.runId, record);
    this.byIdempotency.set(idempotencyIdentity, record);
    this.order.push(normalized.runId);
    return Object.freeze({ message: normalized, created: true, deliveryState: "queued" });
  }

  async claim({ consumerId, claimedAt, leaseDurationSeconds = 300 }) {
    requireIdentifier(consumerId, "consumerId");
    requireUtcInstant(claimedAt, "claimedAt");
    requireDuration(leaseDurationSeconds, "leaseDurationSeconds");
    const record = this.order
      .map((runId) => this.byRunId.get(runId))
      .find((candidate) => (
        candidate?.deliveryState === "queued" && Date.parse(candidate.availableAt) <= Date.parse(claimedAt)
      ) || (
        candidate?.deliveryState === "leased" && Date.parse(candidate.lease.expiresAt) <= Date.parse(claimedAt)
      ));
    if (!record) return null;

    record.deliveryAttempts += 1;
    const lease = Object.freeze({
      id: `lease:${record.message.runId}:${++this.leaseSequence}`,
      consumerId,
      claimedAt,
      expiresAt: addSeconds(claimedAt, leaseDurationSeconds),
      deliveryAttempt: record.deliveryAttempts,
    });
    record.deliveryState = "leased";
    record.lease = lease;
    record.lastErrorCode = null;
    return Object.freeze({ message: record.message, lease });
  }

  async renew({ runId, leaseId, renewedAt, leaseDurationSeconds = 300 }) {
    const record = this.requireLeasedRecord(runId, leaseId);
    requireUtcInstant(renewedAt, "renewedAt");
    requireDuration(leaseDurationSeconds, "leaseDurationSeconds");
    const nextExpiresAt = addSeconds(renewedAt, leaseDurationSeconds);
    if (
      Date.parse(record.lease.claimedAt) > Date.parse(renewedAt) ||
      Date.parse(record.lease.expiresAt) <= Date.parse(renewedAt) ||
      Date.parse(record.lease.expiresAt) >= Date.parse(nextExpiresAt)
    ) {
      throw new RunnerQueueProtocolError("RunnerQueue operation requires an unexpired active lease for this run.");
    }
    record.lease = Object.freeze({
      ...record.lease,
      expiresAt: nextExpiresAt,
    });
    return record.lease;
  }

  async acknowledge({ runId, leaseId, acknowledgedAt }) {
    const record = this.requireLeasedRecord(runId, leaseId);
    requireUtcInstant(acknowledgedAt, "acknowledgedAt");
    requireLeaseUnexpired(record, acknowledgedAt);
    record.deliveryState = "acknowledged";
    record.lease = null;
    return record.message;
  }

  async release({ runId, leaseId, releasedAt, availableAt = releasedAt, errorCode = null }) {
    const record = this.requireLeasedRecord(runId, leaseId);
    requireUtcInstant(releasedAt, "releasedAt");
    requireUtcInstant(availableAt, "availableAt");
    requireLeaseUnexpired(record, releasedAt);
    requireOptionalErrorCode(errorCode);
    if (Date.parse(availableAt) < Date.parse(releasedAt)) {
      throw new RunnerQueueProtocolError("RunnerQueue retry availability cannot precede its release.");
    }
    record.deliveryState = "queued";
    record.lease = null;
    record.availableAt = availableAt;
    record.lastErrorCode = errorCode;
    return record.message;
  }

  async deadLetter({ runId, leaseId, deadLetteredAt, errorCode }) {
    const record = this.requireLeasedRecord(runId, leaseId);
    requireUtcInstant(deadLetteredAt, "deadLetteredAt");
    requireLeaseUnexpired(record, deadLetteredAt);
    requireOptionalErrorCode(errorCode, { required: true });
    record.deliveryState = "dead_letter";
    record.lease = null;
    record.lastErrorCode = errorCode;
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

function requireBase64Url(value, expectedByteLength, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new RunnerQueueProtocolError(`${label} must be unpadded base64url.`);
  }
  if (fromBase64Url(value).byteLength !== expectedByteLength) {
    throw new RunnerQueueProtocolError(`${label} has an invalid length.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new RunnerQueueProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireDuration(value, label) {
  if (!Number.isSafeInteger(value) || value < 30 || value > 3_600) {
    throw new RunnerQueueProtocolError(`${label} must be between 30 and 3600 seconds.`);
  }
}

function requireOptionalErrorCode(value, { required = false } = {}) {
  if (value === null && !required) return;
  if (typeof value !== "string" || !/^[a-z][a-z0-9_]{2,63}$/.test(value)) {
    throw new RunnerQueueProtocolError("RunnerQueue errorCode must be a bounded privacy-safe code.");
  }
}

function addSeconds(value, seconds) {
  return new Date(Date.parse(value) + seconds * 1_000).toISOString();
}

function requireLeaseUnexpired(record, occurredAt) {
  if (
    Date.parse(record.lease.claimedAt) > Date.parse(occurredAt) ||
    Date.parse(record.lease.expiresAt) <= Date.parse(occurredAt)
  ) {
    throw new RunnerQueueProtocolError("RunnerQueue operation requires an unexpired active lease for this run.");
  }
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toBase64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
