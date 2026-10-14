import { MissingDatabaseBindingError, getD1 } from "@/db";
import {
  anchorAdaptersConfigured,
  listPublicAnchorBatches,
} from "@/app/lib/anchor-routes";
import { D1AnchorStore } from "@/services/anchoring/d1-anchor-store.mjs";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = new D1AnchorStore(getD1());
    const settings = env as unknown as Record<string, unknown>;
    const result = await listPublicAnchorBatches({
      store,
      adaptersConfigured: anchorAdaptersConfigured(settings.ANCHOR_ADAPTERS_JSON),
    });
    if (result.status === "anchoring_disabled") {
      return Response.json({ status: result.status, batches: [] });
    }
    return Response.json(
      { batches: result.batches },
      { headers: { "cache-control": "public, max-age=30, s-maxage=120" } },
    );
  } catch (error) {
    return anchorFailure(error, "Anchor batch index is temporarily unavailable.");
  }
}

function anchorFailure(error: unknown, message: string): Response {
  const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
  return Response.json(
    { error: { code: "unavailable", message } },
    { status },
  );
}
