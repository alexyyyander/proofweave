import { getD1 } from "@/db";
import type { PublicResearchGraph } from "@/db/repositories/research-graph";
import { canonicalJson, sha256Canonical } from "@/packages/protocol/canonical-json.mjs";
import {
  allocateCreditPool,
  creditEligibilityStages,
  creditMarketBoundaries,
  creditMarketBuckets,
  creditMarketPolicyVersion,
  creditMarketUnit,
  projectCreditPoolState,
} from "@/packages/protocol/credit-market.mjs";

export type CreditPoolState = "draft" | "active" | "locked" | "settled" | "cancelled";

export type PublicCreditMarket = Readonly<{
  policy: Readonly<{
    version: string;
    unit: string;
    buckets: readonly Readonly<{
      key: string;
      label: string;
      basisPoints: number;
      percentage: number;
      credits: number | null;
      description: string;
    }>[];
    eligibilityStages: typeof creditEligibilityStages;
    boundaries: typeof creditMarketBoundaries;
  }>;
  pool: Readonly<{
    id: string;
    state: CreditPoolState;
    totalCredits: number;
    sponsorLabel: string;
    createdAt: string;
    lastEventAt: string;
  }> | null;
  activity: Readonly<{
    sharedCheckpoints: number;
    bundleBackedCheckpoints: number;
    kernelAcceptedCheckpoints: number;
    independentlyReviewedCheckpoints: number;
    settlementEligibleCheckpoints: number;
    openReviewAssignments: number;
    completedReviewAssignments: number;
  }>;
}>;

type PoolRow = {
  pool_id: string;
  policy_version: string;
  unit: string;
  total_credits: number;
  sponsor_label: string;
  pool_created_at: string;
  event_sequence: number | null;
  event_type: string | null;
  payload_hash: string | null;
  canonical_payload: string | null;
  occurred_at: string | null;
};

type ReviewCountRow = {
  open_reviews: number;
  completed_reviews: number;
};

export class CreditMarketSchemaUnavailableError extends Error {
  constructor() {
    super("The credit market schema is not active in this control plane.");
    this.name = "CreditMarketSchemaUnavailableError";
  }
}

export class CreditMarketIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditMarketIntegrityError";
  }
}

export interface CreditMarketRepository {
  findByProblemRevisionId(
    problemRevisionId: string,
    graph: PublicResearchGraph,
  ): Promise<PublicCreditMarket>;
}

class D1CreditMarketRepository implements CreditMarketRepository {
  async findByProblemRevisionId(problemRevisionId: string, graph: PublicResearchGraph) {
    try {
      const [poolRows, reviewCounts] = await Promise.all([
        getD1().prepare(
          `SELECT pool.id AS pool_id, pool.policy_version, pool.unit,
                  pool.total_credits, pool.sponsor_label,
                  pool.created_at AS pool_created_at,
                  event.sequence AS event_sequence, event.event_type,
                  event.payload_hash, event.canonical_payload, event.occurred_at
           FROM problem_credit_pools AS pool
           LEFT JOIN problem_credit_pool_events AS event ON event.pool_id = pool.id
           WHERE pool.problem_revision_id = ?
           ORDER BY event.sequence ASC`,
        ).bind(problemRevisionId).all<PoolRow>(),
        getD1().prepare(
          `SELECT
             COALESCE(SUM(CASE WHEN assignment.status IN ('assigned','accepted') THEN 1 ELSE 0 END), 0) AS open_reviews,
             COALESCE(SUM(CASE WHEN assignment.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_reviews
           FROM verification_assignments AS assignment
           INNER JOIN artifact_bundles AS bundle
             ON bundle.manifest_hash = assignment.artifact_bundle_manifest_hash
           WHERE bundle.problem_revision_id = ?`,
        ).bind(problemRevisionId).first<ReviewCountRow>(),
      ]);
      return publicProjection(graph, poolRows.results ?? [], reviewCounts);
    } catch (error) {
      if (isMissingCreditMarketTable(error)) throw new CreditMarketSchemaUnavailableError();
      throw error;
    }
  }
}

const repository = new D1CreditMarketRepository();

