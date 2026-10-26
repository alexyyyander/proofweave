/** Headers supplied by Sites dispatch must never authenticate a direct client. */
export function directCloudflareRequest(request) {
  const headers = new Headers(request.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("oai-") || name === "x-dispatched-app" ||
        name.startsWith("cloudflare-workers-version-")) {
      headers.delete(name);
    }
  }
  return new Request(request, { headers });
}

/** Freeze research HTTP writes; account callbacks have their own database fence. */
export function cloudflareValidationResponse(request, settings) {
  if (settings.PROOFWEAVE_DEPLOYMENT_STAGE === "production") return null;
  if (request.method === "GET" || request.method === "HEAD") return null;
  if (settings.PROOFWEAVE_DEPLOYMENT_STAGE === "validation" && request.method === "POST") {
    const path = new URL(request.url).pathname;
    // These handlers enforce their own protocol and SQL fences. Only enable
    // transport for explicitly configured surfaces, never arbitrary research APIs.
    const connectionPath = ["/api/connect/sessions", "/api/me/agents", "/api/me/keys", "/api/me/delegations"].includes(path)
      || /^\/api\/connect\/sessions\/[^/]+\/approve$/.test(path)
      || /^\/api\/me\/keys\/[^/]+\/(?:proof-challenge|proof|revoke)$/.test(path)
      || /^\/api\/me\/(?:delegations|agent-installations)\/[^/]+\/revoke$/.test(path);
    if (connectionPath && settings.PROOFWEAVE_CONTROL_PLANE_MODE === "read_write"
        && settings.PROOFWEAVE_CONNECTION_CONTROL_PLANE_MODE === "read_write") return null;
    if (["/authorize", "/token", "/register"].includes(path) &&
        settings.PROOFWEAVE_CONTROL_PLANE_MODE === "read_write" &&
        settings.PROOFWEAVE_OAUTH_CONTROL_PLANE_MODE === "read_write") return null;
    if (path === "/api/mcp" && settings.PROOFWEAVE_MCP_CONTROL_PLANE_MODE === "read_only" &&
        ["read_only", "read_write"].includes(settings.PROOFWEAVE_CONTROL_PLANE_MODE)) return null;
  }
  return Response.json({ error: "deployment_read_only" }, {
    status: 503, headers: { "Cache-Control": "no-store" },
  });
}

export function sitesLoginEnabled(settings) {
  return settings.PROOFWEAVE_HOSTING_PLATFORM !== "cloudflare";
}
