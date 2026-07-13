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
    if (current.status === "accepted" && current.acceptedAt === acceptedAt) return current;
    if (current.status !== "assigned") throw new VerificationStoreConflictError(`Assignment cannot be accepted from ${current.status}.`);
    requireUtcInstant(acceptedAt, "acceptedAt");
    assertAtOrAfter(acceptedAt, current.assignedAt, "acceptedAt");
    const next = Object.freeze({ ...current, status: "accepted", acceptedAt });
    await this.writeAssignment(current, next, acceptedAt);
    await this.appendEvent({
      id: `verification-event:${assignmentId}:accepted`,
      assignment: next,
      eventType: "assignment_accepted",
      occurredAt: acceptedAt,
      payload: { verifierPersonId },
    });
    return next;
  }

  async decline(assignmentId, verifierPersonId, declinedAt) {
    const current = await this.requireAssignment(assignmentId);
    assertAssignmentVerifier(current, verifierPersonId);
    if (current.status === "declined" && current.declinedAt === declinedAt) return current;
    if (current.status !== "assigned") throw new VerificationStoreConflictError(`Assignment cannot be declined from ${current.status}.`);
    requireUtcInstant(declinedAt, "declinedAt");
    assertAtOrAfter(declinedAt, current.assignedAt, "declinedAt");
    const next = Object.freeze({ ...current, status: "declined", declinedAt });
    await this.writeAssignment(current, next, declinedAt);
    await this.appendEvent({
      id: `verification-event:${assignmentId}:declined`,
      assignment: next,
      eventType: "assignment_declined",
      occurredAt: declinedAt,
      payload: { verifierPersonId },
    });
    return next;
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
      return { attestation: toAttestation(existing), created: false };
    }
    if (assignment.status !== "accepted") {
      throw new VerificationStoreConflictError(`Assignment cannot receive an attestation from ${assignment.status}.`);
    }
    if (
      assignment.artifactBundleManifestHash !== normalized.artifactBundleHash ||
      assignment.claimType !== normalized.claimType ||
      assignment.verifierPersonId !== normalized.verifierPersonId
    ) {
      throw new VerificationStoreValidationError("Verification attestation does not match its assignment.");
    }
    assertIndependentVerification(assignment.attemptOwnerPersonId, normalized.verifierPersonId);
    await this.assertReviewDelegation(normalized);
    if (!await verifyVerificationAttestationSignature(normalized)) {
      throw new VerificationStoreValidationError("Verification attestation Agent signature or payload hash is invalid.");
    }
    const evidence = await this.database.prepare("SELECT content_hash FROM artifact_objects WHERE content_hash = ?").bind(normalized.evidenceHash).first();
    if (!evidence) throw new VerificationStoreValidationError("Verification attestation evidence is not in the immutable artifact index.");
    if (normalized.claimType === "bundle_reproducible") {
      await this.assertFreshReplayEvidence(assignment, normalized);
    }

    const next = Object.freeze({ ...assignment, status: "completed", completedAt: normalized.attestedAt });
    await this.database
      .prepare(
        `INSERT INTO verification_attestations (
          id, assignment_id, artifact_bundle_manifest_hash, claim_type,
          verifier_person_id, verifier_agent_id, delegation_certificate_id,
          verifier_agent_public_key, decision, evidence_hash, canonical_payload,
          payload_hash, signature, attested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        normalized.id, normalized.assignmentId, normalized.artifactBundleHash, normalized.claimType,
        normalized.verifierPersonId, normalized.verifierAgentId, normalized.delegationCertificateId,
        normalized.verifierAgentPublicKey, normalized.decision, normalized.evidenceHash, canonicalPayload,
        normalized.payloadHash, normalized.signature, normalized.attestedAt,
      )
      .run();
    await this.writeAssignment(assignment, next, normalized.attestedAt);
    await this.appendEvent({
      id: `verification-event:${assignment.id}:attestation`,
      assignment: next,
      eventType: "attestation_recorded",
      occurredAt: normalized.attestedAt,
      payload: { attestationId: normalized.id, decision: normalized.decision, evidenceHash: normalized.evidenceHash },
    });
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
   * Reproducibility is the one claim whose evidence must be the terminal
   * output of this exact review Agent's fresh isolated replay. A plain indexed
   * note, an owner Run, or another review Agent's replay cannot satisfy it.
   */
  async assertFreshReplayEvidence(assignment, attestation) {
    const row = await this.database
      .prepare(
        `SELECT
          evidence.id, evidence.replay_id, evidence.assignment_id, evidence.run_id,
          evidence.artifact_bundle_manifest_hash, evidence.runner_result_hash,
          evidence.evidence_hash, evidence.canonical_evidence, evidence.recorded_at,
          replay.requester_person_id, replay.requester_agent_id,
          replay.delegation_certificate_id, replay.artifact_bundle_manifest_hash AS replay_artifact_bundle_manifest_hash,
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
      throw new VerificationStoreValidationError("bundle_reproducible requires terminal fresh replay evidence from this assigned review Agent.");
    }
    if (
      row.artifact_bundle_manifest_hash !== assignment.artifactBundleManifestHash ||
      row.replay_artifact_bundle_manifest_hash !== assignment.artifactBundleManifestHash ||
      row.run_runner_result_hash !== row.runner_result_hash ||
      row.result_hash !== row.runner_result_hash
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
    if (
      canonicalJson(evidence) !== row.canonical_evidence ||
      canonicalJson(storedResult) !== row.canonical_result ||
      await verificationReplayEvidenceHash(evidence) !== row.evidence_hash ||
      evidence.id !== row.id ||
      evidence.replayId !== row.replay_id ||
      evidence.assignmentId !== assignment.id ||
      evidence.runId !== row.run_id ||
      evidence.artifactBundleHash !== assignment.artifactBundleManifestHash ||
      evidence.runnerResultHash !== row.runner_result_hash ||
      evidence.recordedAt !== row.recorded_at ||
      canonicalJson(evidence.runnerResult) !== row.canonical_result
    ) {
      throw new VerificationStoreValidationError("Fresh replay evidence is not an exact immutable projection of the terminal Runner result.");
    }
  }

  async writeAssignment(current, next, updatedAt) {
    const changed = await this.database
      .prepare(
        `UPDATE verification_assignments
         SET status = ?, accepted_at = ?, declined_at = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND status = ?`,
      )
      .bind(next.status, next.acceptedAt, next.declinedAt, next.completedAt, updatedAt, current.id, current.status)
      .run();
    if (changed.meta.changes !== 1) {
      throw new VerificationStoreConflictError("Verification assignment changed before this transition could be persisted.");
    }
  }

  async appendEvent({ id, assignment, eventType, occurredAt, payload }) {
    const row = await this.database
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM verification_assignment_events WHERE assignment_id = ?")
      .bind(assignment.id)
      .first();
    const event = await createEvent({
      id,
      assignment,
      sequence: Number(row?.next_sequence ?? 1),
      eventType,
      occurredAt,
      payload,
    });
    await insertEventStatement(this.database, event).run();
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
