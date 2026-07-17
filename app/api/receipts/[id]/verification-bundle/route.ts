import { MissingDatabaseBindingError } from "@/db";
import { buildContributionReceiptVerificationBundle } from "@/db/repositories/receipt-verification-bundle";
import { contributionReceiptVerificationBundleHash } from "@/packages/protocol/contribution-receipt-verification-bundle.mjs";

export const dynamic = "force-dynamic";

/**
 * A portable public evidence closure for external maintenance and offline
 * verification. It never includes private Bundle objects or signing secrets.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const bundle = await buildContributionReceiptVerificationBundle(id);
    if (!bundle) {
      return Response.json(
        { error: { code: "not_found", message: "Contribution Receipt not found." } },
        { status: 404 },
      );
    }
    const bundleHash = await contributionReceiptVerificationBundleHash(bundle);
    return new Response(`${JSON.stringify(bundle, null, 2)}\n`, {
      headers: {
        "cache-control": "public, max-age=60, s-maxage=300",
        "content-disposition": `attachment; filename="proofweave-${safeFilename(id)}-verification-bundle.json"`,
        "content-type": "application/json; charset=utf-8",
        "x-proofweave-verification-bundle-hash": bundleHash,
      },
    });
  } catch (error) {
    const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json(
      { error: { code: "unavailable", message: "Contribution Receipt verification bundle is temporarily unavailable." } },
      { status },
    );
  }
}

function safeFilename(receiptId: string): string {
  return receiptId.replaceAll(/[^A-Za-z0-9._-]/g, "-").slice(0, 180) || "receipt";
}
