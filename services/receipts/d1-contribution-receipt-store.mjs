import {
  canonicalContributionReceipt,
  contributionReceiptHash,
  contributionReceiptSigningPayload,
  createContributionReceipt,
  normalizeContributionReceipt,
} from "../../packages/protocol/contribution-receipt.mjs";
import { normalizeArtifactBundle } from "../../packages/protocol/artifact-bundle.mjs";
import { normalizeLeanRunnerResult } from "../../packages/protocol/lean-runner.mjs";
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import { normalizeVerificationAttestation } from "../../packages/protocol/verification-attestation.mjs";

export class ContributionReceiptStoreConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptStoreConflictError";
  }
}

export class ContributionReceiptStoreValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptStoreValidationError";
  }
}

export class ContributionReceiptStoreNotFoundError extends Error {
  constructor(id) {
    super(`Contribution Receipt ${id} was not found.`);
    this.name = "ContributionReceiptStoreNotFoundError";
  }
}

/**
 * Internal issuer adapter. It derives receipt evidence from immutable D1 rows
 * and never accepts an arbitrary client-supplied receipt payload or exposes an
 * HTTP endpoint. Issuer private keys are deployment secrets passed per call.
 */
export class D1ContributionReceiptStore {
  constructor(database) {
    this.database = database;
  }

