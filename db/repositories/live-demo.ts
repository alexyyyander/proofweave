import { getSharedResearchD1 } from "@/db";
import { getContributionReceiptReaderFor } from "@/db/repositories/receipts";

export type LiveBuildWeekClosure = Readonly<{
  receiptId: string;
  receiptHash: string;
  issuedAt: string;
  target: string;
  ownerPersonId: string;
  runId: string;
  resultHash: string;
  reviewerPersonId: string;
  reviewerDisplayName: string;
  attestationCount: number;
  replayRunId: string;
  replayEvidenceHash: string;
}>;

type ReceiptRow = {
  receipt_id: string;
  reviewer_person_id: string;
  reviewer_display_name: string;
  attestation_count: number;
};

type ReplayRow = {
  replay_run_id: string;
  replay_evidence_hash: string;
};

export async function latestLiveBuildWeekClosure(): Promise<LiveBuildWeekClosure | null> {
  const database = getSharedResearchD1();
  const receipt = await database.prepare(
    `SELECT receipt.id AS receipt_id, reviewer.id AS reviewer_person_id,
            reviewer.display_name AS reviewer_display_name,
            COUNT(DISTINCT attestation.id) AS attestation_count
     FROM contribution_receipts AS receipt
     INNER JOIN verification_attestations AS attestation
       ON attestation.artifact_bundle_manifest_hash = receipt.artifact_bundle_manifest_hash
      AND attestation.decision = 'attested'
     INNER JOIN persons AS reviewer ON reviewer.id = attestation.verifier_person_id
     WHERE receipt.kind <> 'verification'
       AND reviewer.identity_provider = 'proofweave-demo'
     GROUP BY receipt.id, reviewer.id
     HAVING COUNT(DISTINCT CASE
       WHEN attestation.claim_type IN ('bundle_reproducible','kernel_accepted','project_accepted')
       THEN attestation.claim_type END) = 3
     ORDER BY receipt.issued_at DESC, receipt.id DESC
     LIMIT 1`,
  ).first<ReceiptRow>();
  if (!receipt) return null;

  // A convenient SQL projection is not a trust decision. The public reader
  // rechecks the canonical hash, issuer signature, Receipt policy, and
  // historical issuer-key authorization before this page may say "live".
  const verifiedReceipt = await getContributionReceiptReaderFor(database).findById(receipt.receipt_id);
  if (!verifiedReceipt) return null;

  const replay = await database.prepare(
    `SELECT replay.run_id AS replay_run_id,
            evidence.evidence_hash AS replay_evidence_hash
     FROM contribution_receipts AS receipt
     INNER JOIN verification_assignments AS assignment
       ON assignment.artifact_bundle_manifest_hash = receipt.artifact_bundle_manifest_hash
      AND assignment.claim_type = 'bundle_reproducible'
      AND assignment.verifier_person_id = ?
     INNER JOIN verification_replays AS replay ON replay.assignment_id = assignment.id
     INNER JOIN verification_replay_evidence AS evidence ON evidence.replay_id = replay.id
     WHERE receipt.id = ?
     ORDER BY evidence.recorded_at DESC, evidence.id DESC LIMIT 1`,
  ).bind(receipt.reviewer_person_id, receipt.receipt_id).first<ReplayRow>();
  if (!replay) return null;
  const publicReceipt = verifiedReceipt.receipt;
  if (
    !isIdentifier(receipt.receipt_id) || !isSha256(verifiedReceipt.receiptHash) ||
    !isIdentifier(publicReceipt.run.id) || !isSha256(publicReceipt.run.resultHash) ||
    !isIdentifier(replay.replay_run_id) || !isSha256(replay.replay_evidence_hash) ||
    !isIdentifier(publicReceipt.beneficiary.personId) || !isIdentifier(receipt.reviewer_person_id) ||
    typeof publicReceipt.target.declaration !== "string" || publicReceipt.target.declaration.length === 0 ||
    typeof receipt.reviewer_display_name !== "string" || receipt.reviewer_display_name.length === 0 ||
    !Number.isSafeInteger(Number(receipt.attestation_count)) || Number(receipt.attestation_count) < 3
  ) return null;

  return Object.freeze({
    receiptId: receipt.receipt_id,
    receiptHash: verifiedReceipt.receiptHash,
    issuedAt: publicReceipt.issuedAt,
    target: publicReceipt.target.declaration,
    ownerPersonId: publicReceipt.beneficiary.personId,
    runId: publicReceipt.run.id,
    resultHash: publicReceipt.run.resultHash,
    reviewerPersonId: receipt.reviewer_person_id,
    reviewerDisplayName: receipt.reviewer_display_name,
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
