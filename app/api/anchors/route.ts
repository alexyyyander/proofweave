import { MissingDatabaseBindingError, getD1 } from "@/db";
import {
  AnchorListQueryError,
  anchorAdaptersConfigured,
  listPublicAnchorBatches,
  parseAnchorBatchListQuery,
} from "@/app/lib/anchor-routes";
import { D1AnchorStore } from "@/services/anchoring/d1-anchor-store.mjs";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const store = new D1AnchorStore(getD1());
    const settings = env as unknown as Record<string, unknown>;
    const query = parseAnchorBatchListQuery(anchorListQueryFromUrl(request.url));
    const result = await listPublicAnchorBatches({
      store,
      adaptersConfigured: anchorAdaptersConfigured(settings.ANCHOR_ADAPTERS_JSON),
      query,
    });
    if (result.status === "anchoring_disabled") {
      return Response.json({ status: result.status, batches: [] });
    }
    return Response.json(
      { batches: result.batches, pagination: result.pagination },
      { headers: { "cache-control": "public, max-age=30, s-maxage=120" } },
    );
  } catch (error) {
    if (error instanceof AnchorListQueryError) {
      return Response.json(
        { error: { code: "invalid_request", message: error.message } },
        { status: 400 },
      );
    }
    return anchorFailure(error, "Anchor batch index is temporarily unavailable.");
  }
}

function anchorListQueryFromUrl(url: string): { limit?: string; offset?: string; status?: string } {
  const params = new URL(url).searchParams;
  const query: { limit?: string; offset?: string; status?: string } = {};
  const limit = params.get("limit");
  if (limit !== null) query.limit = limit;
  const offset = params.get("offset");
  if (offset !== null) query.offset = offset;
  const status = params.get("status");
  if (status !== null) query.status = status;
  return query;
}

function anchorFailure(error: unknown, message: string): Response {
  const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
  return Response.json(
    { error: { code: "unavailable", message } },
    { status },
  );
}
