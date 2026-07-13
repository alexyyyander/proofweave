import { getD1 } from "@/db";
import {
  agentReportedOnly,
  type McpAttempt,
  type McpAttemptEvent,
  type McpAttemptStatus,
} from "@/packages/domain/mcp";
import { closedAlphaAttemptLimits } from "@/packages/domain/attempt-policy.mjs";
import {
  DelegationAuthorizationError,
  DelegationNotFoundError,
  getDelegationRepository,
} from "@/db/repositories/delegation";
import { DelegationValidationError } from "@/packages/domain/delegation.mjs";

export type McpIdentity = Readonly<{
  providerSubject: string;
  displayName: string;
}>;

export type McpPrincipal = Readonly<{
  personId: string;
  tokenId: string;
  displayName: string;
}>;

export type IssuedMcpToken = Readonly<{
  id: string;
  name: string;
  token: string;
  tokenPrefix: string;
  expiresAt: string;
}>;

export type IdempotentResult<T> = Readonly<{ value: T; created: boolean }>;

export class McpIdempotencyConflictError extends Error {
  constructor() {
    super("An idempotency key cannot be reused for a different request.");
    this.name = "McpIdempotencyConflictError";
  }
}

export class McpAttemptNotActiveError extends Error {
  constructor() {
    super("Progress can only be reported while an attempt is active.");
    this.name = "McpAttemptNotActiveError";
  }
}

export class McpDelegationRequiredError extends Error {
  constructor(message = "A valid delegated Agent authority is required for this Attempt.") {
    super(message);
    this.name = "McpDelegationRequiredError";
  }
}

export class McpAttemptQuotaExceededError extends Error {
  readonly limit: number;

  constructor(limit = closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson) {
    super(`This Person already has the closed-alpha limit of ${limit} active Attempts. Existing work must become terminal before another provisional Attempt can open.`);
    this.name = "McpAttemptQuotaExceededError";
    this.limit = limit;
  }
}

type PersonRow = { id: string; display_name: string };
type TokenRow = { token_id: string; person_id: string; display_name: string };
type AttemptRow = {
  id: string;
  person_id: string;
  problem_revision_id: string;
  problem_slug: string;
  problem_title: string;
  agent_id: string | null;
  agent_label: string;
  delegation_certificate_id: string | null;
  delegation_scope: "formalize" | "prove" | null;
  status: McpAttemptStatus;
  last_progress_percent: number | null;
  created_at: string;
  updated_at: string;
};
type EventRow = {
  id: string;
  sequence: number;
  event_type: McpAttemptEvent["type"];
  message: string;
  progress_percent: number | null;
  occurred_at: string;
};
type EventWithIdempotencyRow = EventRow & { idempotency_key: string };

const attemptSelect = `
  SELECT
    attempt.id,
    attempt.person_id,
    attempt.problem_revision_id,
    revision.slug AS problem_slug,
    revision.title AS problem_title,
    attempt.agent_id,
    attempt.agent_label,
    attempt.delegation_certificate_id,
    attempt.delegation_scope,
    attempt.status,
    attempt.last_progress_percent,
    attempt.created_at,
    attempt.updated_at
  FROM agent_attempts AS attempt
  INNER JOIN problem_revisions AS revision ON revision.id = attempt.problem_revision_id
`;

export interface McpRepository {
  issueToken(identity: McpIdentity, input: { name: string; expiresInDays: number }): Promise<IssuedMcpToken>;
  authenticate(token: string): Promise<McpPrincipal | null>;
  createAttempt(
    personId: string,
    input: {
      problemRevisionId: string;
      agentId: string;
      agentLabel: string;
      delegationCertificateId: string;
      delegationScope: "formalize" | "prove";
      idempotencyKey: string;
      openedBy?: "agent" | "owner";
    },
  ): Promise<IdempotentResult<McpAttempt>>;
  appendProgress(
    personId: string,
    input: { attemptId: string; message: string; progressPercent: number; idempotencyKey: string },
  ): Promise<IdempotentResult<McpAttemptEvent> | null>;
  findAttempt(personId: string, attemptId: string): Promise<McpAttempt | null>;
  listAttempts(personId: string): Promise<McpAttempt[]>;
}

