import { getD1 } from "@/db";
import {
  getContributionReceiptReader,
  type ContributionReceiptKind,
  type PublicContributionReceiptIndexItem,
} from "@/db/repositories/receipts";
import type { ResearchNodeKind } from "@/db/repositories/research-graph";
import {
  emptyReceiptCreditSummary,
  getReceiptCreditRepository,
  ReceiptCreditSchemaUnavailableError,
  type PublicReceiptCreditSummary,
} from "@/db/repositories/receipt-credits";

export type PublicPersonCheckpoint = Readonly<{
  id: string;
  kind: ResearchNodeKind;
  summary: string;
  occurredAt: string;
  agentLabel: string;
  target: Readonly<{ slug: string; title: string }>;
}>;

export type PublicPersonProfile = Readonly<{
  person: Readonly<{
    id: string;
    displayName: string;
    joinedAt: string;
  }>;
  summary: Readonly<{
    sharedCheckpoints: number;
    verifiedReceipts: number;
    independentReviews: number;
    positiveAttestations: number;
    challengeFindings: number;
  }>;
  receiptKinds: readonly Readonly<{ kind: ContributionReceiptKind; count: number }>[];
  credits: PublicReceiptCreditSummary;
  receipts: readonly PublicContributionReceiptIndexItem[];
  recentCheckpoints: readonly PublicPersonCheckpoint[];
  publicAgentLabels: readonly string[];
}>;

type PersonRow = { id: string; display_name: string; created_at: string };
type CountRow = { count: number };
type ReviewCountRow = {
  completed_reviews: number;
  positive_attestations: number;
  challenge_findings: number;
};
type CheckpointRow = {
  id: string;
  kind: ResearchNodeKind;
  summary: string;
  agent_event_occurred_at: string;
  agent_label: string;
  problem_slug: string;
  problem_title: string;
};
type AgentLabelRow = { label: string };

export interface PersonProfileRepository {
  findPublicByPersonId(personId: string): Promise<PublicPersonProfile | null>;
}

class D1PersonProfileRepository implements PersonProfileRepository {
  async findPublicByPersonId(personId: string): Promise<PublicPersonProfile | null> {
    if (!isPersonId(personId)) return null;
    const database = getD1();
    const person = await database
      .prepare("SELECT id, display_name, created_at FROM persons WHERE id = ?")
      .bind(personId)
      .first<PersonRow>();
    if (!person) return null;

    const [checkpointCount, reviewCount, checkpointRows, agentRows, receipts, credits] = await Promise.all([
      database.prepare("SELECT COUNT(*) AS count FROM research_nodes WHERE beneficiary_person_id = ?")
        .bind(personId).first<CountRow>(),
      database.prepare(
        `SELECT
           COUNT(*) AS completed_reviews,
           COALESCE(SUM(CASE WHEN attestation.decision = 'attested' THEN 1 ELSE 0 END), 0) AS positive_attestations,
           COALESCE(SUM(CASE WHEN attestation.decision IN ('rejected','request_changes','integrity_flagged') THEN 1 ELSE 0 END), 0) AS challenge_findings
         FROM verification_assignments AS assignment
         INNER JOIN verification_attestations AS attestation ON attestation.assignment_id = assignment.id
         WHERE assignment.verifier_person_id = ? AND assignment.status = 'completed'`,
      ).bind(personId).first<ReviewCountRow>(),
      database.prepare(
        `SELECT node.id, node.kind, node.summary, node.agent_event_occurred_at,
                agent.label AS agent_label, revision.slug AS problem_slug,
                revision.title AS problem_title
         FROM research_nodes AS node
         INNER JOIN agents AS agent ON agent.id = node.beneficiary_agent_id
         INNER JOIN problem_revisions AS revision ON revision.id = node.problem_revision_id
         WHERE node.beneficiary_person_id = ?
         ORDER BY node.agent_event_occurred_at DESC, node.id ASC
         LIMIT 8`,
      ).bind(personId).all<CheckpointRow>(),
      database.prepare(
        `SELECT DISTINCT agent.label
         FROM agents AS agent
         WHERE agent.id IN (
           SELECT node.beneficiary_agent_id FROM research_nodes AS node WHERE node.beneficiary_person_id = ?
           UNION
           SELECT receipt.beneficiary_agent_id FROM contribution_receipts AS receipt WHERE receipt.beneficiary_person_id = ?
         )
         ORDER BY agent.label ASC`,
      ).bind(personId, personId).all<AgentLabelRow>(),
      getContributionReceiptReader().listByPerson(personId, 100),
      getReceiptCreditRepository().summaryForPerson(personId).catch((error) => {
        if (error instanceof ReceiptCreditSchemaUnavailableError) return emptyReceiptCreditSummary();
        throw error;
      }),
    ]);

    return Object.freeze({
      person: Object.freeze({ id: person.id, displayName: person.display_name, joinedAt: person.created_at }),
      summary: Object.freeze({
        sharedCheckpoints: Number(checkpointCount?.count ?? 0),
        verifiedReceipts: receipts.length,
        independentReviews: Number(reviewCount?.completed_reviews ?? 0),
        positiveAttestations: Number(reviewCount?.positive_attestations ?? 0),
        challengeFindings: Number(reviewCount?.challenge_findings ?? 0),
      }),
      receiptKinds: countReceiptKinds(receipts),
      credits,
      receipts,
      recentCheckpoints: Object.freeze((checkpointRows.results ?? []).map(toCheckpoint)),
      publicAgentLabels: Object.freeze((agentRows.results ?? []).map((row: AgentLabelRow) => row.label)),
    });
  }
}

export function getPersonProfileRepository(): PersonProfileRepository {
  return new D1PersonProfileRepository();
}

function countReceiptKinds(receipts: readonly PublicContributionReceiptIndexItem[]) {
  const counts = new Map<ContributionReceiptKind, number>();
  for (const receipt of receipts) counts.set(receipt.kind, (counts.get(receipt.kind) ?? 0) + 1);
  return Object.freeze([...counts.entries()]
    .map(([kind, count]) => Object.freeze({ kind, count }))
    .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind)));
}

function toCheckpoint(row: CheckpointRow): PublicPersonCheckpoint {
  return Object.freeze({
    id: row.id,
    kind: row.kind,
    summary: row.summary,
    occurredAt: row.agent_event_occurred_at,
    agentLabel: row.agent_label,
    target: Object.freeze({ slug: row.problem_slug, title: row.problem_title }),
  });
}

function isPersonId(value: string) {
  return /^person:[A-Za-z0-9][A-Za-z0-9:._-]{1,232}$/.test(value);
}
