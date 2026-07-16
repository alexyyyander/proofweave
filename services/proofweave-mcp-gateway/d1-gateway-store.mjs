import { normalizeVerificationAttestation } from "../../packages/protocol/verification-attestation.mjs";
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  D1VerificationStore,
  VerificationStoreConflictError,
  VerificationStoreNotFoundError,
  VerificationStoreValidationError,
} from "../verification/d1-verification-store.mjs";
import { D1VerificationMarketStore } from "../verification/d1-verification-market-store.mjs";
import { D1R2ArtifactStore } from "../artifacts/d1-r2-artifact-store.mjs";
import { maxInlineArtifactObjectBytes } from "../artifacts/d1-inline-artifact-store.mjs";
import { D1RunStore } from "../lean-runner/d1-run-store.mjs";
import { closedAlphaAttemptLimits } from "../../packages/domain/attempt-policy.mjs";
import {
  D1ResearchGraphStore,
  ResearchGraphConflictError,
  ResearchGraphNotFoundError,
  ResearchGraphValidationError,
} from "../research/d1-research-graph-store.mjs";

export class GatewayStoreAuthorizationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GatewayStoreAuthorizationError";
  }
}

export class GatewayStoreValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "GatewayStoreValidationError";
  }
}

export class GatewayStoreNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "GatewayStoreNotFoundError";
  }
}

export class GatewayStoreConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "GatewayStoreConflictError";
  }
}

export class GatewayStoreRateLimitError extends Error {
  constructor(limit = closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson) {
    super(`This Person already has the closed-alpha limit of ${limit} active Attempts. Existing work must become terminal before another provisional Attempt can open.`);
    this.name = "GatewayStoreRateLimitError";
    this.limit = limit;
  }
}

/**
 * Remote-MCP write boundary for an already OAuth-authenticated Agent
 * installation. The MCP transport deliberately passes no raw access token to
 * this store. Before D1VerificationStore handles cryptographic validation, we
 * bind every identity field in the submitted Attestation to the selected OAuth
 * installation and hide assignments addressed to other Persons.
 */
