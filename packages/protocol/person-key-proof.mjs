import { canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";

export const personKeyProofChallengeProtocolVersion = "pw-person-key-proof-challenge-v1";

export class PersonKeyProofProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "PersonKeyProofProtocolError";
  }
}

/**
 * Normalize the server-issued, one-time payload a Person signs to demonstrate
 * that the browser currently holds the registered private key. The challenge
 * is deliberately independent of any delegation certificate so it can be
 * completed immediately after registering a device key.
 */
export function normalizePersonKeyProofChallenge(challenge) {
  requireRecord(challenge, "Person key proof challenge");
  rejectExtraKeys(challenge, [
    "protocolVersion", "id", "personId", "personKeyId", "personPublicKey",
    "nonce", "issuedAt", "expiresAt",
  ], "Person key proof challenge");
  if (challenge.protocolVersion !== personKeyProofChallengeProtocolVersion) {
    throw new PersonKeyProofProtocolError("Unsupported Person key proof challenge protocol version.");
  }
  requireIdentifier(challenge.id, "Person key proof challenge id");
  requireIdentifier(challenge.personId, "Person key proof challenge personId");
  requireIdentifier(challenge.personKeyId, "Person key proof challenge personKeyId");
  requireBase64Url(challenge.personPublicKey, 32, "Person key proof challenge personPublicKey");
  requireBase64Url(challenge.nonce, 32, "Person key proof challenge nonce");
  const issuedAt = parseUtcInstant(challenge.issuedAt, "Person key proof challenge issuedAt");
  const expiresAt = parseUtcInstant(challenge.expiresAt, "Person key proof challenge expiresAt");
  if (expiresAt <= issuedAt) {
    throw new PersonKeyProofProtocolError("Person key proof challenge expiresAt must be after issuedAt.");
  }

  return Object.freeze({
    protocolVersion: personKeyProofChallengeProtocolVersion,
    id: challenge.id,
    personId: challenge.personId,
    personKeyId: challenge.personKeyId,
    personPublicKey: challenge.personPublicKey,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  });
}

export function personKeyProofChallengeSigningPayload(challenge) {
  const normalized = normalizePersonKeyProofChallenge(challenge);
  return {
    protocol_version: normalized.protocolVersion,
    challenge_id: normalized.id,
    person_id: normalized.personId,
    person_key_id: normalized.personKeyId,
    person_public_key: normalized.personPublicKey,
    nonce: normalized.nonce,
    issued_at: normalized.issuedAt,
    expires_at: normalized.expiresAt,
  };
}

export async function personKeyProofChallengePayloadHash(challenge) {
  return sha256Canonical(personKeyProofChallengeSigningPayload(challenge));
}

export async function verifyPersonKeyProofChallengeSignature({
  challenge,
  personPublicKey,
  personSignature,
}) {
  const normalized = normalizePersonKeyProofChallenge(challenge);
  requireBase64Url(personPublicKey, 32, "Person public key");
  requireBase64Url(personSignature, 64, "Person key proof signature");
  if (normalized.personPublicKey !== personPublicKey) return false;

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
    canonicalUtf8(personKeyProofChallengeSigningPayload(normalized)),
  );
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PersonKeyProofProtocolError(`${label} must be an object.`);
  }
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new PersonKeyProofProtocolError(`${label} contains unsupported field ${extra}.`);
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/.test(value)) {
    throw new PersonKeyProofProtocolError(`${label} must be a bounded identifier.`);
  }
}

function requireBase64Url(value, byteLength, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PersonKeyProofProtocolError(`${label} must be unpadded base64url.`);
  }
  if (fromBase64Url(value).byteLength !== byteLength) {
    throw new PersonKeyProofProtocolError(`${label} has an invalid length.`);
  }
}

function parseUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new PersonKeyProofProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
  return Date.parse(value);
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
