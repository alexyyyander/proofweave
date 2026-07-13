import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { apiError, mcpFailure } from "@/app/lib/mcp-api";
import { getCatalogRepository } from "@/db/repositories/catalog";
import {
  getDelegationRepository,
} from "@/db/repositories/delegation";
import {
  getMcpRepository,
  McpAttemptNotActiveError,
  McpAttemptQuotaExceededError,
  McpDelegationRequiredError,
  McpIdempotencyConflictError,
} from "@/db/repositories/mcp";

export const dynamic = "force-dynamic";

/**
 * Owner-only closed-alpha work queue. Opening an Attempt gives an already
 * delegated Agent a durable bounded workspace; it does not impersonate an
 * Agent signature, append research progress, submit a Bundle, or make any
 * mathematical claim.
 */
export async function GET() {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const profile = await getDelegationRepository().getProfile(identity);
    const mcp = getMcpRepository();
    const [attempts, runs] = await Promise.all([
      mcp.listAttempts(profile.person.id),
      mcp.listRunSummaries(profile.person.id),
    ]);
    return Response.json({
      attempts,
      runs,
      note: "Attempts are provisional owner records. Runner summaries are owner-scoped evidence projections; Agent progress, Lean verification, review, and receipts remain separate evidence boundaries.",
    });
  } catch (error) {
    return attemptFailure(error);
  }
}

export async function POST(request: Request) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const body = await request.json().catch(() => null);
    const problemSlug = boundedString(body?.problemSlug, 120);
    const delegationCertificateId = boundedString(body?.delegationCertificateId, 240);
    const delegationScope = body?.delegationScope;
    const idempotencyKey = boundedString(body?.idempotencyKey, 160) ?? `owner-attempt:${crypto.randomUUID()}`;
    if (!problemSlug || !delegationCertificateId || (delegationScope !== "formalize" && delegationScope !== "prove")) {
      return apiError(
        "invalid_input",
        "problemSlug, delegationCertificateId, and delegationScope (formalize or prove) are required.",
        400,
      );
    }

    const delegationRepository = getDelegationRepository();
    const profile = await delegationRepository.getProfile(identity);
    const delegation = await delegationRepository.assertAuthorizedDelegation(
      profile.person.id,
      delegationCertificateId,
      delegationScope,
      new Date().toISOString(),
    );
    const agent = profile.agents.find((candidate) =>
      candidate.id === delegation.agentId && candidate.status === "active" && candidate.revokedAt === null,
    );
    if (!agent) {
      return apiError("precondition_failed", "The selected delegation no longer has an active registered Agent.", 412);
    }

    const problem = await getCatalogRepository().findBySlug(problemSlug);
    if (!problem || problem.kind !== "frontier") {
      return apiError("not_found", "A public frontier catalog record with that slug was not found.", 404);
    }

    const result = await getMcpRepository().createAttempt(profile.person.id, {
      problemRevisionId: problem.id,
      agentId: agent.id,
      agentLabel: agent.label,
      delegationCertificateId: delegation.id,
      delegationScope,
      idempotencyKey,
      openedBy: "owner",
    });
    return Response.json(
      {
        attempt: result.value,
        idempotentReplay: !result.created,
        note: "The owner opened this provisional Attempt for the selected Agent. It is not an Agent-signed event, Lean verification, independent review, or a contribution receipt.",
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return attemptFailure(error);
  }
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function attemptFailure(error: unknown): Response {
  if (
    error instanceof McpIdempotencyConflictError ||
    error instanceof McpAttemptNotActiveError ||
    error instanceof McpAttemptQuotaExceededError ||
    error instanceof McpDelegationRequiredError
  ) {
    return mcpFailure(error);
  }
  return delegationFailure(error);
}
