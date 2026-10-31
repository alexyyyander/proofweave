/** Resolve only the configured canonical origin and optional transition origin. */
export function resolveSitesOAuthAuthority(requestUrl, settings = {}) {
  try {
    const request = new URL(requestUrl);
    const canonical = httpsOrigin(settings.OAUTH_ISSUER_URL ?? request.origin);
    const legacy = settings.OAUTH_LEGACY_ISSUER_URL
      ? httpsOrigin(settings.OAUTH_LEGACY_ISSUER_URL)
      : null;
    const resource = new URL(settings.MCP_RESOURCE_URL ?? `${canonical}/api/mcp`);
    if (resource.origin !== canonical || resource.username || resource.password || resource.search || resource.hash) return null;
    if (request.origin !== canonical && request.origin !== legacy) return null;
    return { issuer: request.origin, resource: `${request.origin}${resource.pathname}` };
  } catch {
    return null;
  }
}

/** Keep OAuth, pairing, downloads and authenticated work on their original host. */
export function canonicalPublicRedirect(request, settings = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!settings.OAUTH_ISSUER_URL || !settings.OAUTH_LEGACY_ISSUER_URL) return null;
  const url = new URL(request.url);
  if (url.origin !== settings.OAUTH_LEGACY_ISSUER_URL) return null;
  if (!resolveSitesOAuthAuthority(url, settings)) return null;
  if (!/^\/(?:$|(?:about|explore|demo|history|receipts|how-it-works)(?:\/|$)|codex-install\.md$)/.test(url.pathname)) return null;
  return new URL(`${url.pathname}${url.search}`, settings.OAUTH_ISSUER_URL).toString();
}

function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("OAuth issuer must be an HTTPS origin.");
  }
  return url.origin;
}
