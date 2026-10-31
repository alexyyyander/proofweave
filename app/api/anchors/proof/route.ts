import { MissingDatabaseBindingError, getD1 } from "@/db";
import {
  anchorAdaptersConfigured,
  computeAnchorProof,
} from "@/app/lib/anchor-routes";
import { D1AnchorStore } from "@/services/anchoring/d1-anchor-store.mjs";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const store = new D1AnchorStore(getD1());
    const settings = env as unknown as Record<string, unknown>;
    const result = await computeAnchorProof({
      store,
      adaptersConfigured: anchorAdaptersConfigured(settings.ANCHOR_ADAPTERS_JSON),
      type: url.searchParams.get("type"),
      recordId: url.searchParams.get("recordId"),
      recordHash: url.searchParams.get("recordHash"),
    });
    if (result.status === "invalid_request") {
      return Response.json(
        { error: { code: "invalid_request", message: result.message } },
        { status: 400 },
      );
    }
    if (result.status === "anchoring_disabled") {
      return Response.json({ status: result.status });
    }
    if (result.status === "not_found") {
      return Response.json(
        { error: { code: "not_found", message: "The record is not enqueued for anchoring." } },
        { status: 404 },
      );
    }
    if (result.status === "mismatch") {
      return Response.json(result, { status: 409, headers: { "cache-control": "no-store" } });
    }
    return Response.json(result, { headers: { "cache-control": "public, max-age=15, s-maxage=60" } });
  } catch (error) {
    return anchorFailure(error);
  }
}

function anchorFailure(error: unknown): Response {
  const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
  return Response.json(
    { error: { code: "unavailable", message: "Anchor proof data is temporarily unavailable." } },
    { status },
  );
}
