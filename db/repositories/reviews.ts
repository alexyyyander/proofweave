import { getD1 } from "@/db";
import {
  D1VerificationStore,
  VerificationStoreCapacityError,
  VerificationStoreConflictError,
  VerificationStoreNotFoundError,
  VerificationStoreValidationError,
} from "@/services/verification/d1-verification-store.mjs";

export type ReviewAssignmentStatus = "assigned" | "accepted" | "declined" | "completed";
export type ReviewAttestationDecision =
  | "attested"
  | "rejected"
  | "request_changes"
  | "conflict_declared"
  | "integrity_flagged";

export type ReviewAssignmentAttestation = Readonly<{
  id: string;
  decision: ReviewAttestationDecision;
  evidenceHash: string;
  attestedAt: string;
}>;

export type ReviewAssignmentSummary = Readonly<{
  id: string;
  artifactBundleManifestHash: string;
  claimType: string;
  status: ReviewAssignmentStatus;
  assignedAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  completedAt: string | null;
  freshReplayCount: number;
  freshReplayEvidenceCount: number;
  attestation: ReviewAssignmentAttestation | null;
  attempt: Readonly<{
    id: string;
    agentId: string | null;
    agentLabel: string | null;
  }>;
  target: Readonly<{
    problemSlug: string;
    projectSlug: string;
    title: string;
    declaration: string;
  }>;
}>;

export type ReviewAssignmentEvent = Readonly<{
  id: string;
  sequence: number;
  eventType: "assignment_created" | "assignment_accepted" | "assignment_declined" | "attestation_recorded";
  status: ReviewAssignmentStatus;
  payloadHash: string;
  occurredAt: string;
}>;

export type ReviewAssignmentDetail = Readonly<{
  assignment: ReviewAssignmentSummary;
  events: readonly ReviewAssignmentEvent[];
}>;

export class ReviewAssignmentNotFoundError extends Error {
  constructor() {
    super("Review assignment not found.");
    this.name = "ReviewAssignmentNotFoundError";
  }
}

export class ReviewAssignmentConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewAssignmentConflictError";
  }
}

type AssignmentRow = {
  id: string;
  artifact_bundle_manifest_hash: string;
  claim_type: string;
  status: ReviewAssignmentStatus;
  assigned_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  completed_at: string | null;
  attempt_id: string;
  agent_id: string | null;
  agent_label: string | null;
  problem_slug: string;
  project_slug: string;
  problem_title: string;
  target_key: string;
  attestation_id: string | null;
  attestation_decision: ReviewAttestationDecision | null;
  attestation_evidence_hash: string | null;
  attestation_attested_at: string | null;
  fresh_replay_count: number;
  fresh_replay_evidence_count: number;
};

type EventRow = {
  id: string;
  sequence: number;
  event_type: ReviewAssignmentEvent["eventType"];
  status: ReviewAssignmentStatus;
  payload_hash: string;
  occurred_at: string;
};

export interface ReviewAssignmentRepository {
  listForPerson(personId: string): Promise<readonly ReviewAssignmentSummary[]>;
  getForPerson(personId: string, assignmentId: string): Promise<ReviewAssignmentDetail | null>;
  acceptForPerson(personId: string, assignmentId: string, acceptedAt: string): Promise<ReviewAssignmentDetail>;
  declineForPerson(personId: string, assignmentId: string, declinedAt: string): Promise<ReviewAssignmentDetail>;
}

class D1ReviewAssignmentRepository implements ReviewAssignmentRepository {
  async listForPerson(personId: string): Promise<readonly ReviewAssignmentSummary[]> {
    requireIdentifier(personId, "reviewer Person id");
    const rows = await getD1()
      .prepare(`${assignmentSelect}
        WHERE assignment.verifier_person_id = ?
        ORDER BY CASE assignment.status
          WHEN 'assigned' THEN 0
          WHEN 'accepted' THEN 1
          WHEN 'completed' THEN 2
          ELSE 3
        END, assignment.updated_at DESC`)
      .bind(personId)
      .all<AssignmentRow>();
    return Object.freeze((rows.results ?? []).map(toAssignment));
  }

  async getForPerson(personId: string, assignmentId: string): Promise<ReviewAssignmentDetail | null> {
    requireIdentifier(personId, "reviewer Person id");
    requireIdentifier(assignmentId, "review assignment id");
    const row = await getD1()
      .prepare(`${assignmentSelect}
        WHERE assignment.id = ? AND assignment.verifier_person_id = ?`)
      .bind(assignmentId, personId)
      .first<AssignmentRow>();
    if (!row) return null;
    return Object.freeze({
      assignment: toAssignment(row),
      events: await this.eventsForAssignment(assignmentId),
    });
  }

  async acceptForPerson(personId: string, assignmentId: string, acceptedAt: string): Promise<ReviewAssignmentDetail> {
    const current = await this.getForPerson(personId, assignmentId);
    if (!current) throw new ReviewAssignmentNotFoundError();
    if (current.assignment.status === "accepted") return current;
    if (current.assignment.status !== "assigned") {
      throw new ReviewAssignmentConflictError(`Review assignment cannot be accepted from ${current.assignment.status}.`);
    }
    await new D1VerificationStore(getD1()).accept(assignmentId, personId, acceptedAt);
    const next = await this.getForPerson(personId, assignmentId);
    if (!next) throw new Error("Accepted review assignment could not be read.");
    return next;
  }