export class D1RemoteMcpGatewayStore {
  constructor(databaseOrOptions) {
    const { database, bucket, artifactStore, runnerDispatcher } = normalizeGatewayBindings(databaseOrOptions);
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1RemoteMcpGatewayStore requires a D1 database binding.");
    }
    this.database = database;
    this.verificationStore = new D1VerificationStore(database);
    this.verificationMarketStore = new D1VerificationMarketStore(database);
    this.artifactStore = artifactStore ?? (bucket ? new D1R2ArtifactStore({ database, bucket }) : null);
    this.runStore = new D1RunStore(database);
    this.researchGraphStore = new D1ResearchGraphStore(database);
    this.runnerDispatcher = runnerDispatcher;
  }

  async getConnectionAuthority(principal) {
    assertPrincipalScope(principal, "catalog:read");
    const installation = await this.requireInstallation(principal);
    return Object.freeze({
      personId: principal.personId,
      agentInstallationId: principal.agentInstallationId,
      agentId: installation.agentId,
      agentLabel: installation.agentLabel,
      agentPublicKey: installation.agentPublicKey,
      delegationCertificateId: installation.delegationCertificateId,
      oauthScopes: Object.freeze([...principal.scopes]),
    });
  }

  async listFrontier(principal) {
    assertPrincipalScope(principal, "catalog:read");
    const rows = await this.catalogRows();
    return Object.freeze(toCatalogRecords(rows));
  }

  async inspectProblem(principal, slug) {
    assertPrincipalScope(principal, "catalog:read");
    requireSlug(slug);
    const rows = await this.catalogRows(slug);
    return toCatalogRecords(rows)[0] ?? null;
  }

  async createAttempt(principal, input) {
    assertPrincipalScope(principal, "attempt:create");
    requireCreateAttemptInput(input);
    const installation = await this.requireInstallation(principal, input.delegationScope);
    const problem = await this.database
      .prepare(
        `SELECT revision.id, revision.slug, revision.title
         FROM problem_revisions AS revision
         INNER JOIN projects AS project ON project.id = revision.project_id
         WHERE revision.slug = ? AND project.kind = 'frontier' AND project.visibility = 'public'`,
      )
      .bind(input.problemSlug)
      .first();
    if (!problem) throw new GatewayStoreNotFoundError("Frontier problem not found.");

    const now = new Date().toISOString();
    const generatedId = `attempt:${crypto.randomUUID()}`;
    const inserted = await this.database
      .prepare(
        `INSERT OR IGNORE INTO agent_attempts (
          id, person_id, problem_revision_id, agent_id, agent_label,
          delegation_certificate_id, delegation_scope, idempotency_key, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE (
          SELECT COUNT(*)
          FROM agent_attempts
          WHERE person_id = ? AND status = 'active'
        ) < ?`,
      )
      .bind(
        generatedId,
        principal.personId,
        problem.id,
        installation.agentId,
        installation.agentLabel,
        installation.delegationCertificateId,
        input.delegationScope,
        input.idempotencyKey,
        now,
        principal.personId,
        closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson,
      )
      .run();
    const row = await this.database
      .prepare(`${attemptSelect} WHERE attempt.person_id = ? AND attempt.idempotency_key = ?`)
      .bind(principal.personId, input.idempotencyKey)
      .first();
    if (!row) throw new GatewayStoreRateLimitError();
    if (
      row.problem_revision_id !== problem.id || row.agent_id !== installation.agentId ||
      row.agent_label !== installation.agentLabel ||
      row.delegation_certificate_id !== installation.delegationCertificateId ||
      row.delegation_scope !== input.delegationScope
    ) {
      throw new GatewayStoreConflictError("An idempotency key cannot be reused for a different Attempt.");
    }
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO agent_attempt_events (
          id, attempt_id, sequence, event_type, message, idempotency_key, occurred_at
        ) VALUES (?, ?, 1, 'attempt_created', ?, ?, ?)`,
      )
      .bind(
        `attempt-created:${row.id}`,
        row.id,
        `Attempt opened by ${installation.agentLabel} under delegated ${input.delegationScope} authority. This is agent-reported activity, not verification.`,
        `attempt-created:${input.idempotencyKey}`,
        now,
      )
      .run();
    const attempt = await this.findAttemptForInstallation(principal, installation, row.id);
    if (!attempt) throw new Error("Attempt record became unavailable.");
    return Object.freeze({
      attempt,
      idempotentReplay: inserted.meta.changes !== 1,
      verificationState: "agent_reported_only",
    });
  }

  async reportProgress(principal, input) {
    assertPrincipalScope(principal, "progress:write");
    requireProgressInput(input);
    const installation = await this.requireInstallation(principal);
    const attempt = await this.findAttemptForInstallation(principal, installation, input.attemptId);
    if (!attempt) throw new GatewayStoreNotFoundError("Attempt not found.");
    if (attempt.status !== "active") {
      throw new GatewayStoreConflictError("Progress can only be reported while an Attempt is active.");
    }
    if (attempt.delegationScope !== "formalize" && attempt.delegationScope !== "prove") {
      throw new GatewayStoreValidationError("Attempt does not have delegated formalize or prove authority.");
    }
    await this.requireInstallation(principal, attempt.delegationScope);
    const existing = await this.findEvent(input.attemptId, input.idempotencyKey);
    if (existing) {
      if (existing.message !== input.message || existing.progressPercent !== input.progressPercent) {
        throw new GatewayStoreConflictError("An idempotency key cannot be reused for different progress.");
      }
      return Object.freeze({ event: existing, idempotentReplay: true, verificationState: "agent_reported_only" });
    }
    const now = new Date().toISOString();
    const inserted = await this.database
      .prepare(
        `INSERT OR IGNORE INTO agent_attempt_events (
          id, attempt_id, sequence, event_type, message, progress_percent,
          idempotency_key, occurred_at
        )
        SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, 'agent_reported', ?, ?, ?, ?
        FROM agent_attempt_events
        WHERE attempt_id = ?`,
      )
      .bind(`attempt-event:${crypto.randomUUID()}`, input.attemptId, input.message, input.progressPercent, input.idempotencyKey, now, input.attemptId)
      .run();
    const event = await this.findEvent(input.attemptId, input.idempotencyKey);
    if (!event) throw new Error("Progress event insert did not produce a readable record.");
    if (inserted.meta.changes === 1) {
      await this.database
        .prepare("UPDATE agent_attempts SET last_progress_percent = ?, updated_at = ? WHERE id = ? AND person_id = ?")
        .bind(input.progressPercent, now, input.attemptId, principal.personId)
        .run();
    }
    return Object.freeze({ event, idempotentReplay: inserted.meta.changes !== 1, verificationState: "agent_reported_only" });
  }

  async inspectResearchGraph(principal, slug) {
    assertPrincipalScope(principal, "catalog:read");
    const problem = await this.inspectProblem(principal, slug);
    if (!problem) throw new GatewayStoreNotFoundError("Frontier problem not found.");
    return Object.freeze({
      problem: Object.freeze({ id: problem.id, slug: problem.slug, title: problem.title }),
      graph: await this.researchGraphStore.readProblemGraph(problem.id),
      verificationState: "shared_research_only",
    });
  }

  async publishResearchCheckpoint(principal, checkpoint) {
    assertPrincipalScope(principal, "progress:write");
    requireIdentifier(checkpoint?.attemptId, "Research checkpoint Attempt id", 160);
    const installation = await this.requireInstallation(principal);
    const attempt = await this.findAttemptForInstallation(principal, installation, checkpoint.attemptId);
    if (!attempt) throw new GatewayStoreNotFoundError("Attempt not found.");
    if (attempt.delegationScope !== "formalize" && attempt.delegationScope !== "prove") {
      throw new GatewayStoreValidationError("Attempt does not have delegated formalize or prove authority.");
    }
    await this.requireInstallation(principal, attempt.delegationScope);
    try {
      const published = await this.researchGraphStore.publishCheckpoint({
        principal,
        installation,
        attempt,
        checkpoint,
      });
      return Object.freeze({
        ...published,
        verificationState: "shared_research_only",
        contributionState: "not_credited",
      });
    } catch (error) {
      if (error instanceof ResearchGraphNotFoundError) {
        throw new GatewayStoreNotFoundError(error.message);
      }
      if (error instanceof ResearchGraphConflictError) {
        throw new GatewayStoreConflictError(error.message);
      }
      if (error instanceof ResearchGraphValidationError) {
        throw new GatewayStoreValidationError(error.message);
      }
      throw error;
    }
  }

  async getAttempt(principal, attemptId) {
    assertPrincipalScope(principal, "attempt:read");
    requireIdentifier(attemptId, "Attempt id");
    const installation = await this.requireInstallation(principal);
    const attempt = await this.findAttemptForInstallation(principal, installation, attemptId);
    if (!attempt) throw new GatewayStoreNotFoundError("Attempt not found.");
    return Object.freeze({ attempt });
  }

  async listAttempts(principal, input = {}) {
    assertPrincipalScope(principal, "attempt:read");
    const limit = attemptListLimit(input.limit);
    const installation = await this.requireInstallation(principal);
    const rows = await this.database
      .prepare(
        `${attemptSelect}
         WHERE attempt.person_id = ? AND attempt.agent_id = ?
           AND attempt.delegation_certificate_id = ?
         ORDER BY attempt.updated_at DESC, attempt.created_at DESC
         LIMIT ?`,
      )
      .bind(
        principal.personId,
        installation.agentId,
        installation.delegationCertificateId,
        limit,
      )
      .all();
    const attempts = await Promise.all((rows.results ?? []).map((row) =>
      this.findAttemptForInstallation(principal, installation, row.id),
    ));
    return Object.freeze({
      attempts: Object.freeze(attempts.filter(Boolean)),
      verificationState: "agent_reported_only",
    });
  }

  async listReviewAssignments(principal, input = {}) {
    assertPrincipalScope(principal, "verification:replay");
    const installation = await this.requireInstallation(principal, "review");
    const limit = reviewAssignmentListLimit(input.limit);
    const status = optionalReviewAssignmentStatus(input.status);
    const statement = this.database.prepare(
      `${reviewAssignmentSummarySelect}
       WHERE assignment.verifier_person_id = ?
         ${status ? "AND assignment.status = ?" : ""}
       ORDER BY CASE assignment.status
         WHEN 'assigned' THEN 0
         WHEN 'accepted' THEN 1
         WHEN 'completed' THEN 2
         ELSE 3
       END, assignment.updated_at DESC, assignment.id ASC
       LIMIT ?`,
    );
    const rows = status
      ? await statement.bind(
        installation.agentId,
        installation.delegationCertificateId,
        installation.agentId,
        installation.delegationCertificateId,
        principal.personId,
        status,
        limit,
      ).all()
      : await statement.bind(
        installation.agentId,
        installation.delegationCertificateId,
        installation.agentId,
        installation.delegationCertificateId,
        principal.personId,
        limit,
      ).all();
    return Object.freeze({
      assignments: Object.freeze((rows.results ?? []).map(toReviewAssignmentSummary)),
      reviewAgent: Object.freeze({
        agentId: installation.agentId,
        delegationCertificateId: installation.delegationCertificateId,
      }),
      note: "Assignments belong to the reviewer Person. Replay counts shown here are restricted to this exact review Agent and delegation.",
    });
  }

  async getReviewAssignment(principal, assignmentId) {
    assertPrincipalScope(principal, "verification:replay");
    requireIdentifier(assignmentId, "Verification assignment id", 240);
    const installation = await this.requireInstallation(principal, "review");
    const row = await this.database.prepare(
      `${reviewAssignmentDetailSelect}
       WHERE assignment.id = ? AND assignment.verifier_person_id = ?`,
    ).bind(
      installation.agentId,
      installation.delegationCertificateId,
      installation.agentId,
      installation.delegationCertificateId,
      assignmentId,
      principal.personId,
    ).first();
    if (!row) throw new GatewayStoreNotFoundError("Verification assignment not found.");
    const [events, replays] = await Promise.all([
      this.database.prepare(
        `SELECT id, sequence, event_type, status, payload_hash, occurred_at
         FROM verification_assignment_events
         WHERE assignment_id = ?
         ORDER BY sequence ASC`,
      ).bind(assignmentId).all(),
      this.database.prepare(
        `SELECT replay.id, replay.run_id, replay.idempotency_key, replay.requested_at,
                run.state, run.queued_at, run.started_at, run.finished_at,
                run.runner_result_hash, evidence.evidence_hash, evidence.recorded_at
         FROM verification_replays AS replay
         INNER JOIN runs AS run ON run.id = replay.run_id
         LEFT JOIN verification_replay_evidence AS evidence ON evidence.replay_id = replay.id
         WHERE replay.assignment_id = ? AND replay.requester_agent_id = ?
           AND replay.delegation_certificate_id = ?
           AND replay.agent_installation_id = ?
         ORDER BY replay.requested_at DESC, replay.id ASC
         LIMIT 25`,
      ).bind(
        assignmentId,
        installation.agentId,
        installation.delegationCertificateId,
        principal.agentInstallationId,
      ).all(),
    ]);
    return Object.freeze({
      assignment: toReviewAssignmentSummary(row),
      target: Object.freeze({
        problemSlug: row.problem_slug,
        projectSlug: row.project_slug,
        title: row.problem_title,
        declaration: row.target_key,
        informalStatement: row.informal_statement,
        leanStatement: row.lean_statement,
      }),
      bundle: Object.freeze({
        manifestHash: row.artifact_bundle_manifest_hash,
        createdAt: row.bundle_created_at,
        manifest: parseStoredBundleManifest(row.canonical_manifest),
      }),
      events: Object.freeze((events.results ?? []).map(toReviewAssignmentEvent)),
      replays: Object.freeze((replays.results ?? []).map(toReviewAgentReplaySummary)),
      note: "This is controlled review context. It is not a fresh replay, attestation, contribution Receipt, or credit award.",
    });
  }

  async putArtifactObject(principal, input) {
    assertPrincipalScope(principal, "artifact:write");
    requireArtifactObjectInput(input);
    const installation = await this.requireInstallation(principal);
    const attempt = await this.requireArtifactAttempt(principal, installation, input.attemptId);
    await this.requireInstallation(principal, attempt.delegationScope);
    const object = await this.requireArtifactStore().putObject({
      bytes: decodeBase64Url(input.contentBase64Url),
      filename: input.filename,
      contentType: input.contentType,
    });
    return Object.freeze({
      object,
      storageState: "object_staged_only",
      verificationState: "not_verified",
    });
  }

  async stageArtifactBundle(principal, bundle) {
    assertPrincipalScope(principal, "artifact:write");
    requireArtifactBundleInput(bundle);
    const installation = await this.requireInstallation(principal);
    const attempt = await this.requireArtifactAttempt(principal, installation, bundle.attemptId);
    await this.requireInstallation(principal, attempt.delegationScope);
    const staged = await this.requireArtifactStore().stageBundle(bundle);
    const verificationMarket = await this.verificationMarketStore.publishJobsForBundle(
      staged.bundle.manifestHash,
      new Date().toISOString(),
    );
    return Object.freeze({
      ...staged,
      verificationMarket,
      storageState: "bundle_staged_only",
      verificationState: "not_verified",
    });
  }

  async requestRunnerRun(principal, input) {
    assertPrincipalScope(principal, "run:request");
    requireRunnerRequestInput(input);
    const installation = await this.requireInstallation(principal);
    const attempt = await this.requireArtifactAttempt(principal, installation, input.attemptId);
    await this.requireInstallation(principal, attempt.delegationScope);
    if (!this.runnerDispatcher || typeof this.runnerDispatcher.queueBundle !== "function") {
      throw new GatewayStoreValidationError("The isolated Lean Runner dispatch is not configured for this remote gateway.");
    }
    const queued = await this.runnerDispatcher.queueBundle({
      attempt,
      artifactBundleHash: input.artifactBundleHash,
      idempotencyKey: input.idempotencyKey,
    });
    return Object.freeze({
      run: queued.run,
      runCreated: queued.runCreated,
      queueDeliveryState: queued.delivery?.deliveryState ?? null,
      verificationState: "not_verified",
    });
  }

  /**
   * Queue a new workspace only for the Person addressed by an accepted review
   * assignment. This intentionally does not look up the submitter's Attempt
   * through the caller's installation, so `run:request` remains owner-only.
   */
  async requestVerificationReplay(principal, input) {
    assertPrincipalScope(principal, "verification:replay");
    requireVerificationReplayRequestInput(input);
    const installation = await this.requireInstallation(principal, "review");
    const assignment = await this.requireAcceptedReplayAssignment(input.assignmentId, principal.personId);
    const existing = await this.findVerificationReplay({
      assignmentId: assignment.id,
      requesterAgentId: installation.agentId,
      delegationCertificateId: installation.delegationCertificateId,
      idempotencyKey: input.idempotencyKey,
    });
    if (existing) {
      const run = await this.requireRunForAttempt(existing.runId, assignment.attempt.id);
      const replayEvidence = await this.findVerificationReplayEvidence(existing.id);
      return Object.freeze({
        replay: existing,
        run,
        runCreated: false,
        queueDeliveryState: null,
        replayEvidence,
        verificationState: replayEvidence ? "fresh_replay_evidence_recorded" : "fresh_replay_recorded",
      });
    }
    if (!this.runnerDispatcher || typeof this.runnerDispatcher.queueBundle !== "function") {
      throw new GatewayStoreValidationError("The isolated Lean Runner dispatch is not configured for this remote gateway.");
    }

    const identity = await verificationReplayIdentity({
      assignmentId: assignment.id,
      requesterAgentId: installation.agentId,
      delegationCertificateId: installation.delegationCertificateId,
      idempotencyKey: input.idempotencyKey,
    });
    const queued = await this.runnerDispatcher.queueBundle({
      attempt: assignment.attempt,
      artifactBundleHash: assignment.artifactBundleManifestHash,
      idempotencyKey: identity.runnerIdempotencyKey,
      runId: identity.runId,
      beforeDispatch: async (run) => this.recordVerificationReplay({
        id: identity.id,
        assignment,
        installation,
        principal,
        idempotencyKey: input.idempotencyKey,
        run,
      }),
    });
    const replay = await this.findVerificationReplay({
      assignmentId: assignment.id,
      requesterAgentId: installation.agentId,
      delegationCertificateId: installation.delegationCertificateId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!replay) throw new Error("Verification replay was queued without immutable replay provenance.");
    const replayEvidence = await this.findVerificationReplayEvidence(replay.id);
    return Object.freeze({
      replay,
      run: queued.run,
      runCreated: queued.runCreated,
      queueDeliveryState: queued.delivery?.deliveryState ?? null,
      replayEvidence,
      verificationState: replayEvidence ? "fresh_replay_evidence_recorded" : "fresh_replay_recorded",
    });
  }

  async getVerificationReplay(principal, input) {
    assertPrincipalScope(principal, "verification:replay");
    requireVerificationReplayLookupInput(input);
    const installation = await this.requireInstallation(principal, "review");
    const assignment = await this.requireReplayAssignmentForPerson(input.assignmentId, principal.personId);
    const replay = await this.findVerificationReplay({
      assignmentId: assignment.id,
      requesterAgentId: installation.agentId,
      delegationCertificateId: installation.delegationCertificateId,
      idempotencyKey: input.idempotencyKey,
    });
    if (!replay) throw new GatewayStoreNotFoundError("Verification replay not found.");
    const run = await this.requireRunForAttempt(replay.runId, assignment.attempt.id);
    const replayEvidence = await this.findVerificationReplayEvidence(replay.id);
    return Object.freeze({
      replay,
      run,
      events: Object.freeze(await this.runStore.listEvents(run.id)),
      replayEvidence,
      verificationState: replayEvidence ? "fresh_replay_evidence_recorded" : "fresh_replay_recorded",
    });
  }

  async getRunnerRun(principal, input) {
    assertPrincipalScope(principal, "run:read");
    requireRunnerLookupInput(input);
    const installation = await this.requireInstallation(principal);
    const attempt = await this.requireArtifactAttempt(principal, installation, input.attemptId);
    await this.requireInstallation(principal, attempt.delegationScope);
    const run = await this.requireRunForAttempt(input.runId, attempt.id);
    return Object.freeze({
      run,
      events: Object.freeze(await this.runStore.listEvents(run.id)),
      verificationState: run.runnerResultHash ? "runner_evidence_recorded" : "not_verified",
    });
  }

  async cancelRunnerRun(principal, input) {
    assertPrincipalScope(principal, "run:cancel");
    requireRunnerLookupInput(input);
    const installation = await this.requireInstallation(principal);
    const attempt = await this.requireArtifactAttempt(principal, installation, input.attemptId);
    await this.requireInstallation(principal, attempt.delegationScope);
    const run = await this.requireRunForAttempt(input.runId, attempt.id);
    const cancelled = await this.runStore.requestCancellation(run.id, new Date().toISOString());
    return Object.freeze({
      run: cancelled,
      cancellationState: cancelled.state === "cancelled" ? "cancelled_before_execution" : "cancellation_requested",
      verificationState: cancelled.runnerResultHash ? "runner_evidence_recorded" : "not_verified",
    });
  }

  async submitVerificationAttestation(principal, attestation) {
    assertVerificationPrincipal(principal);
    let normalized;
    try {
      normalized = normalizeVerificationAttestation(attestation);
    } catch (error) {
      throw new GatewayStoreValidationError(error instanceof Error ? error.message : "Verification Attestation is invalid.");
    }
    const installation = await this.requireInstallation(principal, "review");
    if (
      normalized.verifierPersonId !== principal.personId ||
      normalized.verifierAgentId !== installation.agentId ||
      normalized.delegationCertificateId !== installation.delegationCertificateId ||
      normalized.verifierAgentPublicKey !== installation.agentPublicKey
    ) {
      throw new GatewayStoreAuthorizationError("Verification Attestation does not match the authorized Agent installation.");
    }
    await this.requireAssignedVerifier(normalized.assignmentId, principal.personId);
    try {
      return await this.verificationStore.recordAttestation(normalized);
    } catch (error) {
      if (
        error instanceof VerificationStoreConflictError ||
        error instanceof VerificationStoreNotFoundError ||
        error instanceof VerificationStoreValidationError
      ) {
        throw new GatewayStoreValidationError(error.message);
      }
      throw error;
    }
  }

  async requireInstallation(principal, requiredScope = null) {
    const now = new Date().toISOString();
    const row = await this.database
      .prepare(
        `SELECT installation.agent_id, installation.delegation_certificate_id,
                installation.label AS installation_label, agent.label AS agent_label,
                agent.public_key AS agent_public_key, certificate.scopes_json
         FROM agent_installations AS installation
         INNER JOIN agents AS agent ON agent.id = installation.agent_id
         INNER JOIN delegation_certificates AS certificate
           ON certificate.id = installation.delegation_certificate_id
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = signer.id
         WHERE installation.id = ?
           AND installation.person_id = ?
           AND installation.client_id = ?
           AND installation.status = 'active'
           AND installation.revoked_at IS NULL
           AND agent.owner_person_id = installation.person_id
           AND agent.status = 'active'
           AND agent.revoked_at IS NULL
           AND certificate.owner_person_id = installation.person_id
           AND certificate.agent_id = installation.agent_id
           AND certificate.valid_from <= ?
           AND certificate.valid_until > ?
           AND revocation.id IS NULL
           AND COALESCE(key_revocation.revoked_at, signer.revoked_at) IS NULL`,
      )
      .bind(principal.agentInstallationId, principal.personId, principal.clientId, now, now)
      .first();
    const scopes = row && parseScopes(row.scopes_json);
    if (!row || (requiredScope && !scopes?.includes(requiredScope))) {
      throw new GatewayStoreAuthorizationError(
        requiredScope
          ? `The authorized Agent installation does not have active ${requiredScope} delegation authority.`
          : "The authorized Agent installation is not active.",
      );
    }
    return Object.freeze({
      agentId: row.agent_id,
      delegationCertificateId: row.delegation_certificate_id,
      agentLabel: row.agent_label,
      agentPublicKey: row.agent_public_key,
    });
  }

  async requireAssignedVerifier(assignmentId, personId) {
    const assignment = await this.database
      .prepare("SELECT verifier_person_id FROM verification_assignments WHERE id = ?")
      .bind(assignmentId)
      .first();
    if (!assignment || assignment.verifier_person_id !== personId) {
      throw new GatewayStoreAuthorizationError("The requested verification assignment is not addressed to this Person.");
    }
  }

  async requireAcceptedReplayAssignment(assignmentId, personId) {
    const assignment = await this.requireReplayAssignmentForPerson(assignmentId, personId);
    if (assignment.status !== "accepted") {
      throw new GatewayStoreConflictError(`Verification replay can only be requested from an accepted assignment, not ${assignment.status}.`);
    }
    return assignment;
  }

  async requireReplayAssignmentForPerson(assignmentId, personId) {
    requireIdentifier(assignmentId, "Verification assignment id", 240);
    const row = await this.database
      .prepare(
        `SELECT assignment.id, assignment.status, assignment.artifact_bundle_manifest_hash,
                bundle.attempt_id, bundle.problem_revision_id
         FROM verification_assignments AS assignment
         INNER JOIN artifact_bundles AS bundle
           ON bundle.manifest_hash = assignment.artifact_bundle_manifest_hash
         WHERE assignment.id = ? AND assignment.verifier_person_id = ?`,
      )
      .bind(assignmentId, personId)
      .first();
    if (!row) throw new GatewayStoreNotFoundError("Verification assignment not found.");
    return Object.freeze({
      id: row.id,
      status: row.status,
      artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
      attempt: Object.freeze({
        id: row.attempt_id,
        problemRevisionId: row.problem_revision_id,
      }),
    });
  }

  async recordVerificationReplay({ id, assignment, installation, principal, idempotencyKey, run }) {
    const existing = await this.findVerificationReplay({
      assignmentId: assignment.id,
      requesterAgentId: installation.agentId,
      delegationCertificateId: installation.delegationCertificateId,
      idempotencyKey,
    });
    if (existing) {
      assertSameVerificationReplay(existing, { id, assignment, installation, principal, idempotencyKey, run });
      return existing;
    }
    const requestedAt = new Date().toISOString();
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO verification_replays (
          id, assignment_id, run_id, artifact_bundle_manifest_hash,
          requester_person_id, requester_agent_id, delegation_certificate_id,
          agent_installation_id, idempotency_key, requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        assignment.id,
        run.id,
        assignment.artifactBundleManifestHash,
        principal.personId,
        installation.agentId,
        installation.delegationCertificateId,
        principal.agentInstallationId,
        idempotencyKey,
        requestedAt,
      )
      .run();
    const stored = await this.findVerificationReplay({
      assignmentId: assignment.id,
      requesterAgentId: installation.agentId,
      delegationCertificateId: installation.delegationCertificateId,
      idempotencyKey,
    });
    if (!stored) throw new GatewayStoreConflictError("Verification replay provenance could not be recorded.");
    assertSameVerificationReplay(stored, { id, assignment, installation, principal, idempotencyKey, run });
    return stored;
  }

  async findVerificationReplay({ assignmentId, requesterAgentId, delegationCertificateId, idempotencyKey }) {
    const row = await this.database
      .prepare(
        `SELECT id, assignment_id, run_id, artifact_bundle_manifest_hash,
                requester_person_id, requester_agent_id, delegation_certificate_id,
                agent_installation_id, idempotency_key, requested_at
         FROM verification_replays
         WHERE assignment_id = ? AND requester_agent_id = ?
           AND delegation_certificate_id = ? AND idempotency_key = ?`,
      )
      .bind(assignmentId, requesterAgentId, delegationCertificateId, idempotencyKey)
      .first();
    return row ? toVerificationReplay(row) : null;
  }

  async findVerificationReplayEvidence(replayId) {
    const row = await this.database
      .prepare(
        `SELECT evidence.id, evidence.replay_id, evidence.run_id,
                evidence.runner_result_hash, evidence.evidence_hash, evidence.recorded_at
         FROM verification_replay_evidence AS evidence
         INNER JOIN run_results AS result ON result.run_id = evidence.run_id
         INNER JOIN runs AS run ON run.id = evidence.run_id
         WHERE evidence.replay_id = ?
           AND result.result_hash = evidence.runner_result_hash
           AND run.runner_result_hash = evidence.runner_result_hash`,
      )
      .bind(replayId)
      .first();
    return row ? Object.freeze({
      id: row.id,
      replayId: row.replay_id,
      runId: row.run_id,
      runnerResultHash: row.runner_result_hash,
      evidenceHash: row.evidence_hash,
      recordedAt: row.recorded_at,
    }) : null;
  }

  requireArtifactStore() {
    if (!this.artifactStore) {
      throw new GatewayStoreValidationError("Artifact storage is not configured for this remote gateway.");
    }
    return this.artifactStore;
  }

  async requireArtifactAttempt(principal, installation, attemptId) {
    requireIdentifier(attemptId, "Attempt id", 160);
    const attempt = await this.findAttemptForInstallation(principal, installation, attemptId);
    if (!attempt) throw new GatewayStoreNotFoundError("Attempt not found.");
    if (attempt.status !== "active") {
      throw new GatewayStoreConflictError("Artifacts can only be staged while an Attempt is active.");
    }
    if (attempt.delegationScope !== "formalize" && attempt.delegationScope !== "prove") {
      throw new GatewayStoreValidationError("Attempt does not have delegated formalize or prove authority.");
    }
    return attempt;
  }

  async requireRunForAttempt(runId, attemptId) {
    requireIdentifier(runId, "Run id", 240);
    const run = await this.runStore.find(runId);
    if (!run || run.attemptId !== attemptId) {
      throw new GatewayStoreNotFoundError("Run not found.");
    }
    return run;
  }

  async findAttemptForInstallation(principal, installation, attemptId) {
    const row = await this.database
      .prepare(
        `${attemptSelect}
         WHERE attempt.id = ? AND attempt.person_id = ? AND attempt.agent_id = ?
           AND attempt.delegation_certificate_id = ?`,
      )
      .bind(attemptId, principal.personId, installation.agentId, installation.delegationCertificateId)
      .first();
    if (!row) return null;
    const events = await this.database
      .prepare(
        `SELECT id, sequence, event_type, message, progress_percent, occurred_at
         FROM agent_attempt_events
         WHERE attempt_id = ?
         ORDER BY sequence ASC`,
      )
      .bind(attemptId)
      .all();
    return Object.freeze({
      id: row.id,
      problemRevisionId: row.problem_revision_id,
      problemSlug: row.problem_slug,
      problemTitle: row.problem_title,
      agentId: row.agent_id,
      agentLabel: row.agent_label,
      delegationCertificateId: row.delegation_certificate_id,
      delegationScope: row.delegation_scope,
      status: row.status,
      lastProgressPercent: row.last_progress_percent,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      events: Object.freeze((events.results ?? []).map(toAttemptEvent)),
      verificationState: "agent_reported_only",
    });
  }

  async findEvent(attemptId, idempotencyKey) {
    const row = await this.database
      .prepare(
        `SELECT id, sequence, event_type, message, progress_percent, occurred_at, idempotency_key
         FROM agent_attempt_events
         WHERE attempt_id = ? AND idempotency_key = ?`,
      )
      .bind(attemptId, idempotencyKey)
      .first();
    return row ? toAttemptEvent(row) : null;
  }

  async catalogRows(slug = null) {
    const result = await this.database
      .prepare(
        `SELECT revision.id AS problem_id, revision.slug AS problem_slug,
                revision.title AS problem_title, revision.domain,
                revision.research_status, revision.informal_statement, revision.lean_statement,
                revision.proof_state, revision.source_correspondence, revision.target_key,
                project.kind AS project_kind, project.title AS project_title,
                project.summary AS project_summary,
                declaration.qualified_name AS declaration_name,
                declaration.declaration_kind, declaration.source_path AS declaration_source_path,
                declaration.source_url AS declaration_source_url,
                declaration.source_line_start AS declaration_source_line_start,
                declaration.source_line_end AS declaration_source_line_end,
                declaration.source_content_hash AS declaration_content_hash,
                snapshot.upstream_name, snapshot.source_url, snapshot.revision_tag,
                snapshot.revision_commit, snapshot.retrieved_at, snapshot.content_hash,
                snapshot.manifest_hash, snapshot.source_license, snapshot.lean_toolchain,
                snapshot.mathlib_revision, claim.claim_type, claim.status AS claim_status,
                claim.evidence_url, claim.recorded_at
         FROM problem_revisions AS revision
         INNER JOIN projects AS project ON project.id = revision.project_id
         INNER JOIN source_snapshots AS snapshot ON snapshot.id = revision.source_snapshot_id
         LEFT JOIN declarations AS declaration
           ON declaration.problem_revision_id = revision.id AND declaration.is_primary = 1
         LEFT JOIN verification_claims AS claim ON claim.problem_revision_id = revision.id
         WHERE project.kind = 'frontier' AND project.visibility = 'public'
           AND (? IS NULL OR revision.slug = ?)
         ORDER BY revision.priority DESC, revision.title ASC, claim.claim_type ASC`,
      )
      .bind(slug, slug)
      .all();
    return result.results ?? [];
  }
}

const attemptSelect = `SELECT
  attempt.id, attempt.person_id, attempt.problem_revision_id,
  revision.slug AS problem_slug, revision.title AS problem_title,
  attempt.agent_id, attempt.agent_label, attempt.delegation_certificate_id,
  attempt.delegation_scope, attempt.status, attempt.last_progress_percent,
  attempt.created_at, attempt.updated_at
 FROM agent_attempts AS attempt
 INNER JOIN problem_revisions AS revision ON revision.id = attempt.problem_revision_id`;

const reviewAssignmentSummarySelect = `SELECT
  assignment.id, assignment.artifact_bundle_manifest_hash, assignment.claim_type,
  assignment.status, assignment.assigned_at, assignment.accepted_at,
  assignment.declined_at, assignment.completed_at, bundle.attempt_id,
  attempt.agent_label, revision.slug AS problem_slug,
  project.slug AS project_slug, revision.title AS problem_title,
  revision.target_key, attestation.id AS attestation_id,
  attestation.decision AS attestation_decision,
  attestation.evidence_hash AS attestation_evidence_hash,
  attestation.attested_at AS attestation_attested_at,
  (SELECT COUNT(*) FROM verification_replays AS exact_replay
   WHERE exact_replay.assignment_id = assignment.id
     AND exact_replay.requester_agent_id = ?
     AND exact_replay.delegation_certificate_id = ?) AS exact_agent_replay_count,
  (SELECT COUNT(*)
   FROM verification_replay_evidence AS exact_evidence
   INNER JOIN verification_replays AS exact_replay
     ON exact_replay.id = exact_evidence.replay_id
   WHERE exact_replay.assignment_id = assignment.id
     AND exact_replay.requester_agent_id = ?
     AND exact_replay.delegation_certificate_id = ?) AS exact_agent_replay_evidence_count
 FROM verification_assignments AS assignment
 INNER JOIN artifact_bundles AS bundle
   ON bundle.manifest_hash = assignment.artifact_bundle_manifest_hash
 INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
 INNER JOIN problem_revisions AS revision ON revision.id = bundle.problem_revision_id
 INNER JOIN projects AS project ON project.id = revision.project_id
 LEFT JOIN verification_attestations AS attestation ON attestation.assignment_id = assignment.id`;

const reviewAssignmentDetailSelect = `SELECT
  assignment.id, assignment.artifact_bundle_manifest_hash, assignment.claim_type,
  assignment.status, assignment.assigned_at, assignment.accepted_at,
  assignment.declined_at, assignment.completed_at, bundle.attempt_id,
  attempt.agent_label, revision.slug AS problem_slug,
  project.slug AS project_slug, revision.title AS problem_title,
  revision.target_key, revision.informal_statement, revision.lean_statement,
  bundle.canonical_manifest, bundle.created_at AS bundle_created_at,
  attestation.id AS attestation_id,
  attestation.decision AS attestation_decision,
  attestation.evidence_hash AS attestation_evidence_hash,
  attestation.attested_at AS attestation_attested_at,
  (SELECT COUNT(*) FROM verification_replays AS exact_replay
   WHERE exact_replay.assignment_id = assignment.id
     AND exact_replay.requester_agent_id = ?
     AND exact_replay.delegation_certificate_id = ?) AS exact_agent_replay_count,
  (SELECT COUNT(*)
   FROM verification_replay_evidence AS exact_evidence
   INNER JOIN verification_replays AS exact_replay
     ON exact_replay.id = exact_evidence.replay_id
   WHERE exact_replay.assignment_id = assignment.id
     AND exact_replay.requester_agent_id = ?
     AND exact_replay.delegation_certificate_id = ?) AS exact_agent_replay_evidence_count
 FROM verification_assignments AS assignment
 INNER JOIN artifact_bundles AS bundle
   ON bundle.manifest_hash = assignment.artifact_bundle_manifest_hash
 INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
 INNER JOIN problem_revisions AS revision ON revision.id = bundle.problem_revision_id
 INNER JOIN projects AS project ON project.id = revision.project_id
 LEFT JOIN verification_attestations AS attestation ON attestation.assignment_id = assignment.id`;

function assertVerificationPrincipal(principal) {
  if (
    !principal || typeof principal !== "object" ||
    !nonEmptyIdentifier(principal.clientId) ||
    !nonEmptyIdentifier(principal.personId) ||
    !nonEmptyIdentifier(principal.agentInstallationId) ||
    !Array.isArray(principal.scopes) ||
    !principal.scopes.includes("verification:write")
  ) {
    throw new GatewayStoreAuthorizationError("The OAuth principal does not grant verification:write.");
  }
}

function nonEmptyIdentifier(value) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 240;
}

function parseScopes(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((scope) => typeof scope === "string")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function assertPrincipalScope(principal, scope) {
  if (
    !principal || typeof principal !== "object" ||
    !nonEmptyIdentifier(principal.clientId) ||
    !nonEmptyIdentifier(principal.personId) ||
    !nonEmptyIdentifier(principal.agentInstallationId) ||
    !Array.isArray(principal.scopes) ||
    !principal.scopes.includes(scope)
  ) {
    throw new GatewayStoreAuthorizationError(`The OAuth principal does not grant ${scope}.`);
  }
}

function requireCreateAttemptInput(input) {
  if (!input || typeof input !== "object") {
    throw new GatewayStoreValidationError("Attempt input is required.");
  }
  requireSlug(input.problemSlug);
  requireIdentifier(input.idempotencyKey, "Idempotency key", 160);
  if (input.delegationScope !== "formalize" && input.delegationScope !== "prove") {
    throw new GatewayStoreValidationError("Attempt delegationScope must be formalize or prove.");
  }
}

function requireProgressInput(input) {
  if (!input || typeof input !== "object") {
    throw new GatewayStoreValidationError("Progress input is required.");
  }
  requireIdentifier(input.attemptId, "Attempt id", 160);
  requireIdentifier(input.idempotencyKey, "Idempotency key", 160);
  if (typeof input.message !== "string" || !input.message.trim() || input.message.length > 2_000) {
    throw new GatewayStoreValidationError("Progress message must be between 1 and 2,000 characters.");
  }
  if (!Number.isInteger(input.progressPercent) || input.progressPercent < 0 || input.progressPercent > 100) {
    throw new GatewayStoreValidationError("Progress percent must be an integer between 0 and 100.");
  }
}

function requireArtifactObjectInput(input) {
  if (!input || typeof input !== "object") {
    throw new GatewayStoreValidationError("Artifact object input is required.");
  }
  requireIdentifier(input.attemptId, "Attempt id", 160);
  if (typeof input.filename !== "string" || input.filename.length === 0 || input.filename.length > 128) {
    throw new GatewayStoreValidationError("Artifact filename must be between 1 and 128 characters.");
  }
  if (typeof input.contentType !== "string" || input.contentType.length === 0 || input.contentType.length > 255) {
    throw new GatewayStoreValidationError("Artifact contentType must be between 1 and 255 characters.");
  }
  if (
    typeof input.contentBase64Url !== "string" ||
    input.contentBase64Url.length === 0 ||
    input.contentBase64Url.length > base64UrlCharactersFor(maxInlineArtifactObjectBytes) ||
    !/^[A-Za-z0-9_-]+$/.test(input.contentBase64Url)
  ) {
    throw new GatewayStoreValidationError("Artifact contentBase64Url must be unpadded base64url within the control-plane byte limit.");
  }
}

function requireArtifactBundleInput(bundle) {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) {
    throw new GatewayStoreValidationError("Artifact Bundle input is required.");
  }
  requireIdentifier(bundle.attemptId, "Artifact Bundle attemptId", 160);
}

function requireRunnerRequestInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GatewayStoreValidationError("Runner request input is required.");
  }
  requireIdentifier(input.attemptId, "Attempt id", 160);
  requireIdentifier(input.idempotencyKey, "Runner idempotency key", 160);
  if (typeof input.artifactBundleHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(input.artifactBundleHash)) {
    throw new GatewayStoreValidationError("Artifact Bundle hash must be a sha256:<hex> value.");
  }
}

function requireVerificationReplayRequestInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GatewayStoreValidationError("Verification replay request input is required.");
  }
  requireIdentifier(input.assignmentId, "Verification assignment id", 240);
  requireIdentifier(input.idempotencyKey, "Verification replay idempotency key", 160);
}

function requireVerificationReplayLookupInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GatewayStoreValidationError("Verification replay lookup input is required.");
  }
  requireIdentifier(input.assignmentId, "Verification assignment id", 240);
  requireIdentifier(input.idempotencyKey, "Verification replay idempotency key", 160);
}

function requireRunnerLookupInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new GatewayStoreValidationError("Run lookup input is required.");
  }
  requireIdentifier(input.attemptId, "Attempt id", 160);
  requireIdentifier(input.runId, "Run id", 240);
}

function decodeBase64Url(value) {
  try {
    const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`;
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    if (bytes.byteLength > maxInlineArtifactObjectBytes) {
      throw new GatewayStoreValidationError("Artifact object exceeds the control-plane byte limit.");
    }
    return bytes;
  } catch (error) {
    if (error instanceof GatewayStoreValidationError) throw error;
    throw new GatewayStoreValidationError("Artifact contentBase64Url could not be decoded.");
  }
}

