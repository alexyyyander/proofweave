import { MissingDatabaseBindingError } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const record = await getCatalogRepository().findBySlug(slug);

    if (!record) {
      return Response.json(
        { error: { code: "not_found", message: "Catalog record not found." } },
        { status: 404 },
      );
    }

    return Response.json({ record });
  } catch (error) {
    const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json(
      { error: { code: "unavailable", message: "Catalog data is temporarily unavailable." } },
      { status },
    );
  }
}
