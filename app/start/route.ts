export const dynamic = "force-dynamic";

/**
 * Preserve a selected public target while sending every legacy /start entry
 * directly to the single Research Launcher in the Workspace. Reading the
 * request URL here avoids losing query parameters during a server-component
 * redirect in the current Vinext runtime.
 */
type RouteRequest = Request & {
  nextUrl?: URL;
};

export function GET(request: RouteRequest) {
  // Next/Vinext may expose the original browser URL through `nextUrl` even
  // when its normalized Request URL no longer contains the query string.
  const incoming = request.nextUrl ?? new URL(request.url);
  const target = incoming.searchParams.get("target")?.trim() ?? "";
  const destination = new URL("/workbench", incoming.origin);
  if (target.length > 0 && target.length <= 120) {
    destination.searchParams.set("target", target);
  }
  destination.hash = "research-launcher";
  return Response.redirect(destination, 307);
}