function base64UrlCharactersFor(bytes) {
  const remainder = bytes % 3;
  return Math.floor(bytes / 3) * 4 + (remainder === 0 ? 0 : remainder + 1);
}

function normalizeGatewayBindings(value) {
  if (value && typeof value === "object" && typeof value.database?.prepare === "function") {
    return {
      database: value.database,
      bucket: value.bucket ?? null,
      artifactStore: value.artifactStore ?? null,
      runnerDispatcher: value.runnerDispatcher ?? null,
    };
  }
  return { database: value, bucket: null, artifactStore: null, runnerDispatcher: null };
}

async function verificationReplayIdentity({ assignmentId, requesterAgentId, delegationCertificateId, idempotencyKey }) {
  const hash = await sha256Canonical({
    protocolVersion: "pw-verification-replay-v1",
    assignmentId,
    requesterAgentId,
    delegationCertificateId,
    idempotencyKey,
  });
  const suffix = hash.slice("sha256:".length);
  return Object.freeze({
    id: `verification-replay:${suffix}`,
    runId: `run:verification-replay:${suffix}`,
    runnerIdempotencyKey: `verification-replay:${suffix}`,
  });
}

function toVerificationReplay(row) {
  return Object.freeze({
    id: row.id,
    assignmentId: row.assignment_id,
    runId: row.run_id,
    artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
    requesterPersonId: row.requester_person_id,
    requesterAgentId: row.requester_agent_id,
    delegationCertificateId: row.delegation_certificate_id,
    agentInstallationId: row.agent_installation_id,
    idempotencyKey: row.idempotency_key,
    requestedAt: row.requested_at,
  });
}

