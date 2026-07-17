import { MissingDatabaseBindingError } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
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
    return Response.json({
      problem: { id: problem.id, slug: problem.slug, title: problem.title },
      graph,
      note: "Shared checkpoints are structured research progress. They are not Lean verification, independent review, novelty findings, or Contribution Receipts.",
    });
  } catch (error) {
    const unavailable = error instanceof MissingDatabaseBindingError || error instanceof ResearchGraphSchemaUnavailableError;
    return Response.json(
      { error: { code: "unavailable", message: "The public research graph is temporarily unavailable." } },
      { status: unavailable ? 503 : 500 },
    );
  }
}
