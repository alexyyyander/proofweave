import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  normalizeLeanRunnerResult,
  verifyLeanRunnerResultSignature,
} from "../../packages/protocol/lean-runner.mjs";
import {
  normalizeVerificationAttestation,
  verifyVerificationAttestationSignature,
} from "../../packages/protocol/verification-attestation.mjs";
import {
  assertContributionReceiptPolicy,
  contributionReceiptHash,
  normalizeContributionReceipt,
  verifyContributionReceiptSignature,
} from "../../packages/protocol/contribution-receipt.mjs";
import { D1ContributionReceiptIssuerKeyStore } from "../receipts/d1-contribution-receipt-issuer-key-store.mjs";

export const researchEvidenceStages = Object.freeze([
  "shared",
  "bundle_staged",
  "kernel_accepted",
  "review_recorded",
  "receipt_recorded",
]);

/**
 * Read immutable evidence for already-public checkpoints. This projection never
 * mutates a node's `shared_unverified` state: each stronger label is backed by
 * a separately verified Bundle, Runner result, review attestation, or Receipt.
 */
export async function loadResearchNodeEvidence(database, nodes) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("Research node evidence projection requires a D1 database binding.");
  }
  if (!Array.isArray(nodes) || nodes.length === 0) return Object.freeze([]);
  const bundleHashes = [...new Set(nodes.map((node) => node.artifactBundleHash).filter(Boolean))];
  if (bundleHashes.length === 0) {
    return Object.freeze(nodes.map((node) => Object.freeze({ ...node, evidence: emptyEvidence() })));
  }
  const placeholders = bundleHashes.map(() => "?").join(",");
  const [runRows, runnerKeyRows, attestationRows, receiptRows] = await Promise.all([
    database.prepare(
      `SELECT run.id, run.attempt_id, run.artifact_bundle_hash, run.request_hash,
              run.state, run.finished_at, run.runner_result_hash,
              result.result_hash, result.canonical_result, result.received_at
       FROM runs AS run
       LEFT JOIN run_results AS result ON result.run_id = run.id
       WHERE run.artifact_bundle_hash IN (${placeholders})
       ORDER BY run.finished_at DESC, run.id ASC`,
    ).bind(...bundleHashes).all(),
    database.prepare("SELECT id, public_key FROM runner_keys").all(),
    database.prepare(
      `SELECT id, assignment_id, artifact_bundle_manifest_hash, claim_type,
              verifier_person_id, verifier_agent_id, delegation_certificate_id,
              verifier_agent_public_key, decision, evidence_hash, canonical_payload,
              payload_hash, signature, attested_at
       FROM verification_attestations
       WHERE artifact_bundle_manifest_hash IN (${placeholders}) AND decision = 'attested'
       ORDER BY attested_at ASC, id ASC`,
    ).bind(...bundleHashes).all(),
    database.prepare(
      `SELECT id, receipt_hash, canonical_receipt
       FROM contribution_receipts
       WHERE artifact_bundle_manifest_hash IN (${placeholders})
       ORDER BY issued_at ASC, id ASC`,
    ).bind(...bundleHashes).all(),
  ]);
  const issuerKeys = new D1ContributionReceiptIssuerKeyStore(database);
  return projectResearchNodeEvidence({
    nodes,
    runRows: runRows.results ?? [],
    runnerKeyRows: runnerKeyRows.results ?? [],
    attestationRows: attestationRows.results ?? [],
    receiptRows: receiptRows.results ?? [],
    assertReceiptIssuerTrusted: (receipt) => issuerKeys.assertHistoricallyTrusted({
      issuerKeyId: receipt.issuerKeyId,
      issuerPublicKey: receipt.issuerPublicKey,
      occurredAt: receipt.issuedAt,
    }),
  });
}

/** Exported separately so cryptographic evidence projection can be tested. */
export async function projectResearchNodeEvidence({
  nodes,
  runRows = [],
  runnerKeyRows = [],
  attestationRows = [],
  receiptRows = [],
  assertReceiptIssuerTrusted = async () => {},
}) {
  const runnerKeys = new Map(runnerKeyRows.map((row) => [row.id, row.public_key]));
  const acceptedRuns = new Map();
  for (const row of runRows) {
    const run = await verifiedAcceptedRun(row, runnerKeys);
    if (!run) continue;
    const current = acceptedRuns.get(run.artifactBundleHash);
    if (!current || run.acceptedAt > current.acceptedAt) {
      acceptedRuns.set(run.artifactBundleHash, run);
    }
  }

  const attestationsByBundle = new Map();
  for (const row of attestationRows) {
    const attestation = await verifiedAttestation(row);
    if (!attestation) continue;
    const current = attestationsByBundle.get(attestation.artifactBundleHash) ?? [];
    current.push(attestation);
    attestationsByBundle.set(attestation.artifactBundleHash, current);
  }

  const receiptsByBundle = new Map();
  for (const row of receiptRows) {
    const receipt = await verifiedReceipt(row, assertReceiptIssuerTrusted);
    if (!receipt) continue;
    const current = receiptsByBundle.get(receipt.artifactBundleHash) ?? [];
    current.push(receipt);
    receiptsByBundle.set(receipt.artifactBundleHash, current);
  }

  return Object.freeze(nodes.map((node) => {
    const manifestHash = node.artifactBundleHash;
    if (!manifestHash) return Object.freeze({ ...node, evidence: emptyEvidence() });
    const lean = acceptedRuns.get(manifestHash) ?? null;
    const independentAttestations = (attestationsByBundle.get(manifestHash) ?? [])
      .filter((attestation) => attestation.verifierPersonId !== node.creator.personId);
    const receipt = (receiptsByBundle.get(manifestHash) ?? [])
      .find((candidate) => receiptMatchesNode(candidate, node)) ?? null;
    const review = independentAttestations.length === 0 ? null : Object.freeze({
      attestationCount: independentAttestations.length,
      reviewerCount: new Set(independentAttestations.map((entry) => entry.verifierPersonId)).size,
      claimTypes: Object.freeze([...new Set(independentAttestations.map((entry) => entry.claimType))].sort()),
      lastAttestedAt: independentAttestations.reduce(
        (latest, entry) => entry.attestedAt > latest ? entry.attestedAt : latest,
        independentAttestations[0].attestedAt,
      ),
    });
    const stage = receipt
      ? "receipt_recorded"
      : review
        ? "review_recorded"
        : lean
          ? "kernel_accepted"
          : "bundle_staged";
    return Object.freeze({
      ...node,
      evidence: Object.freeze({
        stage,
        bundle: Object.freeze({ manifestHash }),
        lean,
        review,
        receipt: receipt ? Object.freeze({
          id: receipt.id,
          receiptHash: receipt.receiptHash,
          kind: receipt.kind,
          issuedAt: receipt.issuedAt,
        }) : null,
      }),
    });
  }));
}

