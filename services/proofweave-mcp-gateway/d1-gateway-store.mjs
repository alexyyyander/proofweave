import { normalizeVerificationAttestation } from "../../packages/protocol/verification-attestation.mjs";
import {
  D1VerificationStore,
  VerificationStoreConflictError,
  VerificationStoreNotFoundError,
  VerificationStoreValidationError,
} from "../verification/d1-verification-store.mjs";

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

/**
 * Remote-MCP write boundary for an already OAuth-authenticated Agent
 * installation. The MCP transport deliberately passes no raw access token to
 * this store. Before D1VerificationStore handles cryptographic validation, we
 * bind every identity field in the submitted Attestation to the selected OAuth
 * installation and hide assignments addressed to other Persons.
 */
export class D1RemoteMcpGatewayStore {
  constructor(database) {
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1RemoteMcpGatewayStore requires a D1 database binding.");
    }
    this.database = database;
    this.verificationStore = new D1VerificationStore(database);
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      )
      .run();
    const row = await this.database
      .prepare(`${attemptSelect} WHERE attempt.person_id = ? AND attempt.idempotency_key = ?`)
      .bind(principal.personId, input.idempotencyKey)
      .first();
    if (!row) throw new Error("Attempt insert did not produce a readable record.");
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

function attemptListLimit(value) {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new GatewayStoreValidationError("Attempt list limit must be an integer from 1 to 100.");
  }
  return value;
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
