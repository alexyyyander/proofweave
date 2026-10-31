import { openaiMathCollection } from "@/app/lib/publications";
import manifest from "@/data/proof-maps/manifest.json";
import leanCoverage from "@/data/proof-maps/lean-coverage.json";
import { buildProofMapIndex } from "@/packages/domain/proof-map-index.mjs";

export const dynamic = "force-dynamic";

export function GET() {
  const index = buildProofMapIndex(openaiMathCollection, manifest, leanCoverage);
  return Response.json(index, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=3600",
    },
  });
}
