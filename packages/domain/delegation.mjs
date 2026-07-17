import { canonicalUtf8, sha256Canonical } from "../protocol/canonical-json.mjs";

export const delegationScopes = ["formalize", "prove", "review"];
export const delegationProtocolVersion = "pw-delegation-v1";

export class DelegationValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DelegationValidationError";
  }
}

/**
 * Validate and normalize the immutable, signed portion of a delegation.
 * Signatures never cover a revocation, because revocation is a later append-only
 * event rather than a mutation of the original certificate.
 */
export function normalizeDelegationCertificate(certificate) {
  requireRecord(certificate, "Delegation certificate");
  requireString(certificate.id, "Delegation certificate id");
  requireString(certificate.ownerPersonId, "Delegation owner person id");
  requireString(certificate.agentId, "Delegation agent id");
  requireBase64Url(certificate.agentPublicKey, 32, "Agent public key");
  requireString(certificate.validFrom, "Delegation validFrom");
  requireString(certificate.validUntil, "Delegation validUntil");
  requireRecord(certificate.attributionPolicy, "Delegation attribution policy");
  requireString(certificate.attributionPolicy.beneficiaryPersonId, "Delegation beneficiary person id");

  if (certificate.attributionPolicy.mode !== "agent_delegated") {
    throw new DelegationValidationError("Delegation attribution mode must be agent_delegated.");
  }
  if (certificate.attributionPolicy.beneficiaryPersonId !== certificate.ownerPersonId) {
    throw new DelegationValidationError("Delegation beneficiary must be its owner Person.");
  }

  const validFrom = parseUtcInstant(certificate.validFrom, "Delegation validFrom");
  const validUntil = parseUtcInstant(certificate.validUntil, "Delegation validUntil");
  if (validUntil <= validFrom) {
    throw new DelegationValidationError("Delegation validUntil must be after validFrom.");
  }

  if (!Array.isArray(certificate.scopes) || certificate.scopes.length === 0) {
    throw new DelegationValidationError("Delegation scopes must be a non-empty array.");
  }
  const scopes = [...certificate.scopes].sort();
  if (new Set(scopes).size !== scopes.length || scopes.some((scope) => !delegationScopes.includes(scope))) {
    throw new DelegationValidationError("Delegation contains an invalid or duplicate scope.");
  }

  return Object.freeze({
    id: certificate.id,
    ownerPersonId: certificate.ownerPersonId,
    agentId: certificate.agentId,
    agentPublicKey: certificate.agentPublicKey,
    scopes: Object.freeze(scopes),
    validFrom: certificate.validFrom,
    validUntil: certificate.validUntil,
    attributionPolicy: Object.freeze({
      beneficiaryPersonId: certificate.attributionPolicy.beneficiaryPersonId,
      mode: "agent_delegated",
    }),
  });
}

export function delegationSigningPayload(certificate) {
  const normalized = normalizeDelegationCertificate(certificate);
  return {
    protocol_version: delegationProtocolVersion,
    delegation_id: normalized.id,
    person_id: normalized.ownerPersonId,
    agent_id: normalized.agentId,
    agent_public_key: normalized.agentPublicKey,
    scope: [...normalized.scopes],
    valid_from: normalized.validFrom,
    valid_until: normalized.validUntil,
    attribution_policy: {
      beneficiary: normalized.attributionPolicy.beneficiaryPersonId,
      mode: normalized.attributionPolicy.mode,
    },
  };
}

export async function delegationPayloadHash(certificate) {
  return sha256Canonical(delegationSigningPayload(certificate));
}

export async function verifyDelegationSignature({ certificate, personPublicKey, personSignature }) {
  const normalized = normalizeDelegationCertificate(certificate);
  requireBase64Url(personPublicKey, 32, "Person public key");
  requireBase64Url(personSignature, 64, "Person signature");

  const verificationKey = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(personPublicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    verificationKey,
    fromBase64Url(personSignature),
    canonicalUtf8(delegationSigningPayload(normalized)),
  );
}

/**
 * @param {object} certificate
 * @param {string} eventTime
 * @param {string | null} [revokedAt]
 */
export function delegationValidityAt(certificate, eventTime, revokedAt = null) {
  const normalized = normalizeDelegationCertificate(certificate);
  const eventMilliseconds = parseUtcInstant(eventTime, "Event time");
  if (revokedAt !== null) {
    const revokedMilliseconds = parseUtcInstant(revokedAt, "Delegation revokedAt");
    if (eventMilliseconds >= revokedMilliseconds) {
      return { valid: false, reason: "revoked" };
    }
  }
  if (eventMilliseconds < parseUtcInstant(normalized.validFrom, "Delegation validFrom")) {
    return { valid: false, reason: "not_yet_valid" };
  }
  if (eventMilliseconds >= parseUtcInstant(normalized.validUntil, "Delegation validUntil")) {
    return { valid: false, reason: "expired" };
  }
  return { valid: true, reason: null };
}

/**
 * @param {object} certificate
 * @param {"formalize" | "prove" | "review"} scope
 * @param {string} eventTime
 * @param {string | null} [revokedAt]
 */
export function assertDelegationAllows(certificate, scope, eventTime, revokedAt = null) {
  if (!delegationScopes.includes(scope)) {
    throw new DelegationValidationError(`Unknown delegation scope: ${scope}.`);
  }
  const validity = delegationValidityAt(certificate, eventTime, revokedAt);
  if (!validity.valid) {
    throw new DelegationValidationError(`Delegation is not valid at event time: ${validity.reason}.`);
  }
  const normalized = normalizeDelegationCertificate(certificate);
  if (!normalized.scopes.includes(scope)) {
    throw new DelegationValidationError(`Delegation does not grant ${scope}.`);
  }
  return normalized;
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DelegationValidationError(`${label} must be an object.`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DelegationValidationError(`${label} must be a non-empty string.`);
  }
}

function requireBase64Url(value, expectedLength, label) {
  requireString(value, label);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new DelegationValidationError(`${label} must be unpadded base64url.`);
  }
  if (fromBase64Url(value).byteLength !== expectedLength) {
    throw new DelegationValidationError(`${label} has an invalid length.`);
  }
}

function parseUtcInstant(value, label) {
  requireString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new DelegationValidationError(`${label} must be an ISO-8601 UTC instant.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new DelegationValidationError(`${label} is not a valid instant.`);
  }
  return milliseconds;
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
