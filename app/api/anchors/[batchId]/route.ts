import { MissingDatabaseBindingError, getD1 } from "@/db";
import {
  anchorAdaptersConfigured,
  loadAnchorManifest,
  type AnchorManifestBucket,
} from "@/app/lib/anchor-routes";
import { D1AnchorStore } from "@/services/anchoring/d1-anchor-store.mjs";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const store = new D1AnchorStore(getD1());
    const settings = env as unknown as Record<string, unknown>;
    const result = await loadAnchorManifest({
      store,
      bucket: readManifestBucket(settings),
      batchId,
      adaptersConfigured: anchorAdaptersConfigured(settings.ANCHOR_ADAPTERS_JSON),
    });
    if (result.status === "anchoring_disabled") {
      return Response.json({ status: result.status, manifest: null });
    }
    if (result.status === "not_found") {
      return Response.json(
        { error: { code: "not_found", message: "Anchor batch not found." } },
        { status: 404 },
      );
    }
    if (result.status === "integrity_error") {
      return Response.json(
        { error: { code: "internal", message: "Anchor manifest failed its consistency check." } },
        { status: 500 },
      );
    }
    return Response.json(
      result.manifest,
      { headers: { "cache-control": "public, max-age=300, s-maxage=86400, immutable" } },
    );
  } catch (error) {
    return anchorFailure(error);
  }
}

function readManifestBucket(settings: Record<string, unknown>): AnchorManifestBucket | undefined {
  const bucket = settings.ANCHOR_MANIFEST_BUCKET;
  return bucket && typeof bucket === "object" && typeof (bucket as { get?: unknown }).get === "function"
    ? (bucket as AnchorManifestBucket)
    : undefined;
}

function anchorFailure(error: unknown): Response {
  const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
  return Response.json(
    { error: { code: "unavailable", message: "Anchor manifest data is temporarily unavailable." } },
    { status },
  );
}
