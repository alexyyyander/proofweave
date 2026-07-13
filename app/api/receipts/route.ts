import { MissingDatabaseBindingError } from "@/db";
import { getContributionReceiptReader } from "@/db/repositories/receipts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const receipts = await getContributionReceiptReader().listRecent();
    return Response.json(
      { receipts },
      { headers: { "cache-control": "public, max-age=120, s-maxage=300" } },
    );
  } catch (error) {
    const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json(
      { error: { code: "unavailable", message: "Contribution Receipt index is temporarily unavailable." } },
      { status },
    );
  }
}
