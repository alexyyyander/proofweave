import {
  RemoteMcpRuntimeConfigurationError,
  createD1RemoteMcpGatewayRuntime,
} from "./runtime.mjs";

/**
 * Deployment entrypoint. It deliberately has no authorization-code or
 * consent implementation: Proofweave Identity is a separate deployment. The
 * gateway can nevertheless validate that service's opaque D1-backed tokens
 * and enforce its own D1/R2 attribution boundary once bindings are supplied.
 */
const cloudflareGatewayWorker = {
  async fetch(request, env) {
    try {
      return await createD1RemoteMcpGatewayRuntime({
        database: env.DB,
        bucket: env.ARTIFACTS,
        resource: env.MCP_RESOURCE_URL,
        issuer: env.OAUTH_ISSUER_URL,
      }).fetch(request);
    } catch (error) {
      if (error instanceof RemoteMcpRuntimeConfigurationError) {
        return Response.json(
          {
            error: "temporarily_unavailable",
            error_description: "Proofweave MCP is not configured with its required control-plane bindings.",
          },
          { status: 503, headers: { "Cache-Control": "no-store" } },
        );
      }
      throw error;
    }
  },
};

export default cloudflareGatewayWorker;
