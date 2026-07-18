import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { apiError } from "@/app/lib/mcp-api";
import { getDelegationRepository } from "@/db/repositories/delegation";
import {
  getProblemProposalRepository,
  ProblemProposalIdempotencyConflictError,
  ProblemProposalSchemaUnavailableError,
} from "@/db/repositories/problem-proposals";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;
  try {
    const profile = await getDelegationRepository().getProfile(identity);
    return Response.json({
      proposals: await getProblemProposalRepository().listForPerson(profile.person.id),
      note: "A proposal is a curator-review request. It is not yet a public target, formalization, verification result, Receipt, or Proof Credit.",
    });
  } catch (error) {
    return proposalFailure(error);
  }
}

export async function POST(request: Request) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("invalid_input", "A proposal JSON object is required.", 400);
    }
    const profile = await getDelegationRepository().getProfile(identity);
    const result = await getProblemProposalRepository().create(profile.person.id, {
      title: body.title,
      domain: body.domain,
      informalStatement: body.informalStatement,
      motivation: body.motivation,
      sourceUrl: typeof body.sourceUrl === "string" && body.sourceUrl.trim() ? body.sourceUrl.trim() : null,
      idempotencyKey: body.idempotencyKey,
    });
    return Response.json({
      proposal: result.proposal,
      idempotentReplay: !result.created,
      note: "The proposal is durably attributed to your Person and awaits curation. No mathematical claim or credit was created.",
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return proposalFailure(error);
  }
}

function proposalFailure(error: unknown): Response {
  if (error instanceof TypeError) return apiError("invalid_input", error.message, 400);
  if (error instanceof ProblemProposalIdempotencyConflictError) return apiError("conflict", error.message, 409);
  if (error instanceof ProblemProposalSchemaUnavailableError) return apiError("unavailable", error.message, 503);
  return delegationFailure(error);
}
