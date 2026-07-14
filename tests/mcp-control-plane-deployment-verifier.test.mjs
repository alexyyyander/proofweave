import assert from "node:assert/strict";
import test from "node:test";
import { remoteMcpScopes } from "../packages/protocol/remote-mcp-scopes.mjs";
import {
  McpControlPlaneDeploymentVerificationError,
  verifyMcpControlPlaneDeployment,
} from "../scripts/verify-mcp-control-plane-deployment.mjs";

const manifest = {
  control_plane: {
    d1_database_name: "proofweave-control-alpha",
    d1_database_id: "ce75f2fb-40a9-4d14-9393-6cdb6a6f6069",
    artifact_storage: "d1_inline",
  },
  gateway: {
    worker_name: "proofweave-mcp-gateway-alpha",
    resource_url: "https://mcp.proofweave.test/mcp",
  },
  identity: { issuer_url: "https://auth.proofweave.test/" },
};

test("live deployment verifier checks discovery and the unauthenticated MCP challenge without a credential", async () => {
  const requests = [];
  const result = await verifyMcpControlPlaneDeployment(manifest, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url === "https://mcp.proofweave.test/.well-known/oauth-protected-resource") {
        return Response.json({
          resource: manifest.gateway.resource_url,
          authorization_servers: [manifest.identity.issuer_url],
          scopes_supported: remoteMcpScopes,
        });
      }
      if (url === "https://auth.proofweave.test/.well-known/oauth-authorization-server") {
        return Response.json({
          issuer: manifest.identity.issuer_url,
          authorization_endpoint: "https://auth.proofweave.test/authorize",
          token_endpoint: "https://auth.proofweave.test/token",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: remoteMcpScopes,
        });
      }
      if (url === manifest.gateway.resource_url) {
        return new Response(JSON.stringify({ error: "invalid_token" }), {
          status: 401,
          headers: {
            "content-type": "application/json",
            "www-authenticate": 'Bearer resource_metadata="https://mcp.proofweave.test/.well-known/oauth-protected-resource"',
          },
        });
      }
      throw new Error(`Unexpected request ${url}`);
    },
  });

  assert.deepEqual(result.checks, [
    "protected-resource metadata",
    "authorization-server metadata",
    "unauthenticated MCP challenge",
  ]);
  assert.deepEqual(requests.map(({ url, init }) => [url, init.method, init.redirect]), [
    ["https://mcp.proofweave.test/.well-known/oauth-protected-resource", "GET", "error"],
    ["https://auth.proofweave.test/.well-known/oauth-authorization-server", "GET", "error"],
    ["https://mcp.proofweave.test/mcp", "POST", "error"],
  ]);
  assert.equal(requests[2].init.headers.Authorization, undefined);
});

test("live deployment verifier rejects metadata that broadens scopes or points at another issuer", async () => {
  await assert.rejects(
    verifyMcpControlPlaneDeployment(manifest, {
      fetchImpl: async (url) => {
        if (url.includes("oauth-protected-resource")) {
          return Response.json({
            resource: manifest.gateway.resource_url,
            authorization_servers: ["https://wrong.proofweave.test/"],
            scopes_supported: [...remoteMcpScopes, "admin:all"],
          });
        }
        throw new Error("Only protected-resource metadata should be needed after the mismatch.");
      },
    }),
    McpControlPlaneDeploymentVerificationError,
  );
});