export function getCreditMarketRepository(): CreditMarketRepository {
  return repository;
}

async function publicProjection(
  graph: PublicResearchGraph,
  poolRows: readonly PoolRow[],
  reviewCounts: ReviewCountRow | null,
): Promise<PublicCreditMarket> {
  const pool = await projectPool(poolRows);
  const allocation = pool ? allocateCreditPool(pool.totalCredits) : creditMarketBuckets;
  const evidenceAtLeast = (stages: readonly string[]) => graph.nodes.filter((node) => stages.includes(node.evidence.stage)).length;
  return Object.freeze({
    policy: Object.freeze({
      version: creditMarketPolicyVersion,
      unit: creditMarketUnit,
      buckets: Object.freeze(allocation.map((bucket: {
        key: string;
        label: string;
        basisPoints: number;
        description: string;
        credits?: number;
      }) => Object.freeze({
        key: bucket.key,
        label: bucket.label,
        basisPoints: bucket.basisPoints,
        percentage: bucket.basisPoints / 100,
        credits: bucket.credits ?? null,
        description: bucket.description,
      }))),
      eligibilityStages: creditEligibilityStages,
      boundaries: creditMarketBoundaries,
    }),
    pool,
    activity: Object.freeze({
      sharedCheckpoints: graph.nodes.length,
      bundleBackedCheckpoints: evidenceAtLeast(["bundle_staged", "kernel_accepted", "review_recorded", "receipt_recorded"]),
      kernelAcceptedCheckpoints: evidenceAtLeast(["kernel_accepted", "review_recorded", "receipt_recorded"]),
      independentlyReviewedCheckpoints: evidenceAtLeast(["review_recorded", "receipt_recorded"]),
      settlementEligibleCheckpoints: evidenceAtLeast(["receipt_recorded"]),
      openReviewAssignments: Number(reviewCounts?.open_reviews ?? 0),
      completedReviewAssignments: Number(reviewCounts?.completed_reviews ?? 0),
    }),
  });
}

async function projectPool(rows: readonly PoolRow[]) {
  const first = rows[0];
  if (!first) return null;
  if (first.policy_version !== creditMarketPolicyVersion || first.unit !== creditMarketUnit) {
    throw new CreditMarketIntegrityError("The stored credit pool policy or unit is unsupported.");
  }
  const eventRows = rows.filter((row) => row.event_sequence !== null);
  if (eventRows.length === 0) {
    throw new CreditMarketIntegrityError("A stored credit pool must begin with an immutable created event.");
  }
  for (const row of eventRows) await assertEventIntegrity(row);
  const state = projectCreditPoolState(eventRows.map((row) => ({
    sequence: row.event_sequence,
    eventType: row.event_type,
  }))) as CreditPoolState;
  return Object.freeze({
    id: first.pool_id,
    state,
    totalCredits: first.total_credits,
    sponsorLabel: first.sponsor_label,
    createdAt: first.pool_created_at,
    lastEventAt: eventRows.at(-1)?.occurred_at ?? first.pool_created_at,
  });
}

async function assertEventIntegrity(row: PoolRow) {
  if (!row.canonical_payload || !row.payload_hash || !row.event_type || !row.occurred_at) {
    throw new CreditMarketIntegrityError("A credit pool event is incomplete.");
  }
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(row.canonical_payload) as Record<string, unknown>;
  } catch {
    throw new CreditMarketIntegrityError("A credit pool event payload is not valid JSON.");
  }
  if (
    canonicalJson(payload) !== row.canonical_payload ||
    await sha256Canonical(payload) !== row.payload_hash ||
    payload.poolId !== row.pool_id ||
    payload.sequence !== row.event_sequence ||
    payload.eventType !== row.event_type ||
    payload.occurredAt !== row.occurred_at
  ) {
    throw new CreditMarketIntegrityError("A credit pool event failed its canonical hash or indexed-field check.");
  }
}

function isMissingCreditMarketTable(error: unknown): boolean {
  return error instanceof Error && /no such table:\s*(problem_credit_pools|problem_credit_pool_events)/i.test(error.message);
}
