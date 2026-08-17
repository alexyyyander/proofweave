import { MissingDatabaseBindingError } from "@/db";
import {
  CuratedResearchSchemaUnavailableError,
  getCuratedResearchRepository,
} from "@/db/repositories/curated-research";
import { getCatalogRepository } from "@/db/repositories/catalog";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const problem = await getCatalogRepository().findBySlug(slug);
    if (!problem || problem.kind !== "frontier") {
      return Response.json(
        { error: { code: "not_found", message: "Frontier problem not found." } },
        { status: 404 },
      );
    }

    const records = await getCuratedResearchRepository().findByProblemRevisionId(problem.id);
    return Response.json({
      problem: { id: problem.id, slug: problem.slug, title: problem.title },
      records,
      note: "Curated research records are source-backed context. They do not imply Proofweave verification or a Contribution Receipt.",
    });
  } catch (error) {
    const unavailable = error instanceof MissingDatabaseBindingError || error instanceof CuratedResearchSchemaUnavailableError;
    return Response.json(
      { error: { code: "unavailable", message: "The curated research record is temporarily unavailable." } },
      { status: unavailable ? 503 : 500 },
    );
  }
}
