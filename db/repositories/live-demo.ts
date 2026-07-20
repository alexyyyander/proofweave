import { getSharedResearchD1 } from "@/db";
import { contributionReceiptHash } from "@/packages/protocol/contribution-receipt.mjs";
import { D1ContributionReceiptStore } from "@/services/receipts/d1-contribution-receipt-store.mjs";

export type LiveBuildWeekClosure = Readonly<{
  receiptId: string;
  receiptHash: string;
  issuedAt: string;
  target: string;
  ownerPersonId: string;
  runId: string;
  resultHash: string;
  reviewers: readonly Readonly<{
    personId: string;
    displayName: string;
  }>[];
  reviewerCount: number;
  attestationCount: number;
  replayRunId: string;
  replayEvidenceHash: string;
}>;

type ReceiptRow = {
  receipt_id: string;
  attestation_count: number;
  reviewer_count: number;
  record_class: "smoke_test";
  visibility: "internal";
};

type ReviewerRow = {
  person_id: string;
  display_name: string;
};

type LiveReviewer = Readonly<{
  personId: string;
  displayName: string;
}>;

type ReplayRow = {
  replay_run_id: string;
  replay_evidence_hash: string;
};

export async function latestLiveBuildWeekClosure(): Promise<LiveBuildWeekClosure | null> {
  const database = getSharedResearchD1();
  const receipt = await database.prepare(
    `SELECT receipt.id AS receipt_id,
            publication.record_class,
            publication.visibility,
            COUNT(DISTINCT attestation.id) AS attestation_count,
            COUNT(DISTINCT reviewer.id) AS reviewer_count
     FROM contribution_receipts AS receipt
     INNER JOIN contribution_receipt_publications AS publication
       ON publication.receipt_id = receipt.id
     INNER JOIN json_each(receipt.canonical_receipt, '$.claims') AS receipt_claim
     INNER JOIN verification_attestations AS attestation
       ON attestation.id = json_extract(receipt_claim.value, '$.verificationAttestationId')
      AND attestation.claim_type = json_extract(receipt_claim.value, '$.claimType')
      AND attestation.artifact_bundle_manifest_hash = receipt.artifact_bundle_manifest_hash
      AND attestation.decision = 'attested'
     INNER JOIN persons AS reviewer ON reviewer.id = attestation.verifier_person_id
     WHERE receipt.kind <> 'verification'
       AND publication.record_class = 'smoke_test'
       AND publication.visibility = 'internal'
       AND reviewer.identity_provider = 'proofweave-demo'
       AND attestation.claim_type IN ('bundle_reproducible','kernel_accepted','project_accepted')
     GROUP BY receipt.id
     HAVING COUNT(DISTINCT CASE
       WHEN attestation.claim_type IN ('bundle_reproducible','kernel_accepted','project_accepted')
       THEN attestation.claim_type END) = 3
     ORDER BY receipt.issued_at DESC, receipt.id DESC
     LIMIT 1`,
  ).first<ReceiptRow>();
  if (!receipt) return null;

  // A convenient SQL projection is not a trust decision. The internal store
  // rechecks canonical evidence, issuer authorization, signatures, and Receipt
  // policy. Publication classification is checked separately above: this run
  // may demonstrate the protocol, but it is never a public math contribution.
  const internalReceipt = await new D1ContributionReceiptStore(database)
    .loadVerifiedReceipt(receipt.receipt_id);
  const verifiedReceiptHash = await contributionReceiptHash(internalReceipt);

  const reviewerRows = await database.prepare(
    `SELECT DISTINCT reviewer.id AS person_id, reviewer.display_name
     FROM contribution_receipts AS receipt
     INNER JOIN json_each(receipt.canonical_receipt, '$.claims') AS receipt_claim
     INNER JOIN verification_attestations AS attestation
       ON attestation.id = json_extract(receipt_claim.value, '$.verificationAttestationId')
      AND attestation.claim_type = json_extract(receipt_claim.value, '$.claimType')
      AND attestation.artifact_bundle_manifest_hash = receipt.artifact_bundle_manifest_hash
      AND attestation.decision = 'attested'
      AND attestation.claim_type IN ('bundle_reproducible','kernel_accepted','project_accepted')
     INNER JOIN persons AS reviewer ON reviewer.id = attestation.verifier_person_id
     WHERE receipt.id = ? AND reviewer.identity_provider = 'proofweave-demo'
     ORDER BY reviewer.id ASC`,
  ).bind(receipt.receipt_id).all<ReviewerRow>();
  const reviewers: LiveReviewer[] = ((reviewerRows.results ?? []) as ReviewerRow[]).map((reviewer: ReviewerRow) => Object.freeze({
    personId: reviewer.person_id,
    displayName: reviewer.display_name,
  }));

  const replay = await database.prepare(
    `SELECT replay.run_id AS replay_run_id,
            evidence.evidence_hash AS replay_evidence_hash
     FROM contribution_receipts AS receipt
     INNER JOIN json_each(receipt.canonical_receipt, '$.claims') AS receipt_claim
     INNER JOIN verification_attestations AS attestation
       ON attestation.id = json_extract(receipt_claim.value, '$.verificationAttestationId')
      AND attestation.artifact_bundle_manifest_hash = receipt.artifact_bundle_manifest_hash
      AND attestation.claim_type = 'bundle_reproducible'
      AND attestation.decision = 'attested'
     INNER JOIN verification_assignments AS assignment ON assignment.id = attestation.assignment_id
     INNER JOIN verification_replays AS replay ON replay.assignment_id = assignment.id
     INNER JOIN verification_replay_evidence AS evidence ON evidence.replay_id = replay.id
     WHERE receipt.id = ?
     ORDER BY evidence.recorded_at DESC, evidence.id DESC LIMIT 1`,
  ).bind(receipt.receipt_id).first<ReplayRow>();
  if (!replay) return null;
  const publicReceipt = internalReceipt;
  if (
    !isIdentifier(receipt.receipt_id) || !isSha256(verifiedReceiptHash) ||
    !isIdentifier(publicReceipt.run.id) || !isSha256(publicReceipt.run.resultHash) ||
    !isIdentifier(replay.replay_run_id) || !isSha256(replay.replay_evidence_hash) ||
    !isIdentifier(publicReceipt.beneficiary.personId) ||
    typeof publicReceipt.target.declaration !== "string" || publicReceipt.target.declaration.length === 0 ||
    reviewers.some((reviewer) => (
      !isIdentifier(reviewer.personId) || typeof reviewer.displayName !== "string" || reviewer.displayName.length === 0
    )) ||
    !Number.isSafeInteger(Number(receipt.reviewer_count)) || Number(receipt.reviewer_count) < 1 ||
    reviewers.length !== Number(receipt.reviewer_count) ||
    !Number.isSafeInteger(Number(receipt.attestation_count)) || Number(receipt.attestation_count) < 3
  ) return null;

  return Object.freeze({
    receiptId: receipt.receipt_id,
    receiptHash: verifiedReceiptHash,
    issuedAt: publicReceipt.issuedAt,
    target: publicReceipt.target.declaration,
    ownerPersonId: publicReceipt.beneficiary.personId,
    runId: publicReceipt.run.id,
    resultHash: publicReceipt.run.resultHash,
    reviewers: Object.freeze(reviewers),
    reviewerCount: Number(receipt.reviewer_count),
    attestationCount: Number(receipt.attestation_count),
    replayRunId: replay.replay_run_id,
    replayEvidenceHash: replay.replay_evidence_hash,
  });
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240 && !/[\0\r\n]/.test(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}
