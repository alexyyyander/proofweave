import { MissingDatabaseBindingError } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { parseCatalogQuery } from "@/packages/domain/catalog-browser";
import { InvalidCatalogCursor } from "@/services/catalog/browser";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  try {
    const page = await getCatalogRepository().browse({
      ...parseCatalogQuery(params), kind: "frontier", cursor: params.get("cursor"),
    });
    return Response.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof InvalidCatalogCursor ? 400 : error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json({ error: { code: status === 400 ? "invalid_cursor" : "unavailable",
      message: status === 400 ? "Restart the search from the first page." : "Catalog data is temporarily unavailable." } }, { status });
  }
}
