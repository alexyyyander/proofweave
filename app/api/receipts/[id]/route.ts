import { MissingDatabaseBindingError } from "@/db";
import { getContributionReceiptReader } from "@/db/repositories/receipts";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const record = await getContributionReceiptReader().findById(id);

    if (!record) {
      return Response.json(
        { error: { code: "not_found", message: "Contribution Receipt not found." } },
        { status: 404 },
      );
    }

    return Response.json(record, {
      headers: { "cache-control": "public, max-age=300, s-maxage=86400, immutable" },
    });
  } catch (error) {
    const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json(
      { error: { code: "unavailable", message: "Contribution Receipt data is temporarily unavailable." } },
      { status },
    );
  }
}
