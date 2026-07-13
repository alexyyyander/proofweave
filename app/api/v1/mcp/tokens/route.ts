import { apiError } from "@/app/lib/mcp-api";

export const dynamic = "force-dynamic";

export async function POST() {
  return apiError(
    "precondition_failed",
    "Static MCP tokens are retired. Proofweave is moving to a remote OAuth MCP gateway.",
    410,
  );
}
