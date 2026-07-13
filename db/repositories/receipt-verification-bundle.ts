import {
  getContributionReceiptReader,
  type ContributionReceiptReader,
  type PublicContributionReceipt,
  type PublicContributionReceiptIssuerKey,
  type PublicContributionReceiptLifecycleEvent,
} from "@/db/repositories/receipts";
import {
  contributionReceiptVerificationBundleProtocolVersion,
  verifyContributionReceiptVerificationBundle,
} from "@/packages/protocol/contribution-receipt-verification-bundle.mjs";

const maxReceiptClosure = 128;

export type ContributionReceiptVerificationBundle = Readonly<{
  protocolVersion: "pw-contribution-receipt-verification-bundle-v1";
  rootReceiptId: string;
  receipts: readonly Readonly<{
    receipt: PublicContributionReceipt;
    receiptHash: string;
    lifecycle: readonly PublicContributionReceiptLifecycleEvent[];
  }>[];
  issuerKeys: readonly PublicContributionReceiptIssuerKey[];
}>;

export class ContributionReceiptVerificationBundleIntegrityError extends Error {
  constructor(message = "The Contribution Receipt verification bundle could not be rebuilt from verified evidence.") {
    super(message);
    this.name = "ContributionReceiptVerificationBundleIntegrityError";
  }
}

/**
 * Rebuilds the complete public evidence closure from verified D1 projections.
 * It follows both declared upstream dependencies and signed replacement links,
 * so an offline verifier never needs to guess at a missing reference.
 */
export async function buildContributionReceiptVerificationBundle(
  rootReceiptId: string,
  reader: ContributionReceiptReader = getContributionReceiptReader(),
): Promise<ContributionReceiptVerificationBundle | null> {
  const root = await reader.findById(rootReceiptId);
  if (!root) return null;

  const records = new Map<string, Readonly<{
    receipt: PublicContributionReceipt;
    receiptHash: string;
    lifecycle: readonly PublicContributionReceiptLifecycleEvent[];
  }>>();
  const pending = [rootReceiptId];
  while (pending.length > 0) {
    const receiptId = pending.pop();
    if (!receiptId || records.has(receiptId)) continue;
    if (records.size >= maxReceiptClosure) {
      throw new ContributionReceiptVerificationBundleIntegrityError("Contribution Receipt evidence closure exceeds the portable bundle limit.");
    }
    const record = receiptId === rootReceiptId ? root : await reader.findById(receiptId);
    const lifecycle = await reader.findLifecycleById(receiptId);
    if (!record || !lifecycle) {
      throw new ContributionReceiptVerificationBundleIntegrityError(`Verified Receipt ${receiptId} is missing from its evidence closure.`);
    }
    const entry = Object.freeze({
      receipt: record.receipt,
      receiptHash: record.receiptHash,
      lifecycle,
    });
    records.set(receiptId, entry);
    for (const dependency of record.receipt.bundle.dependencyReceipts) pending.push(dependency.receiptId);
    for (const event of lifecycle) {
      if (event.replacementReceiptId) pending.push(event.replacementReceiptId);
    }
  }

  const entries = [...records.values()].sort((left, right) => compareIdentifier(left.receipt.id, right.receipt.id));
  const issuerKeyIds = new Set(entries.flatMap((entry) => [
    entry.receipt.issuerKeyId,
    ...entry.lifecycle.map((event) => event.issuerKeyId),
  ]));
  const bundle = {
    protocolVersion: contributionReceiptVerificationBundleProtocolVersion,
    rootReceiptId,
    receipts: entries,
    issuerKeys: (await reader.listIssuerKeys())
      .filter((key) => issuerKeyIds.has(key.id))
      .sort((left, right) => compareIdentifier(left.id, right.id)),
  } as const;
  try {
    return await verifyContributionReceiptVerificationBundle(bundle) as ContributionReceiptVerificationBundle;
  } catch {
    throw new ContributionReceiptVerificationBundleIntegrityError();
  }
}

function compareIdentifier(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
