import { getMcpRepository } from "@/db/repositories/mcp";
import { apiError, mcpFailure, requireMcpPrincipal } from "@/app/lib/mcp-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authentication = await requireMcpPrincipal(request);
    if ("response" in authentication) return authentication.response;

    const { id } = await params;
    const attempt = await getMcpRepository().findAttempt(authentication.principal.personId, id);
    if (!attempt) return apiError("not_found", "Attempt not found.", 404);
    return Response.json({ attempt });
  } catch (error) {
    return mcpFailure(error);
  }
}
