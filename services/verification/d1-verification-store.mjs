import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  assertIndependentVerification,
  normalizeVerificationAttestation,
  verificationClaimTypes,
  verifyVerificationAttestationSignature,
} from "../../packages/protocol/verification-attestation.mjs";
import {
  normalizeVerificationReplayEvidence,
  verificationReplayEvidenceHash,
} from "../../packages/protocol/verification-replay-evidence.mjs";
import { normalizeLeanRunnerResult } from "../../packages/protocol/lean-runner.mjs";
import { closedAlphaReviewLimits } from "../../packages/domain/attempt-policy.mjs";

export class VerificationStoreConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationStoreConflictError";
  }
}

export class VerificationStoreValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationStoreValidationError";
  }
}

export class VerificationStoreNotFoundError extends Error {
  constructor(id) {
    super(`Verification assignment ${id} was not found.`);
    this.name = "VerificationStoreNotFoundError";
  }
}

export class VerificationStoreCapacityError extends Error {
  constructor(limit = closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson) {
    super(`This Person already has the closed-alpha limit of ${limit} active independent reviews. Existing work must be completed or declined before another review can be assigned.`);
    this.name = "VerificationStoreCapacityError";
    this.limit = limit;
  }
}

/**
 * Internal persistence adapter. Participant routes are mediated by a separate
 * owner-scoped repository; this store never receives a browser identity.
 */
export class D1VerificationStore {
  constructor(database) {
    this.database = database;
  }

