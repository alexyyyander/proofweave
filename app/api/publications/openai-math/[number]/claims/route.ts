import claimsCollection from "@/data/publications/claims/openai-math-claims.json";
import { lookupClaimsByFamily } from "@/packages/domain/publication-claims.mjs";

export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const family = lookupClaimsByFamily(claimsCollection, number);
  if (!family) {
    return Response.json({ error: "Publication claims not found" }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  const download = new URL(request.url).searchParams.get("download") === "1";
  return Response.json({
    schemaVersion: claimsCollection.schemaVersion,
    familyNumber: family.familyNumber,
    claims: family.claims,
    boundary: claimsCollection.boundary,
    source: claimsCollection.source,
  }, { headers: {
    "cache-control": "no-store",
    ...(download ? { "content-disposition": `attachment; filename="proofweave-openai-math-${family.familyNumber}-claims.json"` } : {}),
  } });
}
