import { getCatalogRepository } from "@/db/repositories/catalog";
import {
  apiError,
  mcpFailure,
  requireMcpPrincipal,
} from "@/app/lib/mcp-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const authentication = await requireMcpPrincipal(request);
    if ("response" in authentication) return authentication.response;

    const slug = new URL(request.url).searchParams.get("slug");
    if (slug) {
      const record = await getCatalogRepository().findBySlug(slug);
      if (!record) {
        return apiError("not_found", "Catalog record not found.", 404);
      }
      return Response.json({ record });
    }

    const records = await getCatalogRepository().list("frontier");
    return Response.json({ records });
  } catch (error) {
    return mcpFailure(error);
  }
}