function assertSameVerificationReplay(existing, { id, assignment, installation, principal, idempotencyKey, run }) {
  if (
    existing.id !== id ||
    existing.runId !== run.id ||
    existing.artifactBundleManifestHash !== assignment.artifactBundleManifestHash ||
    existing.requesterPersonId !== principal.personId ||
    existing.requesterAgentId !== installation.agentId ||
    existing.delegationCertificateId !== installation.delegationCertificateId ||
    existing.agentInstallationId !== principal.agentInstallationId ||
    existing.idempotencyKey !== idempotencyKey
  ) {
    throw new GatewayStoreConflictError("A verification replay idempotency key cannot be reused for different immutable evidence.");
  }
}

function attemptListLimit(value) {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new GatewayStoreValidationError("Attempt list limit must be an integer from 1 to 100.");
  }
  return value;
}

function reviewAssignmentListLimit(value) {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new GatewayStoreValidationError("Review assignment list limit must be an integer from 1 to 100.");
  }
  return value;
}

function optionalReviewAssignmentStatus(value) {
  if (value === undefined) return null;
  if (value === "assigned" || value === "accepted" || value === "declined" || value === "completed") return value;
  throw new GatewayStoreValidationError("Review assignment status must be assigned, accepted, declined, or completed.");
}

function toReviewAssignmentSummary(row) {
  return Object.freeze({
    id: row.id,
    artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
    claimType: row.claim_type,
    status: row.status,
    assignedAt: row.assigned_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    completedAt: row.completed_at,
    exactAgentReplayCount: Number(row.exact_agent_replay_count ?? 0),
    exactAgentReplayEvidenceCount: Number(row.exact_agent_replay_evidence_count ?? 0),
    attempt: Object.freeze({
      id: row.attempt_id,
      agentLabel: row.agent_label,
    }),
    target: Object.freeze({
      problemSlug: row.problem_slug,
      projectSlug: row.project_slug,
      title: row.problem_title,
      declaration: row.target_key,
    }),
    attestation: row.attestation_id ? Object.freeze({
      id: row.attestation_id,
      decision: row.attestation_decision,
      evidenceHash: row.attestation_evidence_hash,
      attestedAt: row.attestation_attested_at,
    }) : null,
  });
}

