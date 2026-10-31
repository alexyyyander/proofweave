import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { buildAnchorAdapterRegistry, anchorCoordinatorConfigFromSettings } from "@/app/lib/anchor-routes";
import { anchorTickAuthorized, runHostedAnchorTick } from "@/services/anchoring/hosted-anchor-tick.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const settings = env as unknown as Record<string, unknown>;
  if (!anchorTickAuthorized(request.headers.get("authorization"), settings.ANCHOR_TICK_TOKEN)) {
    return Response.json({ status: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runHostedAnchorTick({ database: getD1(),
      registry: await buildAnchorAdapterRegistry(settings.ANCHOR_ADAPTERS_JSON),
      bucket: settings.ANCHOR_MANIFEST_BUCKET,
      config: anchorCoordinatorConfigFromSettings(settings),
    });
    return Response.json(result.summary, { status: result.exitCode ? 503 : 200,
      headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("anchor_tick_failed", error instanceof Error ? error.name : "unknown_error");
    return Response.json({ status: "failed" }, { status: 503 });
  }
}