  async assign({ id, artifactBundleManifestHash, claimType, verifierPersonId, assignedAt }) {
    requireIdentifier(id, "assignment id");
    requireSha256(artifactBundleManifestHash, "artifactBundleManifestHash");
    requireIdentifier(verifierPersonId, "verifierPersonId");
    requireUtcInstant(assignedAt, "assignedAt");
    if (!verificationClaimTypes.includes(claimType)) {
      throw new VerificationStoreValidationError("Verification assignment claimType is invalid.");
    }
    const bundle = await this.database
      .prepare(
        `SELECT bundle.manifest_hash, attempt.person_id AS attempt_owner_person_id
         FROM artifact_bundles AS bundle
         INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
         WHERE bundle.manifest_hash = ?`,
      )
      .bind(artifactBundleManifestHash)
      .first();
    if (!bundle) throw new VerificationStoreValidationError("Verification assignment references an unknown Artifact Bundle.");
    assertIndependentVerification(bundle.attempt_owner_person_id, verifierPersonId);
    const verifier = await this.database.prepare("SELECT id FROM persons WHERE id = ?").bind(verifierPersonId).first();
    if (!verifier) throw new VerificationStoreValidationError("Verification assignment references an unknown verifier Person.");

    const existing = await this.database
      .prepare(
        `SELECT * FROM verification_assignments
         WHERE artifact_bundle_manifest_hash = ? AND claim_type = ? AND verifier_person_id = ?`,
      )
      .bind(artifactBundleManifestHash, claimType, verifierPersonId)
      .first();
    if (existing) return { assignment: toAssignment(existing), created: false };
    const existingId = await this.database
      .prepare("SELECT id FROM verification_assignments WHERE id = ?")
      .bind(id)
      .first();
    if (existingId) {
      throw new VerificationStoreConflictError("Verification assignment id is already bound to different immutable work.");
    }

    const assignment = {
      id,
      artifactBundleManifestHash,
      claimType,
      attemptOwnerPersonId: bundle.attempt_owner_person_id,
      verifierPersonId,
      status: "assigned",
      assignedAt,
      acceptedAt: null,
      declinedAt: null,
      completedAt: null,
    };
    const event = await createEvent({
      id: `verification-event:${id}:assigned`,
      assignment,
      sequence: 1,
      eventType: "assignment_created",
      occurredAt: assignedAt,
      payload: { artifactBundleManifestHash, claimType, verifierPersonId },
    });
    const results = await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO verification_assignments (
            id, artifact_bundle_manifest_hash, claim_type, attempt_owner_person_id,
            verifier_person_id, status, assigned_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (
            SELECT COUNT(*)
            FROM verification_assignments
            WHERE verifier_person_id = ? AND status IN ('assigned', 'accepted')
          ) < ?`,
        )
        .bind(
          id, artifactBundleManifestHash, claimType, bundle.attempt_owner_person_id,
          verifierPersonId, "assigned", assignedAt, assignedAt,
          verifierPersonId, closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson,
        ),
      insertAssignmentCreatedEventStatement(this.database, event, id),
    ]);
    const stored = await this.database
      .prepare(
        `SELECT * FROM verification_assignments
         WHERE artifact_bundle_manifest_hash = ? AND claim_type = ? AND verifier_person_id = ?`,
      )
      .bind(artifactBundleManifestHash, claimType, verifierPersonId)
      .first();
    if (!stored) throw new VerificationStoreCapacityError();
    return {
      assignment: toAssignment(stored),
      created: Number(results[0]?.meta?.changes ?? 0) === 1,
    };
  }

  async accept(assignmentId, verifierPersonId, acceptedAt) {
    const current = await this.requireAssignment(assignmentId);
    assertAssignmentVerifier(current, verifierPersonId);
    requireUtcInstant(acceptedAt, "acceptedAt");
    const eventInput = {
      id: `verification-event:${assignmentId}:accepted`,
      eventType: "assignment_accepted",
      occurredAt: acceptedAt,
      payload: { verifierPersonId },
    };
    if (current.status === "accepted") {
      if (current.acceptedAt !== acceptedAt) {
        throw new VerificationStoreConflictError("Assignment is already accepted with different immutable timing.");
      }
      await this.ensureLegacyTransitionEvent({
        assignment: current,
        eventInput,
        expectedStatus: "accepted",
      });
      return current;
    }
    if (current.status !== "assigned") throw new VerificationStoreConflictError(`Assignment cannot be accepted from ${current.status}.`);
    assertAtOrAfter(acceptedAt, current.assignedAt, "acceptedAt");
    const next = Object.freeze({ ...current, status: "accepted", acceptedAt });
    return this.persistAssignmentTransition({
      current,
      next,
      updatedAt: acceptedAt,
      eventInput,
    });
  }

  async decline(assignmentId, verifierPersonId, declinedAt) {
    const current = await this.requireAssignment(assignmentId);
    assertAssignmentVerifier(current, verifierPersonId);
    requireUtcInstant(declinedAt, "declinedAt");
    const eventInput = {
      id: `verification-event:${assignmentId}:declined`,
      eventType: "assignment_declined",
      occurredAt: declinedAt,
      payload: { verifierPersonId },
    };
    if (current.status === "declined") {
      if (current.declinedAt !== declinedAt) {
        throw new VerificationStoreConflictError("Assignment is already declined with different immutable timing.");
      }
      await this.ensureLegacyTransitionEvent({
        assignment: current,
        eventInput,
        expectedStatus: "declined",
      });
      return current;
    }
    if (current.status !== "assigned") throw new VerificationStoreConflictError(`Assignment cannot be declined from ${current.status}.`);
    assertAtOrAfter(declinedAt, current.assignedAt, "declinedAt");
    const next = Object.freeze({ ...current, status: "declined", declinedAt });
    return this.persistAssignmentTransition({
      current,
      next,
      updatedAt: declinedAt,
      eventInput,
    });
  }

  async recordAttestation(attestation) {
    const normalized = normalizeVerificationAttestation(attestation);
    const assignment = await this.requireAssignment(normalized.assignmentId);
    const canonicalPayload = canonicalJson(normalized);
    const existing = await this.database
      .prepare("SELECT * FROM verification_attestations WHERE assignment_id = ?")
      .bind(normalized.assignmentId)
      .first();
    if (existing) {
      if (existing.canonical_payload !== canonicalPayload) {
        throw new VerificationStoreConflictError("An assignment already has different immutable attestation evidence.");
      }
    }
    if (!existing && assignment.status !== "accepted") {
      throw new VerificationStoreConflictError(`Assignment cannot receive an attestation from ${assignment.status}.`);
    }
    if (existing && !["accepted", "completed"].includes(assignment.status)) {
      throw new VerificationStoreConflictError(`Stored attestation cannot close an assignment from ${assignment.status}.`);
    }
    if (
      assignment.artifactBundleManifestHash !== normalized.artifactBundleHash ||
      assignment.claimType !== normalized.claimType ||
      assignment.verifierPersonId !== normalized.verifierPersonId
    ) {
      throw new VerificationStoreValidationError("Verification attestation does not match its assignment.");
    }
    if (!assignment.acceptedAt) {
      throw new VerificationStoreConflictError("Verification attestation requires an accepted assignment.");
    }
    assertAtOrAfter(normalized.attestedAt, assignment.acceptedAt, "attestedAt");
    if (assignment.status === "accepted") {
      await this.assertCanonicalAcceptanceHistory(assignment);
    } else {
      await this.assertCanonicalCompletedHistory(assignment, normalized);
    }
    assertIndependentVerification(assignment.attemptOwnerPersonId, normalized.verifierPersonId);
    await this.assertReviewDelegation(normalized);
    if (!await verifyVerificationAttestationSignature(normalized)) {
      throw new VerificationStoreValidationError("Verification attestation Agent signature or payload hash is invalid.");
    }
    const evidence = await this.database.prepare("SELECT content_hash FROM artifact_objects WHERE content_hash = ?").bind(normalized.evidenceHash).first();
    if (!evidence) throw new VerificationStoreValidationError("Verification attestation evidence is not in the immutable artifact index.");
    // Positive reproducibility and kernel-acceptance claims both need this
    // review Agent's terminal isolated replay. A conflict declaration or
    // integrity flag must remain recordable before execution so it can stop a
    // misleading positive claim.
    if (
      ["bundle_reproducible", "kernel_accepted"].includes(normalized.claimType) &&
      normalized.decision === "attested"
    ) {
      await this.assertFreshReplayEvidence(assignment, normalized);
    }

    if (existing) {
      assertStoredAttestationProjection(existing, normalized);
      await this.ensureAttestationClosure(normalized);
      return { attestation: toAttestation(existing), created: false };
    }

    const next = Object.freeze({ ...assignment, status: "completed", completedAt: normalized.attestedAt });
    const event = await createEvent({
      id: `verification-event:${assignment.id}:attestation`,
      assignment: next,
      sequence: 3,
      eventType: "attestation_recorded",
      occurredAt: normalized.attestedAt,
      payload: { attestationId: normalized.id, decision: normalized.decision, evidenceHash: normalized.evidenceHash },
    });
    try {
      await this.database.batch([
        insertAttestationStatement(this.database, normalized, canonicalPayload),
        updateAssignmentStatement(this.database, assignment, next, normalized.attestedAt),
        insertGuardedAttestationEventStatement(
          this.database,
          event,
          next,
          normalized.attestedAt,
        ),
      ]);
    } catch (cause) {
      // A concurrent canonical retry may win the unique assignment insert.
      // D1 batches are transactional, so a failed batch cannot leave a new
      // partial projection. Reload only the immutable winner and fail closed
      // when it is not byte-for-byte the same attestation.
      const raced = await this.database
        .prepare("SELECT * FROM verification_attestations WHERE assignment_id = ?")
        .bind(normalized.assignmentId)
        .first();
      if (!raced) throw cause;
      if (raced.canonical_payload !== canonicalPayload) {
        throw new VerificationStoreConflictError("An assignment already has different immutable attestation evidence.");
      }
      assertStoredAttestationProjection(raced, normalized);
      await this.ensureAttestationClosure(normalized);
      return { attestation: toAttestation(raced), created: false };
    }
    return {
      attestation: Object.freeze({
        id: normalized.id,
        assignmentId: normalized.assignmentId,
        artifactBundleHash: normalized.artifactBundleHash,
        claimType: normalized.claimType,
        verifierPersonId: normalized.verifierPersonId,
        decision: normalized.decision,
        evidenceHash: normalized.evidenceHash,
        attestedAt: normalized.attestedAt,
      }),
      created: true,
    };
  }

  /**
   * Canonical retries also repair a partial record produced by an older
   * non-transactional store version. Only an exact immutable attestation may
   * complete the matching projection/event; any mismatch remains a conflict.
   */
  async ensureAttestationClosure(attestation) {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await this.requireAssignment(attestation.assignmentId);
      if (
        current.artifactBundleManifestHash !== attestation.artifactBundleHash ||
        current.claimType !== attestation.claimType ||
        current.verifierPersonId !== attestation.verifierPersonId
      ) {
        throw new VerificationStoreValidationError("Stored attestation no longer matches its assignment.");
      }
      if (!["accepted", "completed"].includes(current.status)) {
        throw new VerificationStoreConflictError(`Stored attestation cannot close an assignment from ${current.status}.`);
      }
      if (current.status === "completed" && current.completedAt !== attestation.attestedAt) {
        throw new VerificationStoreConflictError("Stored attestation completion time does not match its assignment.");
      }
      if (current.status === "completed") {
        await this.assertCanonicalCompletedHistory(current, attestation);
        return;
      }
      await this.assertCanonicalAcceptanceHistory(current);

      const next = Object.freeze({ ...current, status: "completed", completedAt: attestation.attestedAt });
      const event = await createEvent({
        id: `verification-event:${attestation.assignmentId}:attestation`,
        assignment: next,
        sequence: 3,
        eventType: "attestation_recorded",
        occurredAt: attestation.attestedAt,
        payload: {
          attestationId: attestation.id,
          decision: attestation.decision,
          evidenceHash: attestation.evidenceHash,
        },
      });

      try {
        await this.database.batch([
          updateAssignmentStatement(this.database, current, next, attestation.attestedAt),
          insertGuardedAttestationEventStatement(
            this.database,
            event,
            next,
            attestation.attestedAt,
          ),
        ]);
        lastError = null;
      } catch (cause) {
        lastError = cause;
      }
    }
    throw new VerificationStoreConflictError(
      lastError instanceof Error
        ? `Canonical attestation retry could not restore its projection and event: ${lastError.message}`
        : "Canonical attestation retry could not restore its projection and event.",
    );
  }

  async listEvents(assignmentId) {
    const rows = await this.database
      .prepare("SELECT * FROM verification_assignment_events WHERE assignment_id = ? ORDER BY sequence ASC")
      .bind(assignmentId)
      .all();
    return (rows.results ?? []).map((row) => Object.freeze({
      id: row.id,
      sequence: Number(row.sequence),
      eventType: row.event_type,
      status: row.status,
      payloadHash: row.payload_hash,
      occurredAt: row.occurred_at,
    }));
  }

  async requireAssignment(assignmentId) {
    const row = await this.database.prepare("SELECT * FROM verification_assignments WHERE id = ?").bind(assignmentId).first();
    if (!row) throw new VerificationStoreNotFoundError(assignmentId);
    return toAssignment(row);
  }

  async assertReviewDelegation(attestation) {
    const row = await this.database
      .prepare(
        `SELECT
          agent.owner_person_id, agent.public_key AS agent_public_key, agent.status AS agent_status,
          certificate.owner_person_id AS certificate_owner_person_id,
          certificate.agent_id AS certificate_agent_id,
          certificate.agent_public_key AS certificate_agent_public_key,
          certificate.scopes_json, certificate.valid_from, certificate.valid_until,
          revocation.revoked_at,
          COALESCE(key_revocation.revoked_at, signer.revoked_at) AS signer_key_revoked_at
         FROM agents AS agent
         INNER JOIN delegation_certificates AS certificate ON certificate.id = ?
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = signer.id
         WHERE agent.id = ?`,
      )
      .bind(attestation.delegationCertificateId, attestation.verifierAgentId)
      .first();
    if (
      !row || row.agent_status !== "active" || row.owner_person_id !== attestation.verifierPersonId ||
      row.certificate_owner_person_id !== attestation.verifierPersonId ||
      row.certificate_agent_id !== attestation.verifierAgentId ||
      row.agent_public_key !== attestation.verifierAgentPublicKey ||
      row.certificate_agent_public_key !== attestation.verifierAgentPublicKey
    ) {
      throw new VerificationStoreValidationError("Verification attestation does not match a valid review Agent delegation.");
    }
    let scopes;
    try {
      scopes = JSON.parse(row.scopes_json);
    } catch {
      throw new VerificationStoreValidationError("Stored review delegation scopes are not valid JSON.");
    }
    const eventTime = Date.parse(attestation.attestedAt);
    if (
      !Array.isArray(scopes) || !scopes.includes("review") ||
      eventTime < Date.parse(row.valid_from) || eventTime >= Date.parse(row.valid_until) ||
      (row.revoked_at && eventTime >= Date.parse(row.revoked_at)) ||
      (row.signer_key_revoked_at && eventTime >= Date.parse(row.signer_key_revoked_at))
    ) {
      throw new VerificationStoreValidationError("Verification attestation occurred outside valid review delegation authority.");
    }
  }

  /**
   * A positive reproducibility or kernel-acceptance claim must cite the
   * terminal output of this exact review Agent's fresh isolated replay. A
   * plain indexed note, an owner Run, or another review Agent's replay cannot
   * satisfy either truth boundary.
   */
  async assertFreshReplayEvidence(assignment, attestation) {
    const row = await this.database
      .prepare(
        `SELECT
          evidence.id, evidence.replay_id, evidence.assignment_id, evidence.run_id,
          evidence.artifact_bundle_manifest_hash, evidence.runner_result_hash,
          evidence.evidence_hash, evidence.canonical_evidence, evidence.recorded_at,
          replay.assignment_id AS replay_assignment_id, replay.run_id AS replay_run_id,
          replay.requested_at AS replay_requested_at,
          replay.requester_person_id, replay.requester_agent_id,
          replay.delegation_certificate_id, replay.artifact_bundle_manifest_hash AS replay_artifact_bundle_manifest_hash,
          run.state AS run_state, run.started_at AS run_started_at, run.finished_at AS run_finished_at,
          run.artifact_bundle_hash AS run_artifact_bundle_hash,
          run.runner_result_hash AS run_runner_result_hash,
          result.result_hash, result.canonical_result
         FROM verification_replay_evidence AS evidence
         INNER JOIN verification_replays AS replay ON replay.id = evidence.replay_id
         INNER JOIN runs AS run ON run.id = evidence.run_id
         INNER JOIN run_results AS result ON result.run_id = evidence.run_id
         WHERE evidence.assignment_id = ? AND evidence.evidence_hash = ?
           AND replay.requester_person_id = ? AND replay.requester_agent_id = ?
           AND replay.delegation_certificate_id = ?`,
      )
      .bind(
        assignment.id,
        attestation.evidenceHash,
        attestation.verifierPersonId,
        attestation.verifierAgentId,
        attestation.delegationCertificateId,
      )
      .first();
    if (!row) {
      throw new VerificationStoreValidationError(
        `${attestation.claimType} requires terminal fresh replay evidence from this assigned review Agent.`,
      );
    }
    if (
      row.replay_assignment_id !== assignment.id ||
      row.replay_run_id !== row.run_id ||
      row.artifact_bundle_manifest_hash !== assignment.artifactBundleManifestHash ||
      row.replay_artifact_bundle_manifest_hash !== assignment.artifactBundleManifestHash ||
      row.run_artifact_bundle_hash !== assignment.artifactBundleManifestHash ||
      row.run_runner_result_hash !== row.runner_result_hash ||
      row.result_hash !== row.runner_result_hash ||
      Date.parse(row.replay_requested_at) < Date.parse(assignment.acceptedAt) ||
      Date.parse(row.recorded_at) < Date.parse(row.replay_requested_at) ||
      Date.parse(row.recorded_at) > Date.parse(attestation.attestedAt)
    ) {
      throw new VerificationStoreValidationError("Fresh replay evidence does not match its assigned Bundle or terminal Runner result.");
    }

    let evidence;
    let storedResult;
    try {
      evidence = await normalizeVerificationReplayEvidence(JSON.parse(row.canonical_evidence));
      storedResult = normalizeLeanRunnerResult(JSON.parse(row.canonical_result));
    } catch (cause) {
      throw new VerificationStoreValidationError(
        cause instanceof Error ? `Fresh replay evidence is malformed: ${cause.message}` : "Fresh replay evidence is malformed.",
      );
    }
    const projectionFailures = [
      [canonicalJson(evidence) === row.canonical_evidence, "canonical_evidence"],
      [canonicalJson(storedResult) === row.canonical_result, "canonical_result"],
      [await verificationReplayEvidenceHash(evidence) === row.evidence_hash, "evidence_hash"],
      [evidence.id === row.id, "evidence_id"],
      [evidence.replayId === row.replay_id, "replay_id"],
      [evidence.assignmentId === assignment.id, "assignment_id"],
      [evidence.runId === row.run_id, "run_id"],
      [evidence.artifactBundleHash === assignment.artifactBundleManifestHash, "artifact_bundle_hash"],
      [evidence.runnerResultHash === row.runner_result_hash, "runner_result_hash"],
      [evidence.recordedAt === row.recorded_at, "recorded_at"],
      [canonicalJson(evidence.runnerResult) === row.canonical_result, "embedded_runner_result"],
      [Date.parse(storedResult.startedAt) === Date.parse(row.run_started_at), "started_at_projection"],
      [Date.parse(storedResult.finishedAt) === Date.parse(row.run_finished_at), "finished_at_projection"],
      [Date.parse(storedResult.startedAt) >= Date.parse(row.replay_requested_at), "replay_started_after_request"],
      [Date.parse(storedResult.finishedAt) <= Date.parse(evidence.recordedAt), "evidence_recorded_after_finish"],
    ].filter(([passed]) => !passed).map(([, label]) => label);
    if (projectionFailures.length > 0) {
      throw new VerificationStoreValidationError(
        `Fresh replay evidence is not an exact immutable projection of the terminal Runner result (${projectionFailures.join(", ")}).`,
      );
    }
    if (
      row.run_state !== "succeeded" ||
      storedResult.status !== "succeeded" ||
      storedResult.kernelStatus !== "accepted" ||
      Object.values(storedResult.checks).some((check) => check !== "passed")
    ) {
      throw new VerificationStoreValidationError(
        `${attestation.claimType} requires a succeeded fresh replay with kernel acceptance and every required check passed.`,
      );
    }
  }

  async nextEventSequence(assignmentId) {
    const row = await this.database
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM verification_assignment_events WHERE assignment_id = ?")
      .bind(assignmentId)
      .first();
    return Number(row?.next_sequence ?? 1);
  }

  async persistAssignmentTransition({ current, next, updatedAt, eventInput }) {
    const event = await createEvent({
      ...eventInput,
      assignment: next,
      sequence: await this.nextEventSequence(current.id),
    });
    let results;
    try {
      results = await this.database.batch([
        updateAssignmentStatement(this.database, current, next, updatedAt),
        insertGuardedAssignmentEventStatement(this.database, event, next, updatedAt),
      ]);
    } catch (cause) {
      const latest = await this.requireAssignment(current.id);
      if (sameAssignmentProjection(latest, next)) {
        await this.ensureLegacyTransitionEvent({
          assignment: latest,
          eventInput,
          expectedStatus: next.status,
        });
        return latest;
      }
      throw new VerificationStoreConflictError(
        cause instanceof Error
          ? `Verification assignment transition conflicted with immutable evidence: ${cause.message}`
          : "Verification assignment transition conflicted with immutable evidence.",
      );
    }
    if (changes(results[0]) !== 1 || changes(results[1]) !== 1) {
      const latest = await this.requireAssignment(current.id);
      if (sameAssignmentProjection(latest, next)) {
        await this.ensureLegacyTransitionEvent({
          assignment: latest,
          eventInput,
          expectedStatus: next.status,
        });
        return latest;
      }
      throw new VerificationStoreConflictError(
        "Verification assignment transition did not persist its projection and immutable event together.",
      );
    }
    return next;
  }

  async ensureLegacyTransitionEvent({ assignment, eventInput, expectedStatus }) {
    if (assignment.status !== expectedStatus) {
      throw new VerificationStoreConflictError(
        `Canonical ${expectedStatus} retry does not match the stored assignment projection.`,
      );
    }
    const expectedEvent = await createEvent({
      ...eventInput,
      assignment,
      sequence: 2,
    });
    const existing = await this.database
      .prepare("SELECT * FROM verification_assignment_events WHERE id = ?")
      .bind(eventInput.id)
      .first();
    const history = await this.database
      .prepare("SELECT * FROM verification_assignment_events WHERE assignment_id = ? ORDER BY sequence ASC")
      .bind(assignment.id)
      .all();
    if (existing) {
      if ((history.results ?? []).length !== 2) {
        throw new VerificationStoreConflictError(
          `Canonical ${expectedStatus} retry found unexpected later or incomplete immutable assignment history.`,
        );
      }
      await this.assertCanonicalAssignmentCreatedEvent(assignment, history.results[0]);
      assertStoredEventProjection(existing, expectedEvent);
      assertStoredEventProjection(history.results[1], expectedEvent);
      return;
    }

    if ((history.results ?? []).length !== 1) {
      throw new VerificationStoreConflictError(
        `Canonical ${expectedStatus} repair is unsafe after later or incomplete immutable assignment history.`,
      );
    }
    await this.assertCanonicalAssignmentCreatedEvent(assignment, history.results[0]);
    try {
      const inserted = await insertEventStatement(this.database, expectedEvent).run();
      if (changes(inserted) !== 1) {
        throw new VerificationStoreConflictError(
          `Canonical ${expectedStatus} repair did not append its immutable event.`,
        );
      }
    } catch (cause) {
      const raced = await this.database
        .prepare("SELECT * FROM verification_assignment_events WHERE id = ?")
        .bind(eventInput.id)
        .first();
      if (!raced) {
        throw new VerificationStoreConflictError(
          cause instanceof Error
            ? `Canonical ${expectedStatus} repair conflicted with later immutable history: ${cause.message}`
            : `Canonical ${expectedStatus} repair conflicted with later immutable history.`,
        );
      }
      assertStoredEventProjection(raced, expectedEvent);
    }
  }

  async assertCanonicalAcceptanceHistory(assignment) {
    if (
      assignment.status !== "accepted" ||
      !assignment.acceptedAt ||
      assignment.declinedAt !== null ||
      assignment.completedAt !== null
    ) {
      throw new VerificationStoreConflictError("Verification attestation requires an accepted assignment.");
    }
    const history = await this.database
      .prepare("SELECT * FROM verification_assignment_events WHERE assignment_id = ? ORDER BY sequence ASC")
      .bind(assignment.id)
      .all();
    if ((history.results ?? []).length !== 2) {
      throw new VerificationStoreConflictError(
        "Verification attestation requires exact immutable [created, accepted] assignment history.",
      );
    }
    await this.assertCanonicalAssignmentCreatedEvent(assignment, history.results[0]);
    const acceptedProjection = Object.freeze({
      ...assignment,
      status: "accepted",
      declinedAt: null,
      completedAt: null,
    });
    const expected = await createEvent({
      id: `verification-event:${assignment.id}:accepted`,
      assignment: acceptedProjection,
      sequence: 2,
      eventType: "assignment_accepted",
      occurredAt: assignment.acceptedAt,
      payload: { verifierPersonId: assignment.verifierPersonId },
    });
    try {
      assertStoredEventProjection(history.results[1], expected);
    } catch {
      throw new VerificationStoreConflictError(
        "Verification attestation requires the canonical immutable assignment acceptance event.",
      );
    }
  }

  async assertCanonicalCompletedHistory(assignment, attestation) {
    if (
      assignment.status !== "completed" ||
      !assignment.acceptedAt ||
      assignment.declinedAt !== null ||
      assignment.completedAt !== attestation.attestedAt
    ) {
      throw new VerificationStoreConflictError(
        "Stored attestation completion time does not match its assignment.",
      );
    }
    const history = await this.database
      .prepare("SELECT * FROM verification_assignment_events WHERE assignment_id = ? ORDER BY sequence ASC")
      .bind(assignment.id)
      .all();
    if ((history.results ?? []).length !== 3) {
      throw new VerificationStoreConflictError(
        "Completed verification requires exact immutable [created, accepted, attestation] history.",
      );
    }
    await this.assertCanonicalAssignmentCreatedEvent(assignment, history.results[0]);
    const acceptedProjection = Object.freeze({
      ...assignment,
      status: "accepted",
      declinedAt: null,
      completedAt: null,
    });
    const acceptedEvent = await createEvent({
      id: `verification-event:${assignment.id}:accepted`,
      assignment: acceptedProjection,
      sequence: 2,
      eventType: "assignment_accepted",
      occurredAt: assignment.acceptedAt,
      payload: { verifierPersonId: assignment.verifierPersonId },
    });
    assertStoredEventProjection(history.results[1], acceptedEvent);
    const attestationEvent = await createEvent({
      id: `verification-event:${assignment.id}:attestation`,
      assignment,
      sequence: 3,
      eventType: "attestation_recorded",
      occurredAt: attestation.attestedAt,
      payload: {
        attestationId: attestation.id,
        decision: attestation.decision,
        evidenceHash: attestation.evidenceHash,
      },
    });
    assertStoredEventProjection(history.results[2], attestationEvent);
  }

  async assertCanonicalAssignmentCreatedEvent(assignment, row = null) {
    const assignedProjection = Object.freeze({
      ...assignment,
      status: "assigned",
      acceptedAt: null,
      declinedAt: null,
      completedAt: null,
    });
    const expected = await createEvent({
      id: `verification-event:${assignment.id}:assigned`,
      assignment: assignedProjection,
      sequence: 1,
      eventType: "assignment_created",
      occurredAt: assignment.assignedAt,
      payload: {
        artifactBundleManifestHash: assignment.artifactBundleManifestHash,
        claimType: assignment.claimType,
        verifierPersonId: assignment.verifierPersonId,
      },
    });
    const stored = row ?? await this.database
      .prepare("SELECT * FROM verification_assignment_events WHERE id = ?")
      .bind(expected.id)
      .first();
    if (!stored) {
      throw new VerificationStoreConflictError(
        "Verification assignment is missing its canonical immutable creation event.",
      );
    }
    assertStoredEventProjection(stored, expected);
  }
}

function toAssignment(row) {
  return Object.freeze({
    id: row.id,
    artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
    claimType: row.claim_type,
    attemptOwnerPersonId: row.attempt_owner_person_id,
    verifierPersonId: row.verifier_person_id,
    status: row.status,
    assignedAt: row.assigned_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    completedAt: row.completed_at,
  });
}

function toAttestation(row) {
  return Object.freeze({
    id: row.id,
    assignmentId: row.assignment_id,
    artifactBundleHash: row.artifact_bundle_manifest_hash,
    claimType: row.claim_type,
    verifierPersonId: row.verifier_person_id,
    decision: row.decision,
    evidenceHash: row.evidence_hash,
    attestedAt: row.attested_at,
  });
}

function assertAssignmentVerifier(assignment, verifierPersonId) {
  requireIdentifier(verifierPersonId, "verifierPersonId");
  if (assignment.verifierPersonId !== verifierPersonId) {
    throw new VerificationStoreValidationError("Only the assigned verifier Person can transition this assignment.");
  }
}

async function createEvent({ id, assignment, sequence, eventType, occurredAt, payload }) {
  const eventPayload = {
    protocolVersion: "pw-verification-assignment-event-v1",
    assignmentId: assignment.id,
    sequence,
    eventType,
    status: assignment.status,
    occurredAt,
    ...payload,
  };
  return {
    id,
    assignmentId: assignment.id,
    sequence,
    eventType,
    status: assignment.status,
    payloadHash: await sha256Canonical(eventPayload),
    canonicalPayload: canonicalJson(eventPayload),
    occurredAt,
  };
}

function insertEventStatement(database, event) {
  return database
    .prepare(
      `INSERT INTO verification_assignment_events (
        id, assignment_id, sequence, event_type, status, payload_hash, canonical_payload, occurred_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(event.id, event.assignmentId, event.sequence, event.eventType, event.status, event.payloadHash, event.canonicalPayload, event.occurredAt);
}

function insertAttestationStatement(database, attestation, canonicalPayload) {
  return database
    .prepare(
      `INSERT INTO verification_attestations (
        id, assignment_id, artifact_bundle_manifest_hash, claim_type,
        verifier_person_id, verifier_agent_id, delegation_certificate_id,
        verifier_agent_public_key, decision, evidence_hash, canonical_payload,
        payload_hash, signature, attested_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      attestation.id, attestation.assignmentId, attestation.artifactBundleHash, attestation.claimType,
      attestation.verifierPersonId, attestation.verifierAgentId, attestation.delegationCertificateId,
      attestation.verifierAgentPublicKey, attestation.decision, attestation.evidenceHash, canonicalPayload,
      attestation.payloadHash, attestation.signature, attestation.attestedAt,
    );
}

function updateAssignmentStatement(database, current, next, updatedAt) {
  return database
    .prepare(
      `UPDATE verification_assignments
       SET status = ?, accepted_at = ?, declined_at = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND status = ?`,
    )
    .bind(next.status, next.acceptedAt, next.declinedAt, next.completedAt, updatedAt, current.id, current.status);
}

function insertGuardedAssignmentEventStatement(database, event, assignment, updatedAt) {
  return database
    .prepare(
      `WITH projection_guard AS (
        SELECT 1
        FROM verification_assignments
        WHERE id = ? AND status = ?
          AND accepted_at IS ? AND declined_at IS ? AND completed_at IS ?
          AND updated_at = ?
      )
      INSERT INTO verification_assignment_events (
        id, assignment_id, sequence, event_type, status, payload_hash, canonical_payload, occurred_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      FROM projection_guard
      UNION ALL
      SELECT ?, NULL, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM projection_guard)`,
    )
    .bind(
      assignment.id,
      assignment.status,
      assignment.acceptedAt,
      assignment.declinedAt,
      assignment.completedAt,
      updatedAt,
      event.id,
      event.assignmentId,
      event.sequence,
      event.eventType,
      event.status,
      event.payloadHash,
      event.canonicalPayload,
      event.occurredAt,
      event.id,
      event.sequence,
      event.eventType,
      event.status,
      event.payloadHash,
      event.canonicalPayload,
      event.occurredAt,
    );
}

function insertGuardedAttestationEventStatement(database, event, assignment, updatedAt) {
  return database
    .prepare(
      `WITH projection_guard AS (
        SELECT 1
        FROM verification_assignments
        WHERE id = ? AND status = 'completed'
          AND accepted_at IS ? AND declined_at IS NULL
          AND completed_at = ? AND updated_at = ?
      )
      INSERT INTO verification_assignment_events (
        id, assignment_id, sequence, event_type, status, payload_hash, canonical_payload, occurred_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      FROM projection_guard
      UNION ALL
      SELECT ?, NULL, ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM projection_guard)`,
    )
    .bind(
      assignment.id,
      assignment.acceptedAt,
      assignment.completedAt,
      updatedAt,
      event.id,
      event.assignmentId,
      event.sequence,
      event.eventType,
      event.status,
      event.payloadHash,
      event.canonicalPayload,
      event.occurredAt,
      event.id,
      event.sequence,
      event.eventType,
      event.status,
      event.payloadHash,
      event.canonicalPayload,
      event.occurredAt,
    );
}

function sameAssignmentProjection(actual, expected) {
  return [
    "id",
    "artifactBundleManifestHash",
    "claimType",
    "attemptOwnerPersonId",
    "verifierPersonId",
    "status",
    "assignedAt",
    "acceptedAt",
    "declinedAt",
    "completedAt",
  ].every((key) => actual[key] === expected[key]);
}

function changes(result) {
  const value = result?.meta?.changes ?? 0;
  return Number.isSafeInteger(value) ? value : Number(value);
}

function assertStoredAttestationProjection(row, attestation) {
  if (
    row.id !== attestation.id ||
    row.assignment_id !== attestation.assignmentId ||
    row.artifact_bundle_manifest_hash !== attestation.artifactBundleHash ||
    row.claim_type !== attestation.claimType ||
    row.verifier_person_id !== attestation.verifierPersonId ||
    row.verifier_agent_id !== attestation.verifierAgentId ||
    row.delegation_certificate_id !== attestation.delegationCertificateId ||
    row.verifier_agent_public_key !== attestation.verifierAgentPublicKey ||
    row.decision !== attestation.decision ||
    row.evidence_hash !== attestation.evidenceHash ||
    row.payload_hash !== attestation.payloadHash ||
    row.signature !== attestation.signature ||
    row.attested_at !== attestation.attestedAt
  ) {
    throw new VerificationStoreConflictError("Stored attestation projection does not match its canonical payload.");
  }
}

function assertStoredEventProjection(row, event) {
  if (
    row.id !== event.id ||
    row.assignment_id !== event.assignmentId ||
    Number(row.sequence) !== event.sequence ||
    row.event_type !== event.eventType ||
    row.status !== event.status ||
    row.payload_hash !== event.payloadHash ||
    row.canonical_payload !== event.canonicalPayload ||
    row.occurred_at !== event.occurredAt
  ) {
    throw new VerificationStoreConflictError("Stored attestation event does not match its canonical payload.");
  }
}

function insertAssignmentCreatedEventStatement(database, event, assignmentId) {
  return database
    .prepare(
      `INSERT INTO verification_assignment_events (
        id, assignment_id, sequence, event_type, status, payload_hash, canonical_payload, occurred_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM verification_assignments WHERE id = ?)`,
    )
    .bind(
      event.id, event.assignmentId, event.sequence, event.eventType, event.status,
      event.payloadHash, event.canonicalPayload, event.occurredAt, assignmentId,
    );
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 240) {
    throw new VerificationStoreValidationError(`${label} must be a non-empty identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new VerificationStoreValidationError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new VerificationStoreValidationError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function assertAtOrAfter(value, baseline, label) {
  if (Date.parse(value) < Date.parse(baseline)) {
    throw new VerificationStoreValidationError(`${label} cannot precede the current assignment state.`);
  }
}
