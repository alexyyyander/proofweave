import {
  contributionReceiptVerificationBundleHash,
  normalizeContributionReceiptIssuerKeyset,
  normalizeContributionReceiptVerificationBundle,
  verifyContributionReceiptVerificationBundle,
  verifyContributionReceiptVerificationBundleWithIssuerKeyset,
} from "@/packages/protocol/contribution-receipt-verification-bundle.mjs";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  verifyContributionReceiptSignature,
} from "@/packages/protocol/contribution-receipt.mjs";

/**
 * Re-runs the published receipt protocol against a downloaded bundle. The
 * result is pure data so the same checks can be exercised without a browser.
 *
 * Identity is checked before any cryptographic gate: a bundle is only evidence
 * for the receipt this page shows, so a valid but substituted bundle must fail
 * rather than report "all checks passed" on the wrong record.
 */
export type ReceiptGateId =
  | "bundle"
  | "identity"
  | "hash"
  | "signature"
  | "policy"
  | "closure"
  | "keys";

export type ReceiptGateStatus = "passed" | "failed" | "unavailable";

export type ReceiptGateResult = Readonly<{
  id: ReceiptGateId;
  status: ReceiptGateStatus;
  error?: string;
}>;

export type ReceiptVerdict = "passed" | "failed" | "partial";

export type ReceiptVerificationResult = Readonly<{
  gates: readonly ReceiptGateResult[];
  verdict: ReceiptVerdict;
  bundleHash: string | null;
  receiptHash: string | null;
  receipts: number;
  issuerKeys: number;
  retiredIssuerKeys: number;
}>;

export type ReceiptVerificationInput = Readonly<{
  receiptId: string;
  receiptHash?: string;
  bundle: unknown;
  currentKeyset: unknown | null;
  /** Called as each gate settles, so the UI can show progress without owning the checks. */
  onGate?: (gate: ReceiptGateResult) => void;
}>;

type NormalizedBundle = Readonly<{
  rootReceiptId: string;
  receipts: readonly Readonly<{
    receipt: Readonly<{ id: string }> & Record<string, unknown>;
    receiptHash: string;
  }>[];
  issuerKeys: readonly Readonly<{ id: string }>[];
}>;

type NormalizedKeyset = Readonly<{
  issuerKeys: readonly Readonly<{ id: string; status: "active" | "retired" | "revoked" }>[];
}>;

function reasonOf(cause: unknown): string | undefined {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message;
  return undefined;
}

function finish(
  gates: ReceiptGateResult[],
  extras: Omit<ReceiptVerificationResult, "gates" | "verdict">,
): ReceiptVerificationResult {
  const failed = gates.some((gate) => gate.status === "failed");
  const partial = !failed && gates.some((gate) => gate.status === "unavailable");
  return Object.freeze({
    gates: Object.freeze(gates),
    verdict: failed ? "failed" : partial ? "partial" : "passed",
    ...extras,
  });
}

export async function verifyReceiptBundle({
  receiptId,
  receiptHash: expectedReceiptHash,
  bundle: rawBundle,
  currentKeyset,
  onGate,
}: ReceiptVerificationInput): Promise<ReceiptVerificationResult> {
  const gates: ReceiptGateResult[] = [];
  const push = (gate: ReceiptGateResult) => {
    gates.push(gate);
    onGate?.(gate);
  };
  const totals = {
    bundleHash: null as string | null,
    receiptHash: null as string | null,
    receipts: 0,
    issuerKeys: 0,
    retiredIssuerKeys: 0,
  };

  let bundle: NormalizedBundle;
  try {
    bundle = normalizeContributionReceiptVerificationBundle(rawBundle) as NormalizedBundle;
  } catch (cause) {
    push({ id: "bundle", status: "failed", error: reasonOf(cause) });
    return finish(gates, totals);
  }
  totals.receipts = bundle.receipts.length;
  totals.issuerKeys = bundle.issuerKeys.length;
  push({ id: "bundle", status: "passed" });

  const root = bundle.receipts.find((entry) => entry.receipt.id === bundle.rootReceiptId);
  totals.receiptHash = root?.receiptHash ?? null;
  if (!root) {
    push({ id: "identity", status: "failed", error: `Bundle has no root record for ${bundle.rootReceiptId}.` });
    return finish(gates, totals);
  }
  if (bundle.rootReceiptId !== receiptId) {
    push({
      id: "identity",
      status: "failed",
      error: `Bundle roots at ${bundle.rootReceiptId}, not ${receiptId}.`,
    });
    return finish(gates, totals);
  }
  if (expectedReceiptHash && root.receiptHash !== expectedReceiptHash) {
    push({
      id: "identity",
      status: "failed",
      error: `Bundle carries ${root.receiptHash}, not the receipt shown here (${expectedReceiptHash}).`,
    });
    return finish(gates, totals);
  }
  push({ id: "identity", status: "passed" });

  const recomputed = await contributionReceiptHash(root.receipt);
  if (recomputed !== root.receiptHash) {
    push({ id: "hash", status: "failed", error: `${recomputed} ≠ ${root.receiptHash}` });
    return finish(gates, totals);
  }
  push({ id: "hash", status: "passed" });

  if (!await verifyContributionReceiptSignature(root.receipt)) {
    push({ id: "signature", status: "failed" });
    return finish(gates, totals);
  }
  push({ id: "signature", status: "passed" });

  try {
    assertContributionReceiptPolicy(root.receipt);
  } catch (cause) {
    push({ id: "policy", status: "failed", error: reasonOf(cause) });
    return finish(gates, totals);
  }
  push({ id: "policy", status: "passed" });

  try {
    await verifyContributionReceiptVerificationBundle(rawBundle);
  } catch (cause) {
    push({ id: "closure", status: "failed", error: reasonOf(cause) });
    return finish(gates, totals);
  }
  push({ id: "closure", status: "passed" });
  totals.bundleHash = await contributionReceiptVerificationBundleHash(rawBundle);

  if (!currentKeyset) {
    push({ id: "keys", status: "unavailable" });
    return finish(gates, totals);
  }
  try {
    await verifyContributionReceiptVerificationBundleWithIssuerKeyset(rawBundle, currentKeyset);
  } catch (cause) {
    push({ id: "keys", status: "failed", error: reasonOf(cause) });
    return finish(gates, totals);
  }
  const keyset = normalizeContributionReceiptIssuerKeyset(currentKeyset) as NormalizedKeyset;
  const bundleKeyIds = new Set(bundle.issuerKeys.map((key) => key.id));
  totals.retiredIssuerKeys = keyset.issuerKeys.filter((key) => bundleKeyIds.has(key.id) && key.status === "retired").length;
  push({ id: "keys", status: "passed" });
  return finish(gates, totals);
}
