import { MissingDatabaseBindingError } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
import {
  CuratedResearchSchemaUnavailableError,
  getCuratedResearchRepository,
} from "@/db/repositories/curated-research";
import {
  getResearchGraphRepository,
  ResearchGraphSchemaUnavailableError,
} from "@/db/repositories/research-graph";
import { buildReuseIndex } from "@/services/research/reuse-index.mjs";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const repository = getCatalogRepository();
    const problem = await repository.findBySlug(slug);
    if (!problem) {
      return Response.json(
        { error: { code: "not_found", message: "Catalog record not found." } },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const [catalog, curatedResearch, researchGraph] = await Promise.all([
      readCatalogTargets(repository),
      readCuratedResearch(problem.id),
      readResearchGraph(problem.id),
    ]);
    const index = buildReuseIndex({
      catalog,
      curatedResearch,
      researchGraph,
      current: problem,
    });

    return Response.json(
      {
        problem: {
          id: problem.id,
          slug: problem.slug,
          title: problem.title,
          kind: problem.kind,
        },
        ...index,
        note: "Reuse hints are possible duplicate / related / prior work signals. Public context is not Proofweave verification; a hint does not establish novelty, correctness, or a Contribution Receipt.",
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const unavailable = error instanceof MissingDatabaseBindingError;
    return Response.json(
      { error: { code: "unavailable", message: "The reuse index is temporarily unavailable." } },
      { status: unavailable ? 503 : 500, headers: NO_STORE_HEADERS },
    );
  }
}

async function readCatalogTargets(
  repository: ReturnType<typeof getCatalogRepository>,
): ReturnType<ReturnType<typeof getCatalogRepository>["list"]> {
  const [frontier, practice] = await Promise.all([
    repository.list("frontier"),
    repository.list("practice"),
  ]);
  return [...frontier, ...practice];
}

async function readCuratedResearch(problemRevisionId: string) {
  try {
    return await getCuratedResearchRepository().findByProblemRevisionId(problemRevisionId);
  } catch (error) {
    if (error instanceof CuratedResearchSchemaUnavailableError) return null;
    throw error;
  }
}

async function readResearchGraph(problemRevisionId: string) {
  try {
    return await getResearchGraphRepository().findByProblemRevisionId(problemRevisionId);
  } catch (error) {
    if (error instanceof ResearchGraphSchemaUnavailableError) return null;
    throw error;
  }
}
