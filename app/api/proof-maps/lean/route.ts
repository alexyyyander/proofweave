import leanCoverage from "@/data/proof-maps/lean-coverage.json";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(leanCoverage, {
    headers: {
      "cache-control": "public, max-age=300, s-maxage=3600",
    },
  });
}
