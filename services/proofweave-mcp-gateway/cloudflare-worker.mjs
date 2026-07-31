import {
  RemoteMcpRuntimeConfigurationError,
  createD1RemoteMcpGatewayRuntime,
} from "./runtime.mjs";
import {
  createStructuredHttpAudit,
  emitStructuredConsole,
} from "../../packages/observability/structured-audit.mjs";
import {
  controlPlaneSurfaceOperationState,
} from "../database/control-plane-operation-mode.mjs";

/**
 * Deployment entrypoint. It deliberately has no authorization-code or
 * consent implementation: Proofweave Identity is a separate deployment. The
 * gateway can nevertheless validate that service's opaque D1-backed tokens
 * and enforce its own D1 inline-evidence attribution boundary once bindings
 * are supplied.
 */
export function createCloudflareGatewayWorker({ audit = defaultAudit() } = {}) {
  if (!audit || typeof audit.handle !== "function") {
    throw new TypeError("Cloudflare MCP gateway requires a structured HTTP audit boundary.");
  }
  return Object.freeze({
    async fetch(request, env) {
      return audit.handle(request, async () => {
        try {
          const operationState = controlPlaneSurfaceOperationState({
            globalValue: env.PROOFWEAVE_CONTROL_PLANE_MODE,
            surfaceValue: env.PROOFWEAVE_MCP_CONTROL_PLANE_MODE,
            surface: "mcp",
          });
          return await createD1RemoteMcpGatewayRuntime({
            database: env.DB,
            resource: env.MCP_RESOURCE_URL,
            issuer: env.OAUTH_ISSUER_URL,
            runnerQueue: env.RUNNER_QUEUE,
            runnerQueueMode: env.RUNNER_QUEUE_MODE,
            runnerApprovedImagesJson: env.RUNNER_APPROVED_IMAGES_JSON,
            runnerControlPlaneKeyId: env.RUNNER_CONTROL_PLANE_KEY_ID,
            runnerControlPlanePrivateKeyJwkJson: env.RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK,
            runnerDefaultLimitsJson: env.RUNNER_DEFAULT_LIMITS_JSON,
            runnerWakeUrl: env.RUNNER_WAKE_URL,
            runnerWakeToken: env.RUNNER_WAKE_TOKEN,
            runnerWakeHostAuthorizationToken: env.RUNNER_WAKE_HOST_AUTHORIZATION_TOKEN,
            receiptIssuerKeyId: env.RECEIPT_ISSUER_KEY_ID,
            receiptIssuerPublicKey: env.RECEIPT_ISSUER_PUBLIC_KEY,
            receiptIssuerPrivateKeyJwkJson: env.RECEIPT_ISSUER_PRIVATE_KEY_JWK,
            receiptIssuerActivatedAt: env.RECEIPT_ISSUER_ACTIVATED_AT,
            operationMode: operationState.mode,
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
      });
    },
  });
}

function defaultAudit() {
  return createStructuredHttpAudit({
    component: "remote_mcp_gateway",
    emit: emitStructuredConsole,
  });
}

export default createCloudflareGatewayWorker();
