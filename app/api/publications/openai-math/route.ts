import { openaiMathCollection } from "@/app/lib/publications";

export async function GET(request: Request) {
  const download = new URL(request.url).searchParams.get("download") === "1";
  return Response.json(openaiMathCollection, { headers: {
    "cache-control": "public, max-age=300",
    ...(download ? { "content-disposition": 'attachment; filename="proofweave-openai-math.json"' } : {}),
  } });
}
