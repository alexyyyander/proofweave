import {
  assertContributionReceiptPolicy,
  canonicalContributionReceipt,
  contributionReceiptHash,
  contributionReceiptRequiredClaimTypes,
  contributionReceiptSigningPayload,
  createContributionReceipt,
  normalizeContributionReceipt,
  verifyContributionReceiptSignature,
} from "../../packages/protocol/contribution-receipt.mjs";
import {
  canonicalContributionReceiptLifecycleEvent,
  contributionReceiptLifecycleEventProtocolVersion,
  contributionReceiptLifecycleEventSigningPayload,
  createContributionReceiptLifecycleEvent,
  normalizeContributionReceiptLifecycleEvent,
  normalizeContributionReceiptLifecycleEventDraft,
  verifyContributionReceiptLifecycleEventSignature,
} from "../../packages/protocol/contribution-receipt-lifecycle.mjs";
import { normalizeArtifactBundle } from "../../packages/protocol/artifact-bundle.mjs";
import { normalizeLeanRunnerResult } from "../../packages/protocol/lean-runner.mjs";
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  assertDelegationAllows,
  delegationPayloadHash,
  delegationProtocolVersion,
  delegationSigningPayload,
  normalizeDelegationCertificate,
  verifyDelegationSignature,
} from "../../packages/domain/delegation.mjs";
import {
  normalizeVerificationAttestation,
  verifyVerificationAttestationSignature,
} from "../../packages/protocol/verification-attestation.mjs";
import { D1ContributionReceiptIssuerKeyStore } from "./d1-contribution-receipt-issuer-key-store.mjs";
import { classifyReceiptPublication } from "./receipt-publication-policy.mjs";

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
    this.issuerKeys = new D1ContributionReceiptIssuerKeyStore(database);
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
    publication,
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
    if (existing) {
      const dependencies = await this.loadDependencyEvidence({
        downstreamReceiptId: existing.id,
        artifactBundleManifestHash,
        issuedAt: existing.issuedAt,
        declaredDependencies: evidence.bundle.dependencyReceipts,
      });
      await this.assertReceiptSideEffects(
        existing,
        classifyReceiptPublication(existing, publication),
        dependencies,
      );
      return { receipt: existing, created: false };
    }
    await this.issuerKeys.assertCanIssue({
      issuerKeyId: draft.issuerKeyId,
      issuerPublicKey: draft.issuerPublicKey,
      issuedAt: draft.issuedAt,
    });

    const dependencies = await this.loadDependencyEvidence({
      downstreamReceiptId: id,
      artifactBundleManifestHash,
      issuedAt,
      declaredDependencies: evidence.bundle.dependencyReceipts,
    });
    const receipt = await createContributionReceipt({ receipt: draft, issuerPrivateKey });
    const receiptHash = await contributionReceiptHash(receipt);
    const publicationRecord = classifyReceiptPublication(receipt, publication);
    const receiptInsert = this.database
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
      );
    const publicationInsert = this.database
      .prepare(
        `INSERT INTO contribution_receipt_publications (
          receipt_id, record_class, visibility, policy_version,
          classification_reason, classified_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        receipt.id, publicationRecord.recordClass, publicationRecord.visibility,
        publicationRecord.policyVersion, publicationRecord.reason,
        publicationRecord.classifiedAt,
      );
    const edgeInserts = dependencies.map((dependency) => this.database
      .prepare(
        `INSERT INTO contribution_receipt_dependency_edges (
          downstream_receipt_id, upstream_receipt_id, upstream_receipt_hash,
          declared_by_bundle_manifest_hash, recorded_at
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        receipt.id, dependency.receiptId, dependency.receiptHash,
        artifactBundleManifestHash, receipt.issuedAt,
      ));
    try {
      await this.database.batch([receiptInsert, publicationInsert, ...edgeInserts]);
    } catch (cause) {
      // A concurrent canonical closure may win either immutable uniqueness
      // constraint. D1 batches are atomic, so the losing writer can only
      // return the stored winner when it covers byte-for-byte the same draft.
      const raced = await this.findExistingForDraft(draft);
      if (!raced) throw cause;
      await this.assertReceiptSideEffects(raced, publicationRecord, dependencies);
      return { receipt: raced, created: false };
    }
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

  /**
   * Record an issuer-signed correction, supersession, or retraction without
   * changing any original receipt row. This remains an internal control-plane
   * action: private key material is supplied by a deployment secret provider.
   */
  async recordLifecycleEvent({
    id,
    receiptId,
    eventType,
    replacementReceiptId,
    reasonHash,
    occurredAt,
    issuerKeyId,
    issuerPublicKey,
    issuerPrivateKey,
  }) {
    const draft = normalizeContributionReceiptLifecycleEventDraft({
      protocolVersion: contributionReceiptLifecycleEventProtocolVersion,
      id,
      receiptId,
      eventType,
      replacementReceiptId,
      reasonHash,
      occurredAt,
      issuerKeyId,
      issuerPublicKey,
    });
    const existingRow = await this.database
      .prepare("SELECT canonical_payload FROM contribution_receipt_lifecycle_events WHERE id = ?")
      .bind(draft.id)
      .first();
    if (existingRow) {
      const existing = parseLifecycleEvent(existingRow.canonical_payload);
      if (!await verifyContributionReceiptLifecycleEventSignature(existing)) {
        throw new ContributionReceiptStoreValidationError("Stored Contribution Receipt lifecycle event has an invalid issuer signature.");
      }
      await this.issuerKeys.assertHistoricallyTrusted({
        issuerKeyId: existing.issuerKeyId,
        issuerPublicKey: existing.issuerPublicKey,
        occurredAt: existing.occurredAt,
      });
      if (canonicalJson(contributionReceiptLifecycleEventSigningPayload(existing)) !== canonicalJson(draft)) {
        throw new ContributionReceiptStoreConflictError("A Contribution Receipt lifecycle event id already has different immutable evidence.");
      }
      return { event: existing, created: false };
    }

    const receipt = await this.loadVerifiedReceipt(receiptId);
    // Lifecycle evidence is allowed to move to the current issuer key after a
    // rotation. The original receipt keeps its historical key in its own
    // immutable payload; a new event must be authorized by today's active key.
    await this.issuerKeys.assertCanIssue({
      issuerKeyId: draft.issuerKeyId,
      issuerPublicKey: draft.issuerPublicKey,
      issuedAt: draft.occurredAt,
    });
    if (Date.parse(draft.occurredAt) < Date.parse(receipt.issuedAt)) {
      throw new ContributionReceiptStoreValidationError("Receipt lifecycle event cannot predate receipt issuance.");
    }
    await this.assertLifecycleTransition(receipt.id, draft.eventType);

    if (draft.replacementReceiptId) {
      const replacement = await this.loadVerifiedReceipt(draft.replacementReceiptId);
      if (
        replacement.attempt.id !== receipt.attempt.id ||
        replacement.target.declaration !== receipt.target.declaration ||
        replacement.target.statementHash !== receipt.target.statementHash
      ) {
        throw new ContributionReceiptStoreValidationError("A replacement receipt must cover the same Attempt and target declaration.");
      }
      if (
        Date.parse(replacement.issuedAt) <= Date.parse(receipt.issuedAt) ||
        Date.parse(replacement.issuedAt) > Date.parse(draft.occurredAt)
      ) {
        throw new ContributionReceiptStoreValidationError("A replacement receipt must be issued after the original and no later than its lifecycle event.");
      }
      await this.assertNoReplacementCycle(receipt.id, replacement.id);
    }

    const event = await createContributionReceiptLifecycleEvent({
      event: draft,
      issuerPrivateKey,
    });
    await this.database
      .prepare(
        `INSERT INTO contribution_receipt_lifecycle_events (
          id, receipt_id, event_type, replacement_receipt_id, reason_hash,
          occurred_at, issuer_key_id, issuer_public_key, canonical_payload,
          payload_hash, issuer_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id, event.receiptId, event.eventType, event.replacementReceiptId,
        event.reasonHash, event.occurredAt, event.issuerKeyId,
        event.issuerPublicKey, canonicalContributionReceiptLifecycleEvent(event),
        event.payloadHash, event.issuerSignature,
      )
      .run();
    return { event, created: true };
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
    await this.assertTrustedReceipt(existing);
    return existing;
  }

  async loadVerifiedReceipt(id) {
    const row = await this.database
      .prepare("SELECT id, receipt_hash, canonical_receipt FROM contribution_receipts WHERE id = ?")
      .bind(id)
      .first();
    if (!row) throw new ContributionReceiptStoreNotFoundError(id);
    const receipt = parseReceipt(row.canonical_receipt);
    try {
      if (receipt.id !== row.id || row.receipt_hash !== await contributionReceiptHash(receipt)) {
        throw new Error("receipt evidence mismatch");
      }
      await this.assertTrustedReceipt(receipt);
    } catch {
      throw new ContributionReceiptStoreValidationError("Stored Contribution Receipt did not pass hash, issuer signature, and policy verification.");
    }
    return receipt;
  }

  async assertLifecycleTransition(receiptId, eventType) {
    const rows = await this.database
      .prepare(
        `SELECT canonical_payload FROM contribution_receipt_lifecycle_events
         WHERE receipt_id = ? ORDER BY occurred_at ASC, id ASC`,
      )
      .bind(receiptId)
      .all();
    const events = [];
    for (const row of rows.results ?? []) {
      const event = parseLifecycleEvent(row.canonical_payload);
      if (!await verifyContributionReceiptLifecycleEventSignature(event)) {
        throw new ContributionReceiptStoreValidationError("Stored Contribution Receipt lifecycle event has an invalid issuer signature.");
      }
      await this.issuerKeys.assertHistoricallyTrusted({
        issuerKeyId: event.issuerKeyId,
        issuerPublicKey: event.issuerPublicKey,
        occurredAt: event.occurredAt,
      });
      events.push(event);
    }
    if (events.some((event) => event.eventType === "retracted" || event.eventType === "superseded")) {
      throw new ContributionReceiptStoreConflictError("A retracted or superseded Contribution Receipt cannot receive another lifecycle event.");
    }
    if (eventType === "corrected" && events.some((event) => event.eventType === "corrected")) {
      throw new ContributionReceiptStoreConflictError("A Contribution Receipt can have only one correction event.");
    }
    if (eventType === "superseded" && events.some((event) => event.eventType === "corrected")) {
      throw new ContributionReceiptStoreConflictError("A corrected Contribution Receipt cannot also be superseded.");
    }
  }

  async assertNoReplacementCycle(receiptId, replacementReceiptId) {
    const pending = [{ id: replacementReceiptId, path: new Set([receiptId]) }];
    let traversed = 0;
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      if (current.path.has(current.id)) {
        throw new ContributionReceiptStoreValidationError("Receipt replacement would create a lifecycle cycle.");
      }
      traversed += 1;
      if (traversed > 512) {
        throw new ContributionReceiptStoreValidationError("Receipt lifecycle replacement graph is unexpectedly deep.");
      }
      const path = new Set(current.path);
      path.add(current.id);
      const rows = await this.database
        .prepare(
          `SELECT replacement_receipt_id
           FROM contribution_receipt_lifecycle_events
           WHERE receipt_id = ? AND replacement_receipt_id IS NOT NULL`,
        )
        .bind(current.id)
        .all();
      for (const row of rows.results ?? []) {
        pending.push({ id: row.replacement_receipt_id, path });
      }
    }
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
          COALESCE(bundle.delegation_certificate_id, attempt.delegation_certificate_id)
            AS attempt_delegation_certificate_id,
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
    const latest = await this.loadEffectiveReviewEvidence(artifactBundleManifestHash);
    const blocking = [...latest.values()].filter((attestation) => attestation.decision !== "attested");
    if (blocking.length > 0) {
      throw new ContributionReceiptStoreValidationError(
        "Receipt evidence contains a non-positive decision for a required verification claim.",
      );
    }
    const missing = contributionReceiptRequiredClaimTypes.filter(
      (claimType) => latest.get(claimType)?.decision !== "attested",
    );
    if (missing.length > 0) {
      throw new ContributionReceiptStoreValidationError(
        `Receipt evidence is missing required positive verification claims: ${missing.join(", ")}.`,
      );
    }
    const selected = contributionReceiptRequiredClaimTypes.map(
      (claimType) => latest.get(claimType),
    );
    return Promise.all(selected.map(async (attestation) => ({
      claimType: attestation.claimType,
      verificationAttestationId: attestation.id,
      verificationAttestationHash: await sha256Canonical(attestation),
      artifactBundleHash: attestation.artifactBundleHash,
      reviewerPersonId: attestation.verifierPersonId,
      reviewerAgentId: attestation.verifierAgentId,
      reviewerDelegationCertificateId: attestation.delegationCertificateId,
      decision: "attested",
    })));
  }

  async loadEffectiveReviewEvidence(artifactBundleManifestHash) {
    return latestReviewDecisions(await this.loadReviewEvidence(artifactBundleManifestHash));
  }

  /**
   * Rebuild the receipt review boundary from canonical signed attestations and
   * the exact completed assignments that authorized them. This deliberately
   * does not trust the attestation projection, assignment status, Agent owner,
   * or delegation projection in isolation.
   */
  async loadReviewEvidence(artifactBundleManifestHash) {
    requireSha256(artifactBundleManifestHash, "artifactBundleManifestHash");
    const rows = await this.database
      .prepare(
        `SELECT
          attestation.id, attestation.assignment_id,
          attestation.artifact_bundle_manifest_hash, attestation.claim_type,
          attestation.verifier_person_id, attestation.verifier_agent_id,
          attestation.delegation_certificate_id,
          attestation.verifier_agent_public_key, attestation.decision,
          attestation.evidence_hash, attestation.canonical_payload,
          attestation.payload_hash, attestation.signature,
          attestation.attested_at,
          assignment.artifact_bundle_manifest_hash AS assignment_bundle_hash,
          assignment.claim_type AS assignment_claim_type,
          assignment.attempt_owner_person_id AS assignment_attempt_owner_person_id,
          assignment.verifier_person_id AS assignment_verifier_person_id,
          assignment.status AS assignment_status,
          assignment.assigned_at AS assignment_assigned_at,
          assignment.accepted_at AS assignment_accepted_at,
          assignment.completed_at AS assignment_completed_at,
          attempt.person_id AS actual_attempt_owner_person_id,
          agent.owner_person_id AS agent_owner_person_id,
          agent.public_key AS agent_public_key,
          agent.key_fingerprint AS agent_key_fingerprint,
          agent.status AS agent_status,
          agent.revoked_at AS agent_revoked_at,
          agent.created_at AS agent_created_at,
          certificate.owner_person_id AS certificate_owner_person_id,
          certificate.agent_id AS certificate_agent_id,
          certificate.person_key_id AS certificate_person_key_id,
          certificate.agent_public_key AS certificate_agent_public_key,
          certificate.scopes_json, certificate.valid_from,
          certificate.valid_until,
          certificate.beneficiary_person_id AS certificate_beneficiary_person_id,
          certificate.protocol_version AS certificate_protocol_version,
          certificate.payload_hash AS certificate_payload_hash,
          certificate.canonical_payload AS certificate_canonical_payload,
          certificate.person_signature AS certificate_person_signature,
          signer.person_id AS signer_person_id,
          signer.public_key AS signer_public_key,
          signer.fingerprint AS signer_fingerprint,
          signer.algorithm AS signer_algorithm,
          signer.revoked_at AS signer_legacy_revoked_at,
          delegation_revocation.revoked_at AS delegation_revoked_at,
          key_revocation.revoked_at AS signer_event_revoked_at
         FROM verification_attestations AS attestation
         INNER JOIN verification_assignments AS assignment
           ON assignment.id = attestation.assignment_id
         INNER JOIN artifact_bundles AS bundle
           ON bundle.manifest_hash = assignment.artifact_bundle_manifest_hash
         INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
         LEFT JOIN agents AS agent ON agent.id = attestation.verifier_agent_id
         LEFT JOIN delegation_certificates AS certificate
           ON certificate.id = attestation.delegation_certificate_id
         LEFT JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN delegation_revocations AS delegation_revocation
           ON delegation_revocation.delegation_certificate_id = certificate.id
         LEFT JOIN person_key_revocations AS key_revocation
           ON key_revocation.person_key_id = signer.id
         WHERE assignment.artifact_bundle_manifest_hash = ?
           AND assignment.claim_type IN (
             'bundle_reproducible','kernel_accepted','project_accepted'
           )
         ORDER BY attestation.attested_at ASC, attestation.id ASC`,
      )
      .bind(artifactBundleManifestHash)
      .all();
    const attestations = [];
    for (const row of rows.results ?? []) {
      const attestation = parseAttestation(row.canonical_payload);
      if (
        canonicalJson(attestation) !== row.canonical_payload ||
        attestation.id !== row.id ||
        attestation.assignmentId !== row.assignment_id ||
        attestation.claimType !== row.claim_type ||
        attestation.artifactBundleHash !== row.artifact_bundle_manifest_hash ||
        attestation.verifierPersonId !== row.verifier_person_id ||
        attestation.verifierAgentId !== row.verifier_agent_id ||
        attestation.delegationCertificateId !== row.delegation_certificate_id ||
        attestation.verifierAgentPublicKey !== row.verifier_agent_public_key ||
        attestation.decision !== row.decision ||
        attestation.evidenceHash !== row.evidence_hash ||
        attestation.payloadHash !== row.payload_hash ||
        attestation.signature !== row.signature ||
        attestation.attestedAt !== row.attested_at
      ) {
        throw new ContributionReceiptStoreValidationError("Stored verification attestation projection does not match canonical evidence.");
      }
      if (
        row.assignment_status !== "completed" ||
        row.assignment_completed_at !== attestation.attestedAt ||
        row.assignment_bundle_hash !== attestation.artifactBundleHash ||
        row.assignment_claim_type !== attestation.claimType ||
        row.assignment_verifier_person_id !== attestation.verifierPersonId ||
        row.assignment_attempt_owner_person_id !== row.actual_attempt_owner_person_id
      ) {
        throw new ContributionReceiptStoreValidationError(
          "Verification attestation does not match its completed assignment.",
        );
      }
      const assignedAt = requireUtcInstant(row.assignment_assigned_at, "verification assignment assignedAt");
      const acceptedAt = requireUtcInstant(row.assignment_accepted_at, "verification assignment acceptedAt");
      const attestedAt = requireUtcInstant(attestation.attestedAt, "verification attestation attestedAt");
      if (assignedAt > acceptedAt || acceptedAt > attestedAt) {
        throw new ContributionReceiptStoreValidationError(
          "Verification assignment timestamps do not form assigned <= accepted <= attested.",
        );
      }
      if (row.actual_attempt_owner_person_id === attestation.verifierPersonId) {
        throw new ContributionReceiptStoreValidationError(
          "A Receipt cannot use a same-owner verification attestation.",
        );
      }
      if (
        !["active", "revoked"].includes(row.agent_status) ||
        row.agent_owner_person_id !== attestation.verifierPersonId ||
        row.agent_public_key !== attestation.verifierAgentPublicKey ||
        row.certificate_owner_person_id !== attestation.verifierPersonId ||
        row.certificate_agent_id !== attestation.verifierAgentId ||
        row.certificate_agent_public_key !== attestation.verifierAgentPublicKey ||
        row.certificate_beneficiary_person_id !== attestation.verifierPersonId ||
        row.signer_person_id !== attestation.verifierPersonId
      ) {
        throw new ContributionReceiptStoreValidationError(
          "Verification attestation does not match a valid review Agent delegation.",
        );
      }
      const [expectedAgentFingerprint, expectedSignerFingerprint] = await Promise.all([
        sha256Canonical({ algorithm: "ed25519", public_key: row.agent_public_key }),
        sha256Canonical({ algorithm: "ed25519", public_key: row.signer_public_key }),
      ]);
      if (
        row.agent_key_fingerprint !== expectedAgentFingerprint ||
        row.signer_fingerprint !== expectedSignerFingerprint
      ) {
        throw new ContributionReceiptStoreValidationError(
          "Review Agent or Person signing key fingerprint does not match its public key.",
        );
      }
      const agentCreatedAt = requireUtcInstant(row.agent_created_at, "review Agent createdAt");
      const agentRevokedAt = row.agent_revoked_at === null || row.agent_revoked_at === undefined
        ? null
        : requireUtcInstant(row.agent_revoked_at, "review Agent revokedAt");
      if (
        agentCreatedAt > attestedAt ||
        (agentRevokedAt !== null && attestedAt >= agentRevokedAt) ||
        (row.agent_status === "revoked" && agentRevokedAt === null)
      ) {
        throw new ContributionReceiptStoreValidationError(
          "Verification attestation occurred outside the review Agent's historical authority.",
        );
      }
      let scopes;
      try {
        scopes = JSON.parse(row.scopes_json);
      } catch {
        throw new ContributionReceiptStoreValidationError("Stored review delegation scopes are not valid JSON.");
      }
      try {
        const certificate = normalizeDelegationCertificate({
          id: attestation.delegationCertificateId,
          ownerPersonId: row.certificate_owner_person_id,
          agentId: row.certificate_agent_id,
          agentPublicKey: row.certificate_agent_public_key,
          scopes,
          validFrom: row.valid_from,
          validUntil: row.valid_until,
          attributionPolicy: {
            beneficiaryPersonId: row.certificate_beneficiary_person_id,
            mode: "agent_delegated",
          },
        });
        if (
          row.certificate_protocol_version !== delegationProtocolVersion ||
          row.certificate_canonical_payload !== canonicalJson(delegationSigningPayload(certificate)) ||
          row.certificate_payload_hash !== await delegationPayloadHash(certificate) ||
          row.signer_algorithm !== "ed25519" ||
          !await verifyDelegationSignature({
            certificate,
            personPublicKey: row.signer_public_key,
            personSignature: row.certificate_person_signature,
          })
        ) {
          throw new Error("delegation integrity mismatch");
        }
        assertDelegationAllows(
          certificate,
          "review",
          attestation.attestedAt,
          earliestInstant(
            optionalUtcInstant(row.delegation_revoked_at, "delegation revokedAt"),
            optionalUtcInstant(row.signer_event_revoked_at, "Person key revocation event time"),
            optionalUtcInstant(row.signer_legacy_revoked_at, "Person key legacy revokedAt"),
          ),
        );
      } catch {
        throw new ContributionReceiptStoreValidationError(
          "Verification attestation occurred outside valid signed review delegation authority.",
        );
      }
      if (!await verifyVerificationAttestationSignature(attestation)) {
        throw new ContributionReceiptStoreValidationError(
          "Verification attestation Agent signature or payload hash is invalid.",
        );
      }
      attestations.push(attestation);
    }
    return Object.freeze(attestations);
  }

  async assertReceiptSideEffects(receipt, publication, dependencies) {
    const storedPublication = await this.database.prepare(
      `SELECT record_class, visibility, policy_version, classification_reason,
              classified_at
       FROM contribution_receipt_publications WHERE receipt_id = ?`,
    ).bind(receipt.id).first();
    if (
      !storedPublication ||
      storedPublication.record_class !== publication.recordClass ||
      storedPublication.visibility !== publication.visibility ||
      storedPublication.policy_version !== publication.policyVersion ||
      storedPublication.classification_reason !== publication.reason ||
      storedPublication.classified_at !== publication.classifiedAt
    ) {
      throw new ContributionReceiptStoreConflictError(
        "Stored Contribution Receipt publication does not match its canonical classification.",
      );
    }
    const storedEdges = await this.database.prepare(
      `SELECT upstream_receipt_id, upstream_receipt_hash,
              declared_by_bundle_manifest_hash, recorded_at
       FROM contribution_receipt_dependency_edges
       WHERE downstream_receipt_id = ?
       ORDER BY upstream_receipt_id ASC`,
    ).bind(receipt.id).all();
    const expectedEdges = dependencies.map((dependency) => ({
      upstream_receipt_id: dependency.receiptId,
      upstream_receipt_hash: dependency.receiptHash,
      declared_by_bundle_manifest_hash: dependency.artifactBundleManifestHash,
      recorded_at: dependency.issuedAt,
    })).sort((left, right) => left.upstream_receipt_id.localeCompare(right.upstream_receipt_id));
    if (canonicalJson(storedEdges.results ?? []) !== canonicalJson(expectedEdges)) {
      throw new ContributionReceiptStoreConflictError(
        "Stored Contribution Receipt dependency edges do not match its canonical Bundle.",
      );
    }
  }

  /**
   * A declared dependency becomes a graph edge only when it points at a
   * previously issued, issuer-signed receipt with the exact declared hash.
   * The downstream receipt is new at this point, so this ordering also makes a
   * receipt-level cycle impossible without a mutable edge.
   */
  async loadDependencyEvidence({
    downstreamReceiptId,
    artifactBundleManifestHash,
    issuedAt,
    declaredDependencies,
  }) {
    requireIdentifier(downstreamReceiptId, "downstreamReceiptId");
    requireSha256(artifactBundleManifestHash, "artifactBundleManifestHash");
    requireUtcInstant(issuedAt, "issuedAt");

    const dependencies = [];
    for (const dependency of declaredDependencies) {
      if (dependency.receiptId === downstreamReceiptId) {
        throw new ContributionReceiptStoreValidationError("A Contribution Receipt cannot declare itself as an upstream dependency.");
      }
      const row = await this.database
        .prepare(
          `SELECT id, receipt_hash, canonical_receipt
           FROM contribution_receipts WHERE id = ?`,
        )
        .bind(dependency.receiptId)
        .first();
      if (!row) {
        throw new ContributionReceiptStoreValidationError(`Declared upstream Contribution Receipt ${dependency.receiptId} was not found.`);
      }
      const upstream = parseReceipt(row.canonical_receipt);
      try {
        if (
          row.id !== dependency.receiptId ||
          upstream.id !== dependency.receiptId ||
          row.receipt_hash !== dependency.receiptHash ||
          row.receipt_hash !== await contributionReceiptHash(upstream) ||
          Date.parse(upstream.issuedAt) > Date.parse(issuedAt)
        ) {
          throw new Error("upstream receipt evidence mismatch");
        }
        await this.assertTrustedReceipt(upstream);
      } catch {
        throw new ContributionReceiptStoreValidationError(`Declared upstream Contribution Receipt ${dependency.receiptId} did not pass hash, signature, and policy verification.`);
      }
      dependencies.push(Object.freeze({
        receiptId: dependency.receiptId,
        receiptHash: dependency.receiptHash,
        artifactBundleManifestHash,
        issuedAt,
      }));
    }
    return Object.freeze(dependencies);
  }

  async assertTrustedReceipt(receipt) {
    if (!await verifyContributionReceiptSignature(receipt)) {
      throw new ContributionReceiptStoreValidationError("Stored Contribution Receipt has an invalid issuer signature.");
    }
    await this.issuerKeys.assertHistoricallyTrusted({
      issuerKeyId: receipt.issuerKeyId,
      issuerPublicKey: receipt.issuerPublicKey,
      occurredAt: receipt.issuedAt,
    });
    assertContributionReceiptPolicy(receipt);
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

function parseLifecycleEvent(value) {
  try {
    return normalizeContributionReceiptLifecycleEvent(JSON.parse(value));
  } catch {
    throw new ContributionReceiptStoreValidationError("Stored Contribution Receipt lifecycle event is invalid.");
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

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new ContributionReceiptStoreValidationError(`${label} must be a UTC ISO-8601 instant.`);
  }
  return Date.parse(value);
}

function optionalUtcInstant(value, label) {
  if (value === null || value === undefined) return null;
  requireUtcInstant(value, label);
  return value;
}

function latestReviewDecisions(attestations) {
  const latest = new Map();
  for (const attestation of attestations) {
    const existing = latest.get(attestation.claimType);
    const attestedTime = Date.parse(attestation.attestedAt);
    const existingTime = existing ? Date.parse(existing.attestedAt) : Number.NEGATIVE_INFINITY;
    if (
      !existing ||
      attestedTime > existingTime ||
      (attestedTime === existingTime && attestation.id > existing.id)
    ) {
      latest.set(attestation.claimType, attestation);
    }
  }
  return latest;
}

function earliestInstant(...values) {
  let earliest = null;
  let earliestTime = Number.POSITIVE_INFINITY;
  for (const value of values.filter(Boolean)) {
    const time = Date.parse(value);
    if (time < earliestTime) {
      earliest = value;
      earliestTime = time;
    }
  }
  return earliest;
}
