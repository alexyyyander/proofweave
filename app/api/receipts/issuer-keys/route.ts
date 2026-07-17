import { MissingDatabaseBindingError } from "@/db";
import { getContributionReceiptReader } from "@/db/repositories/receipts";

export const dynamic = "force-dynamic";

/**
 * Public key-distribution record for independently verifying issued receipts.
 * It contains no signing material and cannot issue, rotate, or revoke a key.
 */
export async function GET() {
  try {
    const issuerKeys = await getContributionReceiptReader().listIssuerKeys();
    return Response.json(
      { issuerKeys },
      { headers: { "cache-control": "public, max-age=120, s-maxage=300" } },
    );
  } catch (error) {
    const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json(
      { error: { code: "unavailable", message: "Contribution Receipt issuer keys are temporarily unavailable." } },
      { status },
    );
  }
}
