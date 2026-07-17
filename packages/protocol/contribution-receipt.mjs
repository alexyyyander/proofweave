import { canonicalJson, canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";
import { verificationClaimTypes } from "./verification-attestation.mjs";

export const contributionReceiptProtocolVersion = "pw-contribution-receipt-v1";
export const contributionKinds = [
  "formalization",
  "lemma",
  "proof_patch",
  "counterexample",
  "verification",
  "synthesis",
  "infrastructure",
];
export const contributionReceiptPolicyVersion = "pw-receipt-policy-v1";

export const contributionReceiptRequiredClaimTypes = Object.freeze([
  "bundle_reproducible",
  "kernel_accepted",
  "project_accepted",
]);

export class ContributionReceiptProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptProtocolError";
  }
}

export class ContributionReceiptPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptPolicyError";
  }
}

/** Normalize one immutable, externally verifiable contribution receipt. */
export function normalizeContributionReceipt(receipt) {
  return normalizeReceipt(receipt, { requireSignature: true });
}

/** Canonical form includes all evidence and the Proofweave issuer signature. */
export function canonicalContributionReceipt(receipt) {
  return canonicalJson(normalizeContributionReceipt(receipt));
}

/** Any change to covered evidence, policy, or signature produces a new hash. */
export async function contributionReceiptHash(receipt) {
  return sha256Canonical(normalizeContributionReceipt(receipt));
}

/** The issuer signs all evidence, excluding the derived payload hash/signature. */
export function contributionReceiptSigningPayload(receipt) {
  const normalized = normalizeContributionReceipt(receipt);
  const payload = { ...normalized };
  delete payload.payloadHash;
  delete payload.issuerSignature;
  return payload;
}

export async function contributionReceiptPayloadHash(receipt) {
  return sha256Canonical(contributionReceiptSigningPayload(receipt));
}

/**
 * Issue a signed receipt from a complete draft. The private key belongs only
 * to the control-plane issuer; it must never become receipt evidence.
 */
export async function createContributionReceipt({ receipt, issuerPrivateKey }) {
  const draft = normalizeReceipt(receipt, { requireSignature: false });
  assertContributionReceiptPolicyNormalized(draft);
  const payloadHash = await sha256Canonical(draft);
  let issuerSignature;
  try {
    issuerSignature = toBase64Url(await crypto.subtle.sign(
      "Ed25519",
      issuerPrivateKey,
      canonicalUtf8(draft),
    ));
  } catch {
    throw new ContributionReceiptProtocolError("issuerPrivateKey must be an Ed25519 signing key.");
  }
  const signed = normalizeContributionReceipt({ ...draft, payloadHash, issuerSignature });
  if (!await verifyContributionReceiptSignature(signed)) {
    throw new ContributionReceiptProtocolError("issuerPrivateKey does not match the receipt issuerPublicKey.");
  }
  return signed;
}

/** Verify the embedded issuer key, payload hash, and detached signature. */
export async function verifyContributionReceiptSignature(receipt) {
  const normalized = normalizeContributionReceipt(receipt);
  if (normalized.payloadHash !== await contributionReceiptPayloadHash(normalized)) return false;
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
    canonicalUtf8(contributionReceiptSigningPayload(normalized)),
  );
}

/**
 * Initial issuance policy for certified contribution receipts. Persistence
 * adapters must additionally resolve these IDs/hashes to immutable D1/R2
 * evidence before invoking the control-plane signing key.
 */
export function assertContributionReceiptPolicy(receipt) {
  const normalized = normalizeContributionReceipt(receipt);
  return assertContributionReceiptPolicyNormalized(normalized);
}

function assertContributionReceiptPolicyNormalized(normalized) {
  if (normalized.policyVersion !== contributionReceiptPolicyVersion) {
    throw new ContributionReceiptPolicyError("Contribution Receipt policy version is unsupported.");
  }
  if (normalized.run.status !== "succeeded" || normalized.run.kernelStatus !== "accepted") {
    throw new ContributionReceiptPolicyError("A certified Contribution Receipt requires a succeeded kernel-accepted Run.");
  }
  if (normalized.bundle.manifestHash !== normalized.artifactBundleHash) {
    throw new ContributionReceiptPolicyError("Contribution Receipt bundle evidence does not match its Artifact Bundle hash.");
  }
  for (const claimType of contributionReceiptRequiredClaimTypes) {
    const claim = normalized.claims.find((candidate) => candidate.claimType === claimType);
    if (!claim) {
      throw new ContributionReceiptPolicyError(`Contribution Receipt is missing required ${claimType} attestation evidence.`);
    }
    if (claim.reviewerPersonId === normalized.attempt.personId) {
      throw new ContributionReceiptPolicyError("Contribution Receipt review evidence must be from a different Person than the Attempt owner.");
    }
  }

  if (normalized.kind === "verification") {
    if (normalized.beneficiary.personId === normalized.attempt.personId) {
      throw new ContributionReceiptPolicyError("A verification receipt must credit an independent reviewer Person.");
    }
    const beneficiaryReview = normalized.claims.find((claim) => (
      claim.claimType !== "project_accepted" &&
      claim.reviewerPersonId === normalized.beneficiary.personId &&
      claim.reviewerAgentId === normalized.beneficiary.agentId &&
      claim.reviewerDelegationCertificateId === normalized.beneficiary.delegationCertificateId
    ));
    if (!beneficiaryReview) {
      throw new ContributionReceiptPolicyError("A verification receipt must cover an attestation made by its credited review Agent.");
    }
  } else if (
    normalized.beneficiary.personId !== normalized.attempt.personId ||
    normalized.beneficiary.agentId !== normalized.attempt.agentId ||
    normalized.beneficiary.delegationCertificateId !== normalized.attempt.delegationCertificateId
  ) {
    throw new ContributionReceiptPolicyError("A non-verification receipt must credit the Agent and Person that own the Attempt.");
  }
  return normalized;
}

