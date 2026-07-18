import { getD1 } from "@/db";
import { canonicalJson, sha256Canonical } from "@/packages/protocol/canonical-json.mjs";

export type ProblemProposalStatus = "submitted" | "under_review" | "accepted" | "rejected" | "withdrawn";

export type ProblemProposal = Readonly<{
  id: string;
  proposerPersonId: string;
  title: string;
  domain: string;
  informalStatement: string;
  motivation: string;
  sourceUrl: string | null;
  status: ProblemProposalStatus;
  submittedAt: string;
}>;

export type ProblemProposalInput = Readonly<{
  title: string;
  domain: string;
  informalStatement: string;
  motivation: string;
  sourceUrl: string | null;
  idempotencyKey: string;
}>;

export class ProblemProposalIdempotencyConflictError extends Error {
  constructor() {
    super("This submission key was already used for different proposal content.");
    this.name = "ProblemProposalIdempotencyConflictError";
  }
}

export class ProblemProposalIntegrityError extends Error {
  constructor() {
    super("A stored problem proposal failed its canonical integrity check.");
    this.name = "ProblemProposalIntegrityError";
  }
}

export class ProblemProposalSchemaUnavailableError extends Error {
  constructor() {
    super("The problem proposal ledger is awaiting its control-plane migration.");
    this.name = "ProblemProposalSchemaUnavailableError";
  }
}

type ProposalRow = {
  id: string;
  proposer_person_id: string;
  title: string;
  domain: string;
  informal_statement: string;
  motivation: string;
  source_url: string | null;
  idempotency_key: string;
  request_hash: string;
  payload_hash: string;
  canonical_payload: string;
  submitted_at: string;
  event_id: string;
  event_sequence: number;
  event_type: ProblemProposalStatus;
  event_actor_person_id: string;
  event_note: string | null;
  event_payload_hash: string;
  event_canonical_payload: string;
  event_occurred_at: string;
};

class D1ProblemProposalRepository {
  async listForPerson(personId: string): Promise<readonly ProblemProposal[]> {
    try {
      const rows = (await getD1().prepare(
        `${proposalSelect}
         WHERE proposal.proposer_person_id = ?
         ORDER BY proposal.submitted_at DESC, proposal.id DESC
         LIMIT 100`,
      ).bind(personId).all<ProposalRow>()).results;
      return Object.freeze(await Promise.all(rows.map(verifyRow)));
    } catch (error) {
      if (missingSchema(error)) throw new ProblemProposalSchemaUnavailableError();
      throw error;
    }
  }