function toReviewAssignmentEvent(row) {
  return Object.freeze({
    id: row.id,
    sequence: Number(row.sequence),
    eventType: row.event_type,
    status: row.status,
    payloadHash: row.payload_hash,
    occurredAt: row.occurred_at,
  });
}

function toReviewAgentReplaySummary(row) {
  return Object.freeze({
    id: row.id,
    runId: row.run_id,
    idempotencyKey: row.idempotency_key,
    requestedAt: row.requested_at,
    state: row.state,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    runnerResultHash: row.runner_result_hash,
    evidenceHash: row.evidence_hash,
    evidenceRecordedAt: row.recorded_at,
  });
}

function parseStoredBundleManifest(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || canonicalJson(parsed) !== value) {
      throw new Error("not canonical");
    }
    return Object.freeze(parsed);
  } catch {
    throw new GatewayStoreValidationError("The assigned Artifact Bundle manifest is not readable canonical evidence.");
  }
}

function requireSlug(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 120) {
    throw new GatewayStoreValidationError("Problem slug must be between 1 and 120 characters.");
  }
}

function requireIdentifier(value, label, maxLength = 240) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new GatewayStoreValidationError(`${label} must be between 1 and ${maxLength} characters.`);
  }
}

function toAttemptEvent(row) {
  return Object.freeze({
    id: row.id,
    sequence: row.sequence,
    type: row.event_type,
    message: row.message,
    progressPercent: row.progress_percent,
    occurredAt: row.occurred_at,
  });
}

