import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { apiError } from "@/app/lib/mcp-api";
import { getDelegationRepository } from "@/db/repositories/delegation";
import {
  getProvisionalContributionRepository,
  ProvisionalContributionSchemaUnavailableError,
} from "@/db/repositories/provisional-contributions";

export const dynamic = "force-dynamic";

/**
 * Owner-only immediate evidence ledger. Its records prove that a delegated
 * Agent staged a signed Bundle; they do not assert mathematical correctness or
 * replace a later Contribution Receipt.
 */
export async function GET() {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const profile = await getDelegationRepository().getProfile(identity);
    return Response.json({
      contributions: await getProvisionalContributionRepository().listForPerson(profile.person.id),
      note: "Each record is an immutable staged-Bundle evidence record. It does not assert mathematical correctness; Lean execution, independent review, novelty, project acceptance, and Contribution Receipts remain separate gates.",
    });
  } catch (error) {
    if (error instanceof ProvisionalContributionSchemaUnavailableError) {
      return apiError("unavailable", "The staged evidence ledger is awaiting its control-plane migration.", 503);
    }
    return delegationFailure(error);
  }
}