  async issue({
    id,
    kind,
    artifactBundleManifestHash,
    runId,
    beneficiary,
    issuedAt,
    issuerKeyId,
    issuerPublicKey,
    issuerPrivateKey,
  }) {
    const evidence = await this.loadEvidence({ artifactBundleManifestHash, runId });
    const draft = {
      protocolVersion: "pw-contribution-receipt-v1",
      id,
      kind,
      beneficiary: beneficiary ?? evidence.attemptBeneficiary,
      attempt: evidence.attempt,
      target: evidence.target,
      artifactBundleHash: artifactBundleManifestHash,
      bundle: evidence.bundle,
      run: evidence.run,
      claims: evidence.claims,
      issuedAt,
      policyVersion: "pw-receipt-policy-v1",
      issuerKeyId,
      issuerPublicKey,
    };
    const existing = await this.findExistingForDraft(draft);
    if (existing) return { receipt: existing, created: false };

    const receipt = await createContributionReceipt({ receipt: draft, issuerPrivateKey });
    const receiptHash = await contributionReceiptHash(receipt);
    await this.database
      .prepare(
        `INSERT INTO contribution_receipts (
          id, kind, beneficiary_person_id, beneficiary_agent_id,
          beneficiary_delegation_certificate_id, attempt_id, problem_revision_id,
          artifact_bundle_manifest_hash, run_id, receipt_hash, canonical_receipt,
          payload_hash, issuer_key_id, issuer_public_key, issuer_signature, issued_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        receipt.id, receipt.kind, receipt.beneficiary.personId, receipt.beneficiary.agentId,
        receipt.beneficiary.delegationCertificateId, receipt.attempt.id,
        receipt.attempt.problemRevisionId, receipt.artifactBundleHash, receipt.run.id,
        receiptHash, canonicalContributionReceipt(receipt), receipt.payloadHash,
        receipt.issuerKeyId, receipt.issuerPublicKey, receipt.issuerSignature, receipt.issuedAt,
      )
      .run();
    return { receipt, created: true };
  }

  async get(id) {
    const row = await this.database
      .prepare("SELECT canonical_receipt FROM contribution_receipts WHERE id = ?")
      .bind(id)
      .first();
    if (!row) return null;
    return parseReceipt(row.canonical_receipt);
  }

  async require(id) {
    const receipt = await this.get(id);
    if (!receipt) throw new ContributionReceiptStoreNotFoundError(id);
    return receipt;
  }

  async findExistingForDraft(draft) {
    const byId = await this.database
      .prepare("SELECT canonical_receipt FROM contribution_receipts WHERE id = ?")
      .bind(draft.id)
      .first();
    const byEvidence = await this.database
      .prepare(
        `SELECT canonical_receipt FROM contribution_receipts
         WHERE artifact_bundle_manifest_hash = ? AND kind = ?
           AND beneficiary_person_id = ? AND beneficiary_agent_id = ?
           AND beneficiary_delegation_certificate_id = ?`,
      )
      .bind(
        draft.artifactBundleHash, draft.kind, draft.beneficiary.personId,
        draft.beneficiary.agentId, draft.beneficiary.delegationCertificateId,
      )
      .first();
    const row = byId ?? byEvidence;
    if (!row) return null;
    const existing = parseReceipt(row.canonical_receipt);
    if (canonicalJson(contributionReceiptSigningPayload(existing)) !== canonicalJson(draft)) {
      throw new ContributionReceiptStoreConflictError("A Contribution Receipt identity already has different immutable evidence.");
    }
    return existing;
  }

  async loadEvidence({ artifactBundleManifestHash, runId }) {
    requireSha256(artifactBundleManifestHash, "artifactBundleManifestHash");
    requireIdentifier(runId, "runId");
    const row = await this.database
      .prepare(
        `SELECT
          bundle.canonical_manifest,
          attempt.id AS attempt_id, attempt.person_id AS attempt_person_id,
          attempt.agent_id AS attempt_agent_id,
          attempt.delegation_certificate_id AS attempt_delegation_certificate_id,
          attempt.problem_revision_id AS problem_revision_id,
          run.id AS run_id, run.request_hash, run.state AS run_state,
          run.runner_result_hash,
          result.result_hash, result.canonical_result
         FROM artifact_bundles AS bundle
         INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
         INNER JOIN runs AS run
           ON run.id = ? AND run.attempt_id = bundle.attempt_id
           AND run.artifact_bundle_hash = bundle.manifest_hash
         INNER JOIN run_results AS result ON result.run_id = run.id
         WHERE bundle.manifest_hash = ?`,
      )
      .bind(runId, artifactBundleManifestHash)
      .first();
    if (!row) {
      throw new ContributionReceiptStoreValidationError("Receipt evidence must reference one staged Artifact Bundle and its completed Run.");
    }
    if (!row.attempt_agent_id || !row.attempt_delegation_certificate_id) {
      throw new ContributionReceiptStoreValidationError("Receipt Attempt lacks delegated Agent attribution.");
    }
    const bundle = parseBundle(row.canonical_manifest);
    const runnerResult = parseRunnerResult(row.canonical_result);
    if (row.runner_result_hash !== row.result_hash || runnerResult.status !== row.run_state) {
      throw new ContributionReceiptStoreValidationError("Stored Run projection does not match its immutable runner result.");
    }
    const claims = await this.loadAttestedClaims(artifactBundleManifestHash);
    return {
      attempt: {
        id: row.attempt_id,
        personId: row.attempt_person_id,
        agentId: row.attempt_agent_id,
        delegationCertificateId: row.attempt_delegation_certificate_id,
        problemRevisionId: row.problem_revision_id,
      },
      attemptBeneficiary: {
        personId: row.attempt_person_id,
        agentId: row.attempt_agent_id,
        delegationCertificateId: row.attempt_delegation_certificate_id,
      },
      target: bundle.target,
      bundle: {
        manifestHash: artifactBundleManifestHash,
        dependencyReceipts: bundle.dependencyReceipts,
      },
      run: {
        id: row.run_id,
        requestHash: row.request_hash,
        resultHash: row.result_hash,
        status: row.run_state,
        kernelStatus: runnerResult.kernelStatus,
      },
      claims,
    };
  }

  async loadAttestedClaims(artifactBundleManifestHash) {
    const rows = await this.database
      .prepare(
        `SELECT id, claim_type, artifact_bundle_manifest_hash, verifier_person_id,
                verifier_agent_id, delegation_certificate_id, canonical_payload
         FROM verification_attestations
         WHERE artifact_bundle_manifest_hash = ? AND decision = 'attested'
         ORDER BY id ASC`,
      )
      .bind(artifactBundleManifestHash)
      .all();
    return Promise.all((rows.results ?? []).map(async (row) => {
      const attestation = parseAttestation(row.canonical_payload);
      if (
        attestation.id !== row.id ||
        attestation.claimType !== row.claim_type ||
        attestation.artifactBundleHash !== row.artifact_bundle_manifest_hash ||
        attestation.verifierPersonId !== row.verifier_person_id ||
        attestation.verifierAgentId !== row.verifier_agent_id ||
        attestation.delegationCertificateId !== row.delegation_certificate_id ||
        attestation.decision !== "attested"
      ) {
        throw new ContributionReceiptStoreValidationError("Stored verification attestation projection does not match canonical evidence.");
      }
      return {
        claimType: attestation.claimType,
        verificationAttestationId: attestation.id,
        verificationAttestationHash: await sha256Canonical(attestation),
        artifactBundleHash: attestation.artifactBundleHash,
        reviewerPersonId: attestation.verifierPersonId,
        reviewerAgentId: attestation.verifierAgentId,
        reviewerDelegationCertificateId: attestation.delegationCertificateId,
        decision: "attested",
      };
    }));
  }
}

function parseBundle(value) {
  try {
    return normalizeArtifactBundle(JSON.parse(value));
  } catch {
    throw new ContributionReceiptStoreValidationError("Stored Artifact Bundle manifest is invalid.");
  }
}

function parseRunnerResult(value) {
  try {
    return normalizeLeanRunnerResult(JSON.parse(value));
  } catch {
    throw new ContributionReceiptStoreValidationError("Stored runner result is invalid.");
  }
}

function parseAttestation(value) {
  try {
    return normalizeVerificationAttestation(JSON.parse(value));
  } catch {
    throw new ContributionReceiptStoreValidationError("Stored verification attestation is invalid.");
  }
}

function parseReceipt(value) {
  try {
    return normalizeContributionReceipt(JSON.parse(value));
  } catch {
    throw new ContributionReceiptStoreValidationError("Stored Contribution Receipt is invalid.");
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/.test(value)) {
    throw new ContributionReceiptStoreValidationError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ContributionReceiptStoreValidationError(`${label} must be sha256:<hex>.`);
  }
}