class D1McpRepository implements McpRepository {
  async issueToken(
    identity: McpIdentity,
    input: { name: string; expiresInDays: number },
  ): Promise<IssuedMcpToken> {
    const person = await this.upsertPerson(identity);
    const token = newToken();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const tokenHash = await sha256(token);
    const id = newId("mcp-token");

    await getD1()
      .prepare(
        `INSERT INTO mcp_access_tokens (
          id, person_id, name, token_hash, token_prefix, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, person.id, input.name, tokenHash, token.slice(0, 15), expiresAt)
      .run();

    return { id, name: input.name, token, tokenPrefix: token.slice(0, 15), expiresAt };
  }

  async authenticate(token: string): Promise<McpPrincipal | null> {
    const now = new Date().toISOString();
    const tokenHash = await sha256(token);
    const row = await getD1()
      .prepare(
        `SELECT token.id AS token_id, token.person_id, person.display_name
         FROM mcp_access_tokens AS token
         INNER JOIN persons AS person ON person.id = token.person_id
         WHERE token.token_hash = ?
           AND token.revoked_at IS NULL
           AND token.expires_at > ?`,
      )
      .bind(tokenHash, now)
      .first<TokenRow>();

    if (!row) return null;

    await getD1()
      .prepare("UPDATE mcp_access_tokens SET last_used_at = ? WHERE id = ?")
      .bind(now, row.token_id)
      .run();

    return { personId: row.person_id, tokenId: row.token_id, displayName: row.display_name };
  }

  async createAttempt(
    personId: string,
    input: {
      problemRevisionId: string;
      agentId: string;
      agentLabel: string;
      delegationCertificateId: string;
      delegationScope: "formalize" | "prove";
      idempotencyKey: string;
      openedBy?: "agent" | "owner";
    },
  ): Promise<IdempotentResult<McpAttempt>> {
    const now = new Date().toISOString();
    let delegated;
    try {
      delegated = await getDelegationRepository().assertAuthorizedDelegation(
        personId,
        input.delegationCertificateId,
        input.delegationScope,
        now,
      );
    } catch (error) {
      if (isDelegationFailure(error)) {
        throw new McpDelegationRequiredError(error.message);
      }
      throw error;
    }
    if (delegated.agentId !== input.agentId) {
      throw new McpDelegationRequiredError("The delegation certificate does not authorize the requested Agent.");
    }
    const generatedId = newId("attempt");
    const inserted = await getD1()
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
        personId,
        input.problemRevisionId,
        input.agentId,
        input.agentLabel,
        input.delegationCertificateId,
        input.delegationScope,
        input.idempotencyKey,
        now,
        personId,
        closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson,
      )
      .run();

    const row = await getD1()
      .prepare(
        `${attemptSelect}
         WHERE attempt.person_id = ? AND attempt.idempotency_key = ?`,
      )
      .bind(personId, input.idempotencyKey)
      .first<AttemptRow>();

    if (!row) {
      throw new McpAttemptQuotaExceededError();
    }
    if (
      row.problem_revision_id !== input.problemRevisionId ||
      row.agent_id !== input.agentId ||
      row.agent_label !== input.agentLabel ||
      row.delegation_certificate_id !== input.delegationCertificateId ||
      row.delegation_scope !== input.delegationScope
    ) {
      throw new McpIdempotencyConflictError();
    }

    await getD1()
      .prepare(
        `INSERT OR IGNORE INTO agent_attempt_events (
          id, attempt_id, sequence, event_type, message, idempotency_key, occurred_at
        ) VALUES (?, ?, 1, 'attempt_created', ?, ?, ?)`,
      )
      .bind(
        `attempt-created:${row.id}`,
        row.id,
        input.openedBy === "owner"
          ? `Attempt opened by its owner for ${input.agentLabel} under delegated ${input.delegationScope} authority. This allocates a provisional workspace; it is not an Agent work event, Lean verification, or a contribution receipt.`
          : `Attempt opened by ${input.agentLabel} under delegated ${input.delegationScope} authority. This is agent-reported activity, not verification.`,
        `attempt-created:${input.idempotencyKey}`,
        now,
      )
      .run();

    const attempt = await this.findAttempt(personId, row.id);
    if (!attempt) throw new Error("Attempt record became unavailable.");
    return { value: attempt, created: inserted.meta.changes === 1 };
  }

  async appendProgress(
    personId: string,
    input: { attemptId: string; message: string; progressPercent: number; idempotencyKey: string },
  ): Promise<IdempotentResult<McpAttemptEvent> | null> {
    const attempt = await this.findAttempt(personId, input.attemptId);
    if (!attempt) return null;
    if (attempt.status !== "active") {
      throw new McpAttemptNotActiveError();
    }
    if (!attempt.agentId || !attempt.delegationCertificateId || !attempt.delegationScope) {
      throw new McpDelegationRequiredError();
    }
    try {
      await getDelegationRepository().assertAuthorizedDelegation(
        personId,
        attempt.delegationCertificateId,
        attempt.delegationScope,
        new Date().toISOString(),
      );
    } catch (error) {
      if (isDelegationFailure(error)) {
        throw new McpDelegationRequiredError(error.message);
      }
      throw error;
    }

    const existing = await this.findEvent(input.attemptId, input.idempotencyKey);
    if (existing) {
      if (
        existing.message !== input.message ||
        existing.progressPercent !== input.progressPercent
      ) {
        throw new McpIdempotencyConflictError();
      }
      return { value: existing, created: false };
    }

    const now = new Date().toISOString();
    const inserted = await getD1()
      .prepare(
        `INSERT OR IGNORE INTO agent_attempt_events (
          id, attempt_id, sequence, event_type, message, progress_percent,
          idempotency_key, occurred_at
        )
        SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, 'agent_reported', ?, ?, ?, ?
        FROM agent_attempt_events
        WHERE attempt_id = ?`,
      )
      .bind(
        newId("attempt-event"),
        input.attemptId,
        input.message,
        input.progressPercent,
        input.idempotencyKey,
        now,
        input.attemptId,
      )
      .run();

    const event = await this.findEvent(input.attemptId, input.idempotencyKey);
    if (!event) throw new Error("Progress event insert did not produce a readable record.");

    if (inserted.meta.changes === 1) {
      await getD1()
        .prepare(
          `UPDATE agent_attempts
           SET last_progress_percent = ?, updated_at = ?
           WHERE id = ? AND person_id = ?`,
        )
        .bind(input.progressPercent, now, input.attemptId, personId)
        .run();
    }

    return { value: event, created: inserted.meta.changes === 1 };
  }

  async findAttempt(personId: string, attemptId: string): Promise<McpAttempt | null> {
    const row = await getD1()
      .prepare(`${attemptSelect} WHERE attempt.id = ? AND attempt.person_id = ?`)
      .bind(attemptId, personId)
      .first<AttemptRow>();
    if (!row) return null;

    const events = await getD1()
      .prepare(
        `SELECT id, sequence, event_type, message, progress_percent, occurred_at
         FROM agent_attempt_events
         WHERE attempt_id = ?
         ORDER BY sequence ASC`,
      )
      .bind(attemptId)
      .all<EventRow>();

    return {
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
      events: (events.results ?? []).map(toEvent),
      verificationState: agentReportedOnly,
    };
  }

  async listAttempts(personId: string): Promise<McpAttempt[]> {
    const rows = await getD1()
      .prepare(
        `${attemptSelect}
         WHERE attempt.person_id = ?
         ORDER BY attempt.updated_at DESC, attempt.created_at DESC`,
      )
      .bind(personId)
      .all<AttemptRow>();
    const attempts = await Promise.all((rows.results ?? []).map((row: AttemptRow) => this.findAttempt(personId, row.id)));
    return attempts.filter((attempt: McpAttempt | null): attempt is McpAttempt => attempt !== null);
  }

  private async upsertPerson(identity: McpIdentity): Promise<PersonRow> {
    const now = new Date().toISOString();
    const subject = identity.providerSubject.trim().toLowerCase();
    await getD1()
      .prepare(
        `INSERT INTO persons (
          id, identity_provider, provider_subject, display_name, updated_at
        ) VALUES (?, 'chatgpt', ?, ?, ?)
        ON CONFLICT(identity_provider, provider_subject)
        DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
      )
      .bind(newId("person"), subject, identity.displayName, now)
      .run();

    const person = await getD1()
      .prepare(
        `SELECT id, display_name FROM persons
         WHERE identity_provider = 'chatgpt' AND provider_subject = ?`,
      )
      .bind(subject)
      .first<PersonRow>();
    if (!person) throw new Error("Authenticated Person record became unavailable.");
    return person;
  }

  private async findEvent(attemptId: string, idempotencyKey: string) {
    const row = await getD1()
      .prepare(
        `SELECT id, sequence, event_type, message, progress_percent, occurred_at, idempotency_key
         FROM agent_attempt_events
         WHERE attempt_id = ? AND idempotency_key = ?`,
      )
      .bind(attemptId, idempotencyKey)
      .first<EventWithIdempotencyRow>();
    return row ? toEvent(row) : null;
  }
}

export function getMcpRepository(): McpRepository {
  return new D1McpRepository();
}

function toEvent(row: EventRow): McpAttemptEvent {
  return {
    id: row.id,
    sequence: row.sequence,
    type: row.event_type,
    message: row.message,
    progressPercent: row.progress_percent,
    occurredAt: row.occurred_at,
  };
}

function newId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function isDelegationFailure(error: unknown): error is Error {
  return (
    error instanceof DelegationAuthorizationError ||
    error instanceof DelegationNotFoundError ||
    error instanceof DelegationValidationError
  );
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `pw_mcp_${[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
