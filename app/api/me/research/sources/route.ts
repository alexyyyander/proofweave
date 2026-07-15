import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { apiError } from "@/app/lib/mcp-api";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { getDelegationRepository } from "@/db/repositories/delegation";
import {
  getResearchGraphRepository,
  ResearchGraphConflictError,
  ResearchGraphNotFoundError,
  ResearchGraphSchemaUnavailableError,
  ResearchGraphValidationError,
  type ExternalWorkImportInput,
} from "@/db/repositories/research-graph";

export const dynamic = "force-dynamic";

type HistoricalSourceRequest = Omit<ExternalWorkImportInput, "problemRevisionId" | "retrievedAt"> & {
  problemSlug: string;
};

/**
 * Import source-backed historical attribution without minting a delegation,
 * verification result, native contribution, or Receipt.
 */
export async function POST(request: Request) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;
  try {
    const input = await request.json().catch(() => null) as HistoricalSourceRequest | null;
    if (!input) return apiError("invalid_input", "Historical source metadata is required.", 400);
    const problem = await getCatalogRepository().findBySlug(input.problemSlug);
    if (!problem || problem.kind !== "frontier") {
      return apiError("not_found", "Frontier problem not found.", 404);
    }
    const profile = await getDelegationRepository().getProfile(identity);
    const result = await getResearchGraphRepository().importExternalWork(profile.person.id, {
      problemRevisionId: problem.id,
      sourceSystem: input.sourceSystem,
      sourceUrl: input.sourceUrl,
      sourceObjectId: input.sourceObjectId,
      sourceRevision: input.sourceRevision,
      title: input.title,
      contentHash: input.contentHash,
      sourceLicense: input.sourceLicense,
      retrievedAt: new Date().toISOString(),
      contributors: input.contributors,
    });
    return Response.json({
      ...result,
      note: "This preserves source-backed historical attribution only. It does not create a Proofweave delegation, verification, contribution score, or Receipt.",
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof ResearchGraphValidationError) return apiError("invalid_input", error.message, 400);
    if (error instanceof ResearchGraphNotFoundError) return apiError("not_found", error.message, 404);
    if (error instanceof ResearchGraphConflictError) return apiError("conflict", error.message, 409);
    if (error instanceof ResearchGraphSchemaUnavailableError) return apiError("unavailable", error.message, 503);
    return delegationFailure(error);
  }
}
