import { handleRemoteIdentity, handleRemoteMcp } from "@/app/lib/remote-mcp-runtime";

export const dynamic = "force-dynamic";

/**
 * Vinext/Next omit dot-prefixed filesystem segments from the route manifest.
 * Keep OAuth discovery on its standards-required `/.well-known/*` URLs via a
 * root catch-all while all concrete product routes retain precedence.
 */
export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const pathname = path.join("/");
  if (pathname === ".well-known/oauth-protected-resource") return handleRemoteMcp(request);
  if (pathname === ".well-known/oauth-authorization-server") return handleRemoteIdentity(request);
  return new Response("Not found", { status: 404 });
}
