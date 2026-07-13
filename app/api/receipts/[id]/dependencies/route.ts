import { MissingDatabaseBindingError } from "@/db";
import { getContributionReceiptReader } from "@/db/repositories/receipts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const dependencies = await getContributionReceiptReader().findDependenciesById(id);
    if (!dependencies) {
      return Response.json(
        { error: { code: "not_found", message: "Contribution Receipt not found." } },
        { status: 404 },
      );
    }
    return Response.json(
      { receiptId: id, dependencies },
      { headers: { "cache-control": "public, max-age=300, s-maxage=86400, immutable" } },
    );
  } catch (error) {
    const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json(
      { error: { code: "unavailable", message: "Contribution Receipt dependency data is temporarily unavailable." } },
      { status },
    );
  }
}