function normalizeReceipt(receipt, { requireSignature }) {
  requireRecord(receipt, "Contribution Receipt");
  const allowed = [
    "protocolVersion", "id", "kind", "beneficiary", "attempt", "target",
    "artifactBundleHash", "bundle", "run", "claims", "issuedAt",
    "policyVersion", "issuerKeyId", "issuerPublicKey",
  ];
  if (requireSignature) allowed.push("payloadHash", "issuerSignature");
  rejectExtraKeys(receipt, allowed, "Contribution Receipt");
  if (receipt.protocolVersion !== contributionReceiptProtocolVersion) {
    throw new ContributionReceiptProtocolError("Unsupported Contribution Receipt protocol version.");
  }
  requireIdentifier(receipt.id, "Contribution Receipt id");
  if (!contributionKinds.includes(receipt.kind)) {
    throw new ContributionReceiptProtocolError("Contribution Receipt kind is invalid.");
  }
  const beneficiary = normalizeBeneficiary(receipt.beneficiary);
  const attempt = normalizeAttempt(receipt.attempt);
  const target = normalizeTarget(receipt.target);
  requireSha256(receipt.artifactBundleHash, "Contribution Receipt artifactBundleHash");
  const bundle = normalizeBundle(receipt.bundle);
  const run = normalizeRun(receipt.run);
  const claims = normalizeClaims(receipt.claims, receipt.artifactBundleHash);
  requireUtcInstant(receipt.issuedAt, "Contribution Receipt issuedAt");
  requireString(receipt.policyVersion, "Contribution Receipt policyVersion", 120);
  requireIdentifier(receipt.issuerKeyId, "Contribution Receipt issuerKeyId");
  requireBase64Url(receipt.issuerPublicKey, 32, "Contribution Receipt issuerPublicKey");

  const normalized = {
    protocolVersion: contributionReceiptProtocolVersion,
    id: receipt.id,
    kind: receipt.kind,
    beneficiary,
    attempt,
    target,
    artifactBundleHash: receipt.artifactBundleHash,
    bundle,
    run,
    claims,
    issuedAt: receipt.issuedAt,
    policyVersion: receipt.policyVersion,
    issuerKeyId: receipt.issuerKeyId,
    issuerPublicKey: receipt.issuerPublicKey,
  };
  if (!requireSignature) return Object.freeze(normalized);
  requireSha256(receipt.payloadHash, "Contribution Receipt payloadHash");
  requireBase64Url(receipt.issuerSignature, 64, "Contribution Receipt issuerSignature");
  return Object.freeze({ ...normalized, payloadHash: receipt.payloadHash, issuerSignature: receipt.issuerSignature });
}

function normalizeBeneficiary(value) {
  requireRecord(value, "Contribution Receipt beneficiary");
  rejectExtraKeys(value, ["personId", "agentId", "delegationCertificateId"], "Contribution Receipt beneficiary");
  requireIdentifier(value.personId, "Contribution Receipt beneficiary personId");
  requireIdentifier(value.agentId, "Contribution Receipt beneficiary agentId");
  requireIdentifier(value.delegationCertificateId, "Contribution Receipt beneficiary delegationCertificateId");
  return Object.freeze({ ...value });
}

function normalizeAttempt(value) {
  requireRecord(value, "Contribution Receipt attempt");
  rejectExtraKeys(value, ["id", "personId", "agentId", "delegationCertificateId", "problemRevisionId"], "Contribution Receipt attempt");
  for (const [label, field] of Object.entries(value)) {
    requireIdentifier(field, `Contribution Receipt attempt ${label}`);
  }
  return Object.freeze({ ...value });
}

function normalizeTarget(value) {
  requireRecord(value, "Contribution Receipt target");
  rejectExtraKeys(value, ["declaration", "statementHash"], "Contribution Receipt target");
  if (typeof value.declaration !== "string" || !/^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*$/.test(value.declaration)) {
    throw new ContributionReceiptProtocolError("Contribution Receipt target declaration must be a Lean qualified name.");
  }
  requireSha256(value.statementHash, "Contribution Receipt target statementHash");
  return Object.freeze({ ...value });
}