  async create(personId: string, input: ProblemProposalInput): Promise<Readonly<{ proposal: ProblemProposal; created: boolean }>> {
    try {
      const normalized = normalizeInput(input);
      const requestHash = await sha256Canonical({
        title: normalized.title,
        domain: normalized.domain,
        informalStatement: normalized.informalStatement,
        motivation: normalized.motivation,
        sourceUrl: normalized.sourceUrl,
      });
      const existing = await findByIdempotency(personId, normalized.idempotencyKey);
      if (existing) return replay(existing, requestHash);

      const identityHash = await sha256Canonical({ personId, idempotencyKey: normalized.idempotencyKey });
      const id = `proposal:${identityHash.slice("sha256:".length)}`;
      const submittedAt = new Date().toISOString();
      const proposalPayload = Object.freeze({
        protocolVersion: "pw-problem-proposal-v1",
        id,
        proposerPersonId: personId,
        title: normalized.title,
        domain: normalized.domain,
        informalStatement: normalized.informalStatement,
        motivation: normalized.motivation,
        sourceUrl: normalized.sourceUrl,
        submittedAt,
      });
      const proposalHash = await sha256Canonical(proposalPayload);
      const eventPayload = Object.freeze({
        protocolVersion: "pw-problem-proposal-event-v1",
        id: `proposal-event:${identityHash.slice("sha256:".length)}:1`,
        proposalId: id,
        sequence: 1,
        eventType: "submitted" as const,
        actorPersonId: personId,
        note: null,
        occurredAt: submittedAt,
      });
      const eventHash = await sha256Canonical(eventPayload);

      try {
        await getD1().batch([
          getD1().prepare(
            `INSERT INTO problem_proposals (
               id, proposer_person_id, title, domain, informal_statement, motivation,
               source_url, idempotency_key, request_hash, payload_hash, canonical_payload, submitted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            id, personId, normalized.title, normalized.domain, normalized.informalStatement,
            normalized.motivation, normalized.sourceUrl, normalized.idempotencyKey, requestHash,
            proposalHash, canonicalJson(proposalPayload), submittedAt,
          ),
          getD1().prepare(
            `INSERT INTO problem_proposal_events (
               id, proposal_id, sequence, event_type, actor_person_id, note,
               payload_hash, canonical_payload, occurred_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            eventPayload.id, id, 1, eventPayload.eventType, personId, null,
            eventHash, canonicalJson(eventPayload), submittedAt,
          ),
        ]);
      } catch (error) {
        const raced = await findByIdempotency(personId, normalized.idempotencyKey);
        if (raced) return replay(raced, requestHash);
        throw error;
      }

      const stored = await findByIdempotency(personId, normalized.idempotencyKey);
      if (!stored) throw new Error("The proposal write completed without a readable append-only record.");
      return Object.freeze({ proposal: await verifyRow(stored), created: true });
    } catch (error) {
      if (missingSchema(error)) throw new ProblemProposalSchemaUnavailableError();
      throw error;
    }
  }
}

const proposalSelect = `SELECT
  proposal.id, proposal.proposer_person_id, proposal.title, proposal.domain,
  proposal.informal_statement, proposal.motivation, proposal.source_url,
  proposal.idempotency_key, proposal.request_hash, proposal.payload_hash,
  proposal.canonical_payload, proposal.submitted_at,
  event.id AS event_id, event.sequence AS event_sequence, event.event_type,
  event.actor_person_id AS event_actor_person_id, event.note AS event_note,
  event.payload_hash AS event_payload_hash,
  event.canonical_payload AS event_canonical_payload,
  event.occurred_at AS event_occurred_at
FROM problem_proposals proposal
JOIN problem_proposal_events event ON event.proposal_id = proposal.id
 AND event.sequence = (
   SELECT MAX(latest.sequence) FROM problem_proposal_events latest
   WHERE latest.proposal_id = proposal.id
 )`;

async function findByIdempotency(personId: string, idempotencyKey: string): Promise<ProposalRow | null> {
  return getD1().prepare(
    `${proposalSelect}
     WHERE proposal.proposer_person_id = ? AND proposal.idempotency_key = ?`,
  ).bind(personId, idempotencyKey).first<ProposalRow>();
}

async function replay(row: ProposalRow, requestHash: string) {
  if (row.request_hash !== requestHash) throw new ProblemProposalIdempotencyConflictError();
  return Object.freeze({ proposal: await verifyRow(row), created: false });
}

async function verifyRow(row: ProposalRow): Promise<ProblemProposal> {
  const proposalPayload = {
    protocolVersion: "pw-problem-proposal-v1",
    id: row.id,
    proposerPersonId: row.proposer_person_id,
    title: row.title,
    domain: row.domain,
    informalStatement: row.informal_statement,
    motivation: row.motivation,
    sourceUrl: row.source_url,
    submittedAt: row.submitted_at,
  };
  const eventPayload = {
    protocolVersion: "pw-problem-proposal-event-v1",
    id: row.event_id,
    proposalId: row.id,
    sequence: row.event_sequence,
    eventType: row.event_type,
    actorPersonId: row.event_actor_person_id,
    note: row.event_note,
    occurredAt: row.event_occurred_at,
  };
  if (
    canonicalJson(proposalPayload) !== row.canonical_payload
    || await sha256Canonical(proposalPayload) !== row.payload_hash
    || canonicalJson(eventPayload) !== row.event_canonical_payload
    || await sha256Canonical(eventPayload) !== row.event_payload_hash
  ) throw new ProblemProposalIntegrityError();
  return Object.freeze({
    id: row.id,
    proposerPersonId: row.proposer_person_id,
    title: row.title,
    domain: row.domain,
    informalStatement: row.informal_statement,
    motivation: row.motivation,
    sourceUrl: row.source_url,
    status: row.event_type,
    submittedAt: row.submitted_at,
  });
}

function normalizeInput(input: ProblemProposalInput): ProblemProposalInput {
  const title = bounded(input.title, 5, 240, "title");
  const domain = bounded(input.domain, 2, 120, "domain");
  const informalStatement = bounded(input.informalStatement, 20, 8_000, "informal statement");
  const motivation = bounded(input.motivation, 10, 4_000, "motivation");
  const idempotencyKey = bounded(input.idempotencyKey, 8, 160, "submission key");
  let sourceUrl: string | null = null;
  if (input.sourceUrl) {
    if (input.sourceUrl.length > 1_000) throw new TypeError("source URL is too long.");
    const parsed = new URL(input.sourceUrl);
    if (parsed.protocol !== "https:") throw new TypeError("source URL must use HTTPS.");
    sourceUrl = parsed.toString();
  }
  return Object.freeze({ title, domain, informalStatement, motivation, sourceUrl, idempotencyKey });
}

function bounded(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new TypeError(`${label} must contain ${minimum}–${maximum} characters.`);
  }
  return normalized;
}

function missingSchema(error: unknown) {
  return error instanceof Error && /no such table:\s*problem_proposals/i.test(error.message);
}

const repository = new D1ProblemProposalRepository();

export function getProblemProposalRepository() {
  return repository;
}