  async declineForPerson(personId: string, assignmentId: string, declinedAt: string): Promise<ReviewAssignmentDetail> {
    const current = await this.getForPerson(personId, assignmentId);
    if (!current) throw new ReviewAssignmentNotFoundError();
    if (current.assignment.status === "declined") return current;
    if (current.assignment.status !== "assigned") {
      throw new ReviewAssignmentConflictError(`Review assignment cannot be declined from ${current.assignment.status}.`);
    }
    await new D1VerificationStore(getD1()).decline(assignmentId, personId, declinedAt);
    const next = await this.getForPerson(personId, assignmentId);
    if (!next) throw new Error("Declined review assignment could not be read.");
    return next;
  }

  private async eventsForAssignment(assignmentId: string): Promise<readonly ReviewAssignmentEvent[]> {
    const rows = await getD1()
      .prepare(
        `SELECT id, sequence, event_type, status, payload_hash, occurred_at
         FROM verification_assignment_events
         WHERE assignment_id = ?
         ORDER BY sequence ASC`,
      )
      .bind(assignmentId)
      .all<EventRow>();
    return Object.freeze((rows.results ?? []).map((row: EventRow) => Object.freeze({
      id: row.id,
      sequence: Number(row.sequence),
      eventType: row.event_type,
      status: row.status,
      payloadHash: row.payload_hash,
      occurredAt: row.occurred_at,
    })));
  }
}

const assignmentSelect = `SELECT
  assignment.id, assignment.artifact_bundle_manifest_hash, assignment.claim_type,
  assignment.status, assignment.assigned_at, assignment.accepted_at,
  assignment.declined_at, assignment.completed_at, bundle.attempt_id,
  attempt.agent_id, attempt.agent_label, revision.slug AS problem_slug,
  project.slug AS project_slug, revision.title AS problem_title,
  revision.target_key, attestation.id AS attestation_id,
  attestation.decision AS attestation_decision,
  attestation.evidence_hash AS attestation_evidence_hash,
  attestation.attested_at AS attestation_attested_at,
  (SELECT COUNT(*) FROM verification_replays AS replay
   WHERE replay.assignment_id = assignment.id) AS fresh_replay_count,
  (SELECT COUNT(*)
   FROM verification_replay_evidence AS replay_evidence
   INNER JOIN verification_replays AS replay ON replay.id = replay_evidence.replay_id
   INNER JOIN run_results AS result ON result.run_id = replay_evidence.run_id
   INNER JOIN runs AS run ON run.id = replay_evidence.run_id
   WHERE replay.assignment_id = assignment.id
     AND result.result_hash = replay_evidence.runner_result_hash
     AND run.runner_result_hash = replay_evidence.runner_result_hash) AS fresh_replay_evidence_count
 FROM verification_assignments AS assignment
 INNER JOIN artifact_bundles AS bundle
   ON bundle.manifest_hash = assignment.artifact_bundle_manifest_hash
 INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
 INNER JOIN problem_revisions AS revision ON revision.id = bundle.problem_revision_id
 INNER JOIN projects AS project ON project.id = revision.project_id
 LEFT JOIN verification_attestations AS attestation ON attestation.assignment_id = assignment.id`;

export function getReviewAssignmentRepository(): ReviewAssignmentRepository {
  return new D1ReviewAssignmentRepository();
}

export function isReviewAssignmentFailure(error: unknown): boolean {
  return error instanceof ReviewAssignmentNotFoundError ||
    error instanceof ReviewAssignmentConflictError ||
    error instanceof VerificationStoreCapacityError ||
    error instanceof VerificationStoreConflictError ||
    error instanceof VerificationStoreNotFoundError ||
    error instanceof VerificationStoreValidationError;
}

function toAssignment(row: AssignmentRow): ReviewAssignmentSummary {
  return Object.freeze({
    id: row.id,
    artifactBundleManifestHash: row.artifact_bundle_manifest_hash,
    claimType: row.claim_type,
    status: row.status,
    assignedAt: row.assigned_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    completedAt: row.completed_at,
    freshReplayCount: Number(row.fresh_replay_count),
    freshReplayEvidenceCount: Number(row.fresh_replay_evidence_count),
    attestation: toAttestation(row),
    attempt: Object.freeze({
      id: row.attempt_id,
      agentId: row.agent_id,
      agentLabel: row.agent_label,
    }),
    target: Object.freeze({
      problemSlug: row.problem_slug,
      projectSlug: row.project_slug,
      title: row.problem_title,
      declaration: row.target_key,
    }),
  });
}

function toAttestation(row: AssignmentRow): ReviewAssignmentAttestation | null {
  if (
    row.attestation_id === null || row.attestation_decision === null ||
    row.attestation_evidence_hash === null || row.attestation_attested_at === null
  ) return null;
  return Object.freeze({
    id: row.attestation_id,
    decision: row.attestation_decision,
    evidenceHash: row.attestation_evidence_hash,
    attestedAt: row.attestation_attested_at,
  });
}

function requireIdentifier(value: string, label: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /[\0\r\n]/.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier.`);
  }
}
