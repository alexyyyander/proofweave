import { getD1 } from "@/db";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  normalizeContributionReceipt,
  verifyContributionReceiptSignature,
} from "@/packages/protocol/contribution-receipt.mjs";

export type ContributionReceiptKind =
  | "formalization"
  | "lemma"
  | "proof_patch"
  | "counterexample"
  | "verification"
  | "synthesis"
  | "infrastructure";

export type PublicContributionReceipt = Readonly<{
  protocolVersion: "pw-contribution-receipt-v1";
  id: string;
  kind: ContributionReceiptKind;
  beneficiary: Readonly<{
    personId: string;
    agentId: string;
    delegationCertificateId: string;
  }>;
  attempt: Readonly<{
    id: string;
    personId: string;
    agentId: string;
    delegationCertificateId: string;
    problemRevisionId: string;
  }>;
  target: Readonly<{ declaration: string; statementHash: string }>;
  artifactBundleHash: string;
  bundle: Readonly<{
    manifestHash: string;
    dependencyReceipts: readonly Readonly<{ receiptId: string; receiptHash: string }>[];
  }>;
  run: Readonly<{
    id: string;
    requestHash: string;
    resultHash: string;
    status: "succeeded";
    kernelStatus: "accepted";
  }>;
  claims: readonly Readonly<{
    claimType: string;
    verificationAttestationId: string;
    verificationAttestationHash: string;
    artifactBundleHash: string;
    reviewerPersonId: string;
    reviewerAgentId: string;
    reviewerDelegationCertificateId: string;
    decision: "attested";
  }>[];
  issuedAt: string;
  policyVersion: "pw-receipt-policy-v1";
  issuerKeyId: string;
  issuerPublicKey: string;
  payloadHash: string;
  issuerSignature: string;
}>;

export type PublicContributionReceiptRecord = Readonly<{
  receipt: PublicContributionReceipt;
  receiptHash: string;
}>;

export class ContributionReceiptIntegrityError extends Error {
  constructor() {
    super("Stored Contribution Receipt did not pass its canonical hash and issuer-signature checks.");
    this.name = "ContributionReceiptIntegrityError";
  }
}

export interface ContributionReceiptReader {
  findById(id: string): Promise<PublicContributionReceiptRecord | null>;
}

type ReceiptRow = {
  id: string;
  receipt_hash: string;
  canonical_receipt: string;
};

/**
 * Public reads are deliberately stricter than a raw D1 lookup: a page or API
 * never presents a receipt unless its stored canonical payload, full hash, and
 * embedded issuer signature agree.
 */
class D1ContributionReceiptReader implements ContributionReceiptReader {
  async findById(id: string): Promise<PublicContributionReceiptRecord | null> {
    if (!isContributionReceiptId(id)) return null;

    const row = await getD1()
      .prepare(
        "SELECT id, receipt_hash, canonical_receipt FROM contribution_receipts WHERE id = ?",
      )
      .bind(id)
      .first<ReceiptRow>();
    if (!row) return null;

    const receipt = parseStoredReceipt(row);
    try {
      if (
        receipt.id !== id ||
        row.id !== id ||
        row.receipt_hash !== await contributionReceiptHash(receipt) ||
        !await verifyContributionReceiptSignature(receipt)
      ) {
        throw new ContributionReceiptIntegrityError();
      }
      assertContributionReceiptPolicy(receipt);
    } catch {
      throw new ContributionReceiptIntegrityError();
    }

    return Object.freeze({ receipt, receiptHash: row.receipt_hash });
  }
}

export function getContributionReceiptReader(): ContributionReceiptReader {
  return new D1ContributionReceiptReader();
}

function parseStoredReceipt(row: ReceiptRow): PublicContributionReceipt {
  try {
    return normalizeContributionReceipt(
      JSON.parse(row.canonical_receipt),
    ) as unknown as PublicContributionReceipt;
  } catch {
    throw new ContributionReceiptIntegrityError();
  }
}

function isContributionReceiptId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/.test(value);
}