async function verifiedAcceptedRun(row, runnerKeys) {
  if (!row?.canonical_result || !row.result_hash || !row.runner_result_hash || !row.received_at) return null;
  try {
    const result = normalizeLeanRunnerResult(JSON.parse(row.canonical_result));
    const runnerPublicKey = runnerKeys.get(result.runnerKeyId);
    if (
      !runnerPublicKey || canonicalJson(result) !== row.canonical_result ||
      await sha256Canonical(result) !== row.result_hash || row.runner_result_hash !== row.result_hash ||
      result.jobId !== row.id || result.attemptId !== row.attempt_id ||
      result.requestHash !== row.request_hash || result.artifacts.manifestHash !== row.artifact_bundle_hash ||
      result.status !== row.state || result.finishedAt !== row.finished_at ||
      result.status !== "succeeded" || result.kernelStatus !== "accepted" ||
      !await verifyLeanRunnerResultSignature({ result, runnerPublicKey })
    ) return null;
    return Object.freeze({
      runId: result.jobId,
      resultHash: row.result_hash,
      artifactBundleHash: row.artifact_bundle_hash,
      acceptedAt: row.received_at,
    });
  } catch {
    return null;
  }
}

async function verifiedAttestation(row) {
  if (!row?.canonical_payload) return null;
  try {
    const attestation = normalizeVerificationAttestation(JSON.parse(row.canonical_payload));
    if (
      canonicalJson(attestation) !== row.canonical_payload ||
      attestation.id !== row.id || attestation.assignmentId !== row.assignment_id ||
      attestation.artifactBundleHash !== row.artifact_bundle_manifest_hash ||
      attestation.claimType !== row.claim_type || attestation.verifierPersonId !== row.verifier_person_id ||
      attestation.verifierAgentId !== row.verifier_agent_id ||
      attestation.delegationCertificateId !== row.delegation_certificate_id ||
      attestation.verifierAgentPublicKey !== row.verifier_agent_public_key ||
      attestation.decision !== row.decision || attestation.evidenceHash !== row.evidence_hash ||
      attestation.payloadHash !== row.payload_hash || attestation.signature !== row.signature ||
      attestation.attestedAt !== row.attested_at || attestation.decision !== "attested" ||
      !await verifyVerificationAttestationSignature(attestation)
    ) return null;
    return attestation;
  } catch {
    return null;
  }
}

async function verifiedReceipt(row, assertReceiptIssuerTrusted) {
  if (!row?.canonical_receipt) return null;
  try {
    const receipt = normalizeContributionReceipt(JSON.parse(row.canonical_receipt));
    if (
      canonicalJson(receipt) !== row.canonical_receipt || receipt.id !== row.id ||
      await contributionReceiptHash(receipt) !== row.receipt_hash ||
      !await verifyContributionReceiptSignature(receipt)
    ) return null;
    assertContributionReceiptPolicy(receipt);
    await assertReceiptIssuerTrusted(receipt);
    return Object.freeze({ ...receipt, receiptHash: row.receipt_hash });
  } catch {
    return null;
  }
}

function receiptMatchesNode(receipt, node) {
  return receipt.attempt.id === node.attemptId &&
    receipt.attempt.problemRevisionId === node.problemRevisionId &&
    receipt.artifactBundleHash === node.artifactBundleHash &&
    receipt.beneficiary.personId === node.creator.personId &&
    receipt.beneficiary.agentId === node.creator.agentId &&
    receipt.beneficiary.delegationCertificateId === node.delegationCertificateId &&
    receiptKindForNode(node.kind) === receipt.kind;
}

function receiptKindForNode(kind) {
  if (["formalization", "lemma", "proof_patch", "counterexample", "synthesis"].includes(kind)) return kind;
  if (kind === "negative_result") return "counterexample";
  return null;
}

function emptyEvidence() {
  return Object.freeze({ stage: "shared", bundle: null, lean: null, review: null, receipt: null });
}
