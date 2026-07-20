export const receiptPublicationPolicyVersion = "pw-receipt-publication-policy-v1";

const allowedRecordClasses = new Set(["research", "demo", "smoke_test"]);
const allowedVisibility = new Set(["public", "unlisted", "internal"]);

/**
 * Publication is deliberately outside the signed Receipt payload. A Receipt
 * can remain valid evidence while its product surface stays demo-only or
 * internal. Known test identities and targets can never opt themselves into
 * the public research index.
 */
export function classifyReceiptPublication(receipt, requested) {
  const markers = [
    receipt?.id,
    receipt?.target?.declaration,
    receipt?.beneficiary?.personId,
    receipt?.beneficiary?.agentId,
    receipt?.attempt?.id,
  ].filter((value) => typeof value === "string").join("\n").toLowerCase();

  if (markers.includes("proofweavecloudsmoke.") || markerToken(markers, "smoke") || markerToken(markers, "mock")) {
    return freezePublication({
      recordClass: "smoke_test",
      visibility: "internal",
      reason: "smoke_or_mock_marker",
      classifiedAt: receipt.issuedAt,
    });
  }
  if (markerToken(markers, "demo")) {
    return freezePublication({
      recordClass: "demo",
      visibility: "unlisted",
      reason: "demo_marker",
      classifiedAt: receipt.issuedAt,
    });
  }

  if (requested !== undefined) {
    if (!requested || typeof requested !== "object" || Array.isArray(requested)) {
      throw new TypeError("Receipt publication request must be an object.");
    }
    if (!allowedRecordClasses.has(requested.recordClass) || !allowedVisibility.has(requested.visibility)) {
      throw new TypeError("Receipt publication request has an unsupported class or visibility.");
    }
    if (requested.recordClass !== "research" && requested.visibility === "public") {
      throw new TypeError("Only research Receipts may enter the public contribution index.");
    }
    return freezePublication({
      recordClass: requested.recordClass,
      visibility: requested.visibility,
      reason: "issuer_requested",
      classifiedAt: receipt.issuedAt,
    });
  }

  return freezePublication({
    recordClass: "research",
    visibility: "public",
    reason: "research_default",
    classifiedAt: receipt.issuedAt,
  });
}

function markerToken(value, token) {
  return new RegExp(`(?:^|[:._/-])${token}(?:$|[:._/-])`, "i").test(value);
}

function freezePublication({ recordClass, visibility, reason, classifiedAt }) {
  return Object.freeze({
    recordClass,
    visibility,
    policyVersion: receiptPublicationPolicyVersion,
    reason,
    classifiedAt,
  });
}
