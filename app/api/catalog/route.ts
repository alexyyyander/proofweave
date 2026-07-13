import { MissingDatabaseBindingError } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
import type { CatalogRecordKind } from "@/packages/domain/catalog";

function catalogKind(value: string | null): CatalogRecordKind | null {
  if (value === null || value === "frontier") return "frontier";
  if (value === "practice") return "practice";
  return null;
}

export async function GET(request: Request) {
  const kind = catalogKind(new URL(request.url).searchParams.get("kind"));
  if (!kind) {
    return Response.json(
      { error: { code: "invalid_input", message: "kind must be frontier or practice" } },
      { status: 400 },
    );
  }

  try {
    const records = await getCatalogRepository().list(kind);
    return Response.json({ records });
  } catch (error) {
    const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json(
      { error: { code: "unavailable", message: "Catalog data is temporarily unavailable." } },
      { status },
    );
  }
}
