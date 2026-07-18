import { canonicalJson, sha256Canonical } from "./canonical-json.mjs";

export const receiptCreditPolicyVersion = "pw-receipt-credit-v1";
export const receiptCreditUnit = "non_transferable_research_credit";
export const receiptCreditCategories = Object.freeze([
  "certified_receipt",
  "formalization",
  "lemma",
  "proof_progress",
  "counterexample",
  "verification",
  "synthesis",
  "infrastructure",
  "downstream_impact",
]);

const kindCategory = Object.freeze({
  formalization: "formalization",
  lemma: "lemma",
  proof_patch: "proof_progress",
  counterexample: "counterexample",
  verification: "verification",
  synthesis: "synthesis",
  infrastructure: "infrastructure",
});

/**
 * Deterministically project one already verified Receipt into atomic,
 * non-transferable credit entries. One unit means one Receipt-backed fact; it
 * is deliberately not a monetary amount or a share of a token pool.
 */
export async function deriveReceiptCreditSettlement({ receipt, receiptHash, dependencyBeneficiaries = [] }) {
  requireRecord(receipt, "receipt");
  requireIdentifier(receipt.id, "receipt.id");
  requireSha256(receiptHash, "receiptHash");
  requireIdentifier(receipt.beneficiary?.personId, "receipt beneficiary Person");
  requireUtcInstant(receipt.issuedAt, "receipt.issuedAt");
  const category = kindCategory[receipt.kind];
  if (!category) throw new ReceiptCreditProtocolError("Receipt kind cannot be projected into research credit.");

  const drafts = [
    entryDraft({ receipt, personId: receipt.beneficiary.personId, category: "certified_receipt", reasonKey: `receipt:${receipt.id}`, sourceReceiptId: receipt.id }),
    entryDraft({ receipt, personId: receipt.beneficiary.personId, category, reasonKey: `kind:${receipt.kind}`, sourceReceiptId: receipt.id }),
  ];
  for (const claim of [...receipt.claims].sort((left, right) => left.verificationAttestationId.localeCompare(right.verificationAttestationId))) {
    drafts.push(entryDraft({
      receipt,
      personId: claim.reviewerPersonId,
      category: "verification",
      reasonKey: `attestation:${claim.verificationAttestationId}`,
      sourceReceiptId: receipt.id,
    }));
  }
  const dependencyById = new Map(dependencyBeneficiaries.map((entry) => [entry.receiptId, entry]));
  for (const dependency of [...receipt.bundle.dependencyReceipts].sort((left, right) => left.receiptId.localeCompare(right.receiptId))) {
    const beneficiary = dependencyById.get(dependency.receiptId);
    if (!beneficiary || beneficiary.receiptHash !== dependency.receiptHash) {
      throw new ReceiptCreditProtocolError("Every dependency credit must resolve to the exact verified upstream Receipt beneficiary.");
    }
    drafts.push(entryDraft({
      receipt,
      personId: beneficiary.personId,
      category: "downstream_impact",
      reasonKey: `dependency:${dependency.receiptId}`,
      sourceReceiptId: dependency.receiptId,
    }));
  }

  const entries = [];
  for (const draft of drafts.sort(compareEntryDrafts)) {
    const payloadHash = await sha256Canonical(draft);
    entries.push(Object.freeze({
      id: `credit-entry:${payloadHash.slice("sha256:".length)}`,
      ...draft,
      payloadHash,
      canonicalPayload: canonicalJson(draft),
    }));
  }
  const settlementDraft = Object.freeze({
    protocolVersion: "pw-receipt-credit-settlement-v1",
    receiptId: receipt.id,
    receiptHash,
    policyVersion: receiptCreditPolicyVersion,
    unit: receiptCreditUnit,
    entries: Object.freeze(entries.map((entry) => Object.freeze({ id: entry.id, payloadHash: entry.payloadHash }))),
    settledAt: receipt.issuedAt,
  });
  const payloadHash = await sha256Canonical(settlementDraft);
  return Object.freeze({
    ...settlementDraft,
    payloadHash,
    canonicalPayload: canonicalJson(settlementDraft),
    entries: Object.freeze(entries),
  });
}

function entryDraft({ receipt, personId, category, reasonKey, sourceReceiptId }) {
  requireIdentifier(personId, "credit Person");
  requireIdentifier(sourceReceiptId, "credit source Receipt");
  if (!receiptCreditCategories.includes(category)) throw new ReceiptCreditProtocolError("Credit category is unsupported.");
  if (typeof reasonKey !== "string" || reasonKey.length === 0 || reasonKey.length > 520) {
    throw new ReceiptCreditProtocolError("Credit reason key must be bounded.");
  }
  return Object.freeze({
    protocolVersion: "pw-receipt-credit-entry-v1",
    receiptId: receipt.id,
    personId,
    category,
    units: 1,
    reasonKey,
    sourceReceiptId,
    policyVersion: receiptCreditPolicyVersion,
    unit: receiptCreditUnit,
    occurredAt: receipt.issuedAt,
  });
}

function compareEntryDrafts(left, right) {
  return left.personId.localeCompare(right.personId)
    || left.category.localeCompare(right.category)
    || left.reasonKey.localeCompare(right.reasonKey);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReceiptCreditProtocolError(`${label} must be an object.`);
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,519}$/.test(value)) {
    throw new ReceiptCreditProtocolError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) throw new ReceiptCreditProtocolError(`${label} must be a SHA-256 digest.`);
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ReceiptCreditProtocolError(`${label} must be a UTC timestamp.`);
  }
}

export class ReceiptCreditProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReceiptCreditProtocolError";
  }
}
