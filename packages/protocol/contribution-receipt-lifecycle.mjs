import { canonicalJson, canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";

export const contributionReceiptLifecycleEventProtocolVersion = "pw-contribution-receipt-lifecycle-event-v1";
export const contributionReceiptLifecycleEventTypes = Object.freeze([
  "corrected",
  "superseded",
  "retracted",
]);

export class ContributionReceiptLifecycleProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptLifecycleProtocolError";
  }
}

/** Normalize an unsigned operator draft before its issuer signs it. */
export function normalizeContributionReceiptLifecycleEventDraft(event) {
  return normalizeLifecycleEvent(event, { requireSignature: false });
}

/** Normalize one immutable, issuer-signed receipt lifecycle event. */
export function normalizeContributionReceiptLifecycleEvent(event) {
  return normalizeLifecycleEvent(event, { requireSignature: true });
}

export function contributionReceiptLifecycleEventSigningPayload(event) {
  const normalized = normalizeContributionReceiptLifecycleEvent(event);
  const payload = { ...normalized };
  delete payload.payloadHash;
  delete payload.issuerSignature;
  return payload;
}

export async function contributionReceiptLifecycleEventPayloadHash(event) {
  return sha256Canonical(contributionReceiptLifecycleEventSigningPayload(event));
}

export async function createContributionReceiptLifecycleEvent({ event, issuerPrivateKey }) {
  const draft = normalizeContributionReceiptLifecycleEventDraft(event);
  const payloadHash = await sha256Canonical(draft);
  let issuerSignature;
  try {
    issuerSignature = toBase64Url(await crypto.subtle.sign(
      "Ed25519",
      issuerPrivateKey,
      canonicalUtf8(draft),
    ));
  } catch {
    throw new ContributionReceiptLifecycleProtocolError("issuerPrivateKey must be an Ed25519 signing key.");
  }
  const signed = normalizeContributionReceiptLifecycleEvent({
    ...draft,
    payloadHash,
    issuerSignature,
  });
  if (!await verifyContributionReceiptLifecycleEventSignature(signed)) {
    throw new ContributionReceiptLifecycleProtocolError("issuerPrivateKey does not match the lifecycle event issuerPublicKey.");
  }
  return signed;
}

export async function verifyContributionReceiptLifecycleEventSignature(event) {
  const normalized = normalizeContributionReceiptLifecycleEvent(event);
  if (normalized.payloadHash !== await contributionReceiptLifecycleEventPayloadHash(normalized)) return false;
  const issuerKey = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(normalized.issuerPublicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    issuerKey,
    fromBase64Url(normalized.issuerSignature),
    canonicalUtf8(contributionReceiptLifecycleEventSigningPayload(normalized)),
  );
}

export function canonicalContributionReceiptLifecycleEvent(event) {
  return canonicalJson(normalizeContributionReceiptLifecycleEvent(event));
}

function normalizeLifecycleEvent(event, { requireSignature }) {
  requireRecord(event, "Contribution Receipt lifecycle event");
  const allowed = [
    "protocolVersion", "id", "receiptId", "eventType", "replacementReceiptId",
    "reasonHash", "occurredAt", "issuerKeyId", "issuerPublicKey",
  ];
  if (requireSignature) allowed.push("payloadHash", "issuerSignature");
  rejectExtraKeys(event, allowed, "Contribution Receipt lifecycle event");
  if (event.protocolVersion !== contributionReceiptLifecycleEventProtocolVersion) {
    throw new ContributionReceiptLifecycleProtocolError("Unsupported Contribution Receipt lifecycle event protocol version.");
  }
  requireIdentifier(event.id, "Contribution Receipt lifecycle event id");
  requireIdentifier(event.receiptId, "Contribution Receipt lifecycle event receiptId");
  if (!contributionReceiptLifecycleEventTypes.includes(event.eventType)) {
    throw new ContributionReceiptLifecycleProtocolError("Contribution Receipt lifecycle event type is invalid.");
  }
  const replacementReceiptId = normalizeReplacementReceiptId(event);
  requireSha256(event.reasonHash, "Contribution Receipt lifecycle event reasonHash");
  requireUtcInstant(event.occurredAt, "Contribution Receipt lifecycle event occurredAt");
  requireIdentifier(event.issuerKeyId, "Contribution Receipt lifecycle event issuerKeyId");
  requireBase64Url(event.issuerPublicKey, 32, "Contribution Receipt lifecycle event issuerPublicKey");

  const normalized = {
    protocolVersion: contributionReceiptLifecycleEventProtocolVersion,
    id: event.id,
    receiptId: event.receiptId,
    eventType: event.eventType,
    replacementReceiptId,
    reasonHash: event.reasonHash,
    occurredAt: event.occurredAt,
    issuerKeyId: event.issuerKeyId,
    issuerPublicKey: event.issuerPublicKey,
  };
  if (!requireSignature) return Object.freeze(normalized);
  requireSha256(event.payloadHash, "Contribution Receipt lifecycle event payloadHash");
  requireBase64Url(event.issuerSignature, 64, "Contribution Receipt lifecycle event issuerSignature");
  return Object.freeze({ ...normalized, payloadHash: event.payloadHash, issuerSignature: event.issuerSignature });
}

function normalizeReplacementReceiptId(event) {
  if (event.eventType === "retracted") {
    if (event.replacementReceiptId !== null && event.replacementReceiptId !== undefined) {
      throw new ContributionReceiptLifecycleProtocolError("A retracted Contribution Receipt cannot name a replacement receipt.");
    }
    return null;
  }
  requireIdentifier(event.replacementReceiptId, "Contribution Receipt lifecycle event replacementReceiptId");
  if (event.replacementReceiptId === event.receiptId) {
    throw new ContributionReceiptLifecycleProtocolError("A Contribution Receipt lifecycle event cannot replace its own receipt.");
  }
  return event.replacementReceiptId;
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new ContributionReceiptLifecycleProtocolError(`${label} contains unsupported field ${extra}.`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContributionReceiptLifecycleProtocolError(`${label} must be an object.`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/.test(value)) {
    throw new ContributionReceiptLifecycleProtocolError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ContributionReceiptLifecycleProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ContributionReceiptLifecycleProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireBase64Url(value, byteLength, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ContributionReceiptLifecycleProtocolError(`${label} must be unpadded base64url.`);
  }
  if (fromBase64Url(value).byteLength !== byteLength) {
    throw new ContributionReceiptLifecycleProtocolError(`${label} has an invalid length.`);
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

function toBase64Url(value) {
  const binary = String.fromCharCode(...new Uint8Array(value));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
