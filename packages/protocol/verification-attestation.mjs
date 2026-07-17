import { canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";

export const verificationClaimTypes = [
  "bundle_reproducible",
  "kernel_accepted",
  "statement_faithful",
  "novelty_reviewed",
  "project_accepted",
];

// Only `attested` is positive evidence for a receipt policy. Every other
// signed decision closes the assignment without upgrading the covered claim.
export const verificationDecisions = [
  "attested",
  "rejected",
  "request_changes",
  "conflict_declared",
  "integrity_flagged",
];
export const verificationAttestationProtocolVersion = "pw-verification-attestation-v1";

export class VerificationAttestationProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationAttestationProtocolError";
  }
}

/** Normalize the signed, immutable evidence submitted by a review Agent. */
export function normalizeVerificationAttestation(attestation) {
  requireRecord(attestation, "Verification attestation");
  rejectExtraKeys(attestation, [
    "protocolVersion", "id", "assignmentId", "artifactBundleHash", "claimType",
    "verifierPersonId", "verifierAgentId", "delegationCertificateId",
    "verifierAgentPublicKey", "decision", "evidenceHash", "attestedAt",
    "payloadHash", "signature",
  ]);
  if (attestation.protocolVersion !== verificationAttestationProtocolVersion) {
    throw new VerificationAttestationProtocolError("Unsupported verification attestation protocol version.");
  }
  for (const [label, value] of Object.entries({
    id: attestation.id,
    assignmentId: attestation.assignmentId,
    verifierPersonId: attestation.verifierPersonId,
    verifierAgentId: attestation.verifierAgentId,
    delegationCertificateId: attestation.delegationCertificateId,
  })) {
    requireIdentifier(value, `Verification attestation ${label}`);
  }
  requireSha256(attestation.artifactBundleHash, "Verification attestation artifactBundleHash");
  requireSha256(attestation.evidenceHash, "Verification attestation evidenceHash");
  requireSha256(attestation.payloadHash, "Verification attestation payloadHash");
  if (!verificationClaimTypes.includes(attestation.claimType)) {
    throw new VerificationAttestationProtocolError("Verification attestation claimType is invalid.");
  }
  if (!verificationDecisions.includes(attestation.decision)) {
    throw new VerificationAttestationProtocolError("Verification attestation decision is invalid.");
  }
  requireUtcInstant(attestation.attestedAt, "Verification attestation attestedAt");
  requireBase64Url(attestation.verifierAgentPublicKey, 32, "Verification attestation verifierAgentPublicKey");
  requireBase64Url(attestation.signature, 64, "Verification attestation signature");

  return Object.freeze({
    protocolVersion: verificationAttestationProtocolVersion,
    id: attestation.id,
    assignmentId: attestation.assignmentId,
    artifactBundleHash: attestation.artifactBundleHash,
    claimType: attestation.claimType,
    verifierPersonId: attestation.verifierPersonId,
    verifierAgentId: attestation.verifierAgentId,
    delegationCertificateId: attestation.delegationCertificateId,
    verifierAgentPublicKey: attestation.verifierAgentPublicKey,
    decision: attestation.decision,
    evidenceHash: attestation.evidenceHash,
    attestedAt: attestation.attestedAt,
    payloadHash: attestation.payloadHash,
    signature: attestation.signature,
  });
}

/** Excludes detached signature fields to avoid a circular signed payload. */
export function verificationAttestationSigningPayload(attestation) {
  const normalized = normalizeVerificationAttestation(attestation);
  const payload = { ...normalized };
  delete payload.payloadHash;
  delete payload.signature;
  return payload;
}

export async function verificationAttestationPayloadHash(attestation) {
  return sha256Canonical(verificationAttestationSigningPayload(attestation));
}

export async function verifyVerificationAttestationSignature(attestation) {
  const normalized = normalizeVerificationAttestation(attestation);
  if (normalized.payloadHash !== await verificationAttestationPayloadHash(normalized)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(normalized.verifierAgentPublicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    fromBase64Url(normalized.signature),
    canonicalUtf8(verificationAttestationSigningPayload(normalized)),
  );
}

export function assertIndependentVerification(attemptOwnerPersonId, verifierPersonId) {
  requireIdentifier(attemptOwnerPersonId, "Attempt owner Person id");
  requireIdentifier(verifierPersonId, "Verifier Person id");
  if (attemptOwnerPersonId === verifierPersonId) {
    throw new VerificationAttestationProtocolError("A verifier Person cannot independently review their own Attempt.");
  }
}

function rejectExtraKeys(value, allowed) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new VerificationAttestationProtocolError(`Verification attestation contains unsupported field ${extra}.`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VerificationAttestationProtocolError(`${label} must be an object.`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
    throw new VerificationAttestationProtocolError(`${label} must be a non-empty identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new VerificationAttestationProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new VerificationAttestationProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireBase64Url(value, length, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new VerificationAttestationProtocolError(`${label} must be unpadded base64url.`);
  }
  if (fromBase64Url(value).byteLength !== length) {
    throw new VerificationAttestationProtocolError(`${label} has an invalid length.`);
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
