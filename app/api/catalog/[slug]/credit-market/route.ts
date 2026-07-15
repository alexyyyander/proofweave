import { MissingDatabaseBindingError } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
import {
  CreditMarketIntegrityError,
  CreditMarketSchemaUnavailableError,
  getCreditMarketRepository,
} from "@/db/repositories/credit-market";
import {
  getResearchGraphRepository,
  ResearchGraphSchemaUnavailableError,
} from "@/db/repositories/research-graph";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const problem = await getCatalogRepository().findBySlug(slug);
    if (!problem || problem.kind !== "frontier") {
      return Response.json({ error: { code: "not_found", message: "Frontier problem not found." } }, { status: 404 });
    }
    const graph = await getResearchGraphRepository().findByProblemRevisionId(problem.id);
    const market = await getCreditMarketRepository().findByProblemRevisionId(problem.id, graph);
    return Response.json({
      problem: { id: problem.id, slug: problem.slug, title: problem.title },
      market,
      note: "Research credits are non-transferable, non-financial, and settle only against verified Contribution Receipts in the final dependency closure.",
    });
  } catch (error) {
    const unavailable = error instanceof MissingDatabaseBindingError ||
      error instanceof CreditMarketSchemaUnavailableError ||
      error instanceof ResearchGraphSchemaUnavailableError;
    const integrityFailure = error instanceof CreditMarketIntegrityError;
    return Response.json(
      { error: {
        code: integrityFailure ? "integrity_failure" : "unavailable",
        message: integrityFailure
          ? "The credit market ledger failed its integrity projection."
          : "The public credit market is temporarily unavailable.",
      } },
      { status: unavailable ? 503 : 500 },
    );
  }
}
