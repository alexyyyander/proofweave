import {
  remoteMcpScopes,
  UnconfiguredIdentityProvider,
} from "../proofweave-mcp-gateway/worker.mjs";

/**
 * The OAuth authorization server for the remote MCP resource. A real adapter
 * must supply browser login, consent, authorization-code PKCE, refresh-token
 * rotation, token audience checks, revocation, and client-registration policy.
 */
export function createProofweaveIdentityService({ issuer, identityProvider }) {
  const issuerUrl = new URL(issuer);

  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.origin !== issuerUrl.origin) return new Response("Not found", { status: 404 });

      if (
        request.method === "GET" &&
        url.pathname === "/.well-known/oauth-authorization-server"
      ) {
        return json({
          issuer,
          authorization_endpoint: new URL("/authorize", issuerUrl).toString(),
          token_endpoint: new URL("/token", issuerUrl).toString(),
          registration_endpoint: new URL("/register", issuerUrl).toString(),
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          client_id_metadata_document_supported: true,
          scopes_supported: remoteMcpScopes,
        });
      }

      if (url.pathname === "/authorize") return oauthEndpoint(() => identityProvider.authorize(request));
      if (url.pathname === "/token") return oauthEndpoint(() => identityProvider.token(request));
      if (url.pathname === "/register") return oauthEndpoint(() => identityProvider.register(request));

      return new Response("Not found", { status: 404 });
    },
  };
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

async function oauthEndpoint(handler) {
  try {
    return await handler();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && "message" in error) {
      return json(
        { error: error.code, error_description: error.message },
        400,
      );
    }
    return json(
      { error: "server_error", error_description: "Proofweave Identity could not complete the request." },
      500,
    );
  }
}

export default createProofweaveIdentityService({
  issuer: "https://auth.proofweave.org",
  identityProvider: new UnconfiguredIdentityProvider(),
});