function normalizeBundle(value) {
  requireRecord(value, "Contribution Receipt bundle");
  rejectExtraKeys(value, ["manifestHash", "dependencyReceipts"], "Contribution Receipt bundle");
  requireSha256(value.manifestHash, "Contribution Receipt bundle manifestHash");
  if (!Array.isArray(value.dependencyReceipts)) {
    throw new ContributionReceiptProtocolError("Contribution Receipt dependencyReceipts must be an array.");
  }
  const dependencyReceipts = value.dependencyReceipts.map((dependency) => {
    requireRecord(dependency, "Contribution Receipt dependency receipt");
    rejectExtraKeys(dependency, ["receiptId", "receiptHash"], "Contribution Receipt dependency receipt");
    requireIdentifier(dependency.receiptId, "Contribution Receipt dependency receiptId");
    requireSha256(dependency.receiptHash, "Contribution Receipt dependency receiptHash");
    return Object.freeze({ ...dependency });
  }).sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  if (new Set(dependencyReceipts.map((dependency) => dependency.receiptId)).size !== dependencyReceipts.length) {
    throw new ContributionReceiptProtocolError("Contribution Receipt dependency receipt ids must be unique.");
  }
  return Object.freeze({ manifestHash: value.manifestHash, dependencyReceipts: Object.freeze(dependencyReceipts) });
}

function normalizeRun(value) {
  requireRecord(value, "Contribution Receipt run");
  rejectExtraKeys(value, ["id", "requestHash", "resultHash", "status", "kernelStatus"], "Contribution Receipt run");
  requireIdentifier(value.id, "Contribution Receipt run id");
  requireSha256(value.requestHash, "Contribution Receipt run requestHash");
  requireSha256(value.resultHash, "Contribution Receipt run resultHash");
  if (![
    "succeeded", "failed", "timed_out", "rejected", "cancelled",
  ].includes(value.status)) {
    throw new ContributionReceiptProtocolError("Contribution Receipt run status is invalid.");
  }
  if (!["accepted", "rejected", "not_run"].includes(value.kernelStatus)) {
    throw new ContributionReceiptProtocolError("Contribution Receipt run kernelStatus is invalid.");
  }
  return Object.freeze({ ...value });
}

function normalizeClaims(value, artifactBundleHash) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    throw new ContributionReceiptProtocolError("Contribution Receipt claims must be a bounded non-empty array.");
  }
  const claims = value.map((claim) => {
    requireRecord(claim, "Contribution Receipt claim");
    rejectExtraKeys(claim, [
      "claimType", "verificationAttestationId", "verificationAttestationHash",
      "artifactBundleHash", "reviewerPersonId", "reviewerAgentId",
      "reviewerDelegationCertificateId", "decision",
    ], "Contribution Receipt claim");
    if (!verificationClaimTypes.includes(claim.claimType)) {
      throw new ContributionReceiptProtocolError("Contribution Receipt claim type is invalid.");
    }
    requireIdentifier(claim.verificationAttestationId, "Contribution Receipt verificationAttestationId");
    requireSha256(claim.verificationAttestationHash, "Contribution Receipt verificationAttestationHash");
    requireSha256(claim.artifactBundleHash, "Contribution Receipt claim artifactBundleHash");
    if (claim.artifactBundleHash !== artifactBundleHash) {
      throw new ContributionReceiptProtocolError("Contribution Receipt claim must reference the receipt Artifact Bundle.");
    }
    requireIdentifier(claim.reviewerPersonId, "Contribution Receipt reviewerPersonId");
    requireIdentifier(claim.reviewerAgentId, "Contribution Receipt reviewerAgentId");
    requireIdentifier(claim.reviewerDelegationCertificateId, "Contribution Receipt reviewerDelegationCertificateId");
    if (claim.decision !== "attested") {
      throw new ContributionReceiptProtocolError("Contribution Receipt can only cover attested verification claims.");
    }
    return Object.freeze({ ...claim });
  }).sort((left, right) => left.verificationAttestationId.localeCompare(right.verificationAttestationId));
  if (new Set(claims.map((claim) => claim.verificationAttestationId)).size !== claims.length) {
    throw new ContributionReceiptProtocolError("Contribution Receipt verification attestation ids must be unique.");
  }
  return Object.freeze(claims);
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new ContributionReceiptProtocolError(`${label} contains unsupported field ${extra}.`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContributionReceiptProtocolError(`${label} must be an object.`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/.test(value)) {
    throw new ContributionReceiptProtocolError(`${label} must be a bounded identifier.`);
  }
}

function requireString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ContributionReceiptProtocolError(`${label} must be a non-empty string.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ContributionReceiptProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ContributionReceiptProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireBase64Url(value, byteLength, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ContributionReceiptProtocolError(`${label} must be unpadded base64url.`);
  }
  if (fromBase64Url(value).byteLength !== byteLength) {
    throw new ContributionReceiptProtocolError(`${label} has an invalid length.`);
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
