import { openaiMathCollection as collection, publicationFamily } from "@/app/lib/publications";

export async function GET(request: Request, { params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const family = publicationFamily(number);
  if (!family) return Response.json({ error: "Publication family not found" }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  return Response.json({ schemaVersion: collection.schemaVersion, collection: collection.id,
    source: collection.source, environment: collection.environment, indexedAt: collection.indexedAt, family,
  }, { headers: { "cache-control": "public, max-age=300",
    ...(download ? { "content-disposition": `attachment; filename="proofweave-openai-math-${number}.json"` } : {}),
  } });
}