function toCatalogRecords(rows) {
  const records = new Map();
  for (const row of rows) {
    const existing = records.get(row.problem_id);
    const claim = toCatalogClaim(row);
    if (existing) {
      if (claim) existing.claims.push(claim);
      continue;
    }
    const record = {
      id: row.problem_id,
      slug: row.problem_slug,
      kind: row.project_kind,
      title: row.problem_title,
      projectTitle: row.project_title,
      projectSummary: row.project_summary,
      domain: row.domain,
      researchStatus: row.research_status,
      informalStatement: row.informal_statement,
      leanStatement: row.lean_statement,
      proofState: row.proof_state,
      sourceCorrespondence: row.source_correspondence,
      declaration: row.declaration_name ? {
        qualifiedName: row.declaration_name,
        kind: row.declaration_kind,
        sourcePath: row.declaration_source_path,
        sourceUrl: row.declaration_source_url,
        sourceLineStart: row.declaration_source_line_start,
        sourceLineEnd: row.declaration_source_line_end,
        sourceContentHash: row.declaration_content_hash,
      } : {
        qualifiedName: row.target_key,
        kind: null,
        sourcePath: null,
        sourceUrl: null,
        sourceLineStart: null,
        sourceLineEnd: null,
        sourceContentHash: null,
      },
      source: {
        upstreamName: row.upstream_name,
        sourceUrl: row.source_url,
        revisionTag: row.revision_tag,
        revisionCommit: row.revision_commit,
        retrievedAt: row.retrieved_at,
        contentHash: row.content_hash,
        manifestHash: row.manifest_hash,
        sourceLicense: row.source_license,
        leanToolchain: row.lean_toolchain,
        mathlibRevision: row.mathlib_revision,
      },
      claims: claim ? [claim] : [],
    };
    records.set(row.problem_id, record);
  }
  return [...records.values()].map((record) => Object.freeze({
    ...record,
    claims: Object.freeze(record.claims.map((claim) => Object.freeze(claim))),
  }));
}

function toCatalogClaim(row) {
  if (!row.claim_type) return null;
  return {
    type: row.claim_type,
    status: row.claim_status,
    evidenceUrl: row.evidence_url,
    recordedAt: row.recorded_at,
  };
}
