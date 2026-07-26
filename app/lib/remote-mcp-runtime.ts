import { MissingDatabaseBindingError, getD1 } from "@/db";
import { createD1SitesIdentityRuntime } from "@/services/proofweave-identity/sites-runtime.mjs";
import {
  RemoteMcpRuntimeConfigurationError,
  createD1RemoteMcpGatewayRuntime,
} from "@/services/proofweave-mcp-gateway/runtime.mjs";
import { env } from "cloudflare:workers";

export const proofweaveMcpPath = "/api/mcp";

export function proofweaveMcpResource(request: Request): string {
  return `${new URL(request.url).origin}${proofweaveMcpPath}`;
}

export async function handleRemoteMcp(request: Request): Promise<Response> {
  try {
    const origin = new URL(request.url).origin;
    const settings = env as unknown as Record<string, string | undefined>;
    return await createD1RemoteMcpGatewayRuntime({
      database: getD1(),
      resource: `${origin}${proofweaveMcpPath}`,
      issuer: `${origin}/`,
      runnerQueueMode: settings.RUNNER_QUEUE_MODE,
      runnerApprovedImagesJson: settings.RUNNER_APPROVED_IMAGES_JSON,
      runnerControlPlaneKeyId: settings.RUNNER_CONTROL_PLANE_KEY_ID,
      runnerControlPlanePrivateKeyJwkJson: settings.RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK,
      runnerDefaultLimitsJson: settings.RUNNER_DEFAULT_LIMITS_JSON,
      runnerWakeUrl: settings.RUNNER_WAKE_URL,
      runnerWakeToken: settings.RUNNER_WAKE_TOKEN,
      runnerWakeHostAuthorizationToken: settings.RUNNER_WAKE_HOST_AUTHORIZATION_TOKEN,
      receiptIssuerKeyId: settings.RECEIPT_ISSUER_KEY_ID,
      receiptIssuerPublicKey: settings.RECEIPT_ISSUER_PUBLIC_KEY,
      receiptIssuerPrivateKeyJwkJson: settings.RECEIPT_ISSUER_PRIVATE_KEY_JWK,
      receiptIssuerActivatedAt: settings.RECEIPT_ISSUER_ACTIVATED_AT,
    }).fetch(request);
  } catch (error) {
    return remoteMcpFailure("mcp", error);
  }
}

export async function handleRemoteIdentity(request: Request): Promise<Response> {
  try {
    const origin = new URL(request.url).origin;
    return await createD1SitesIdentityRuntime({
      database: getD1(),
      resource: `${origin}${proofweaveMcpPath}`,
      issuer: `${origin}/`,
    }).fetch(request);
  } catch (error) {
    return remoteMcpFailure("identity", error);
  }
}

function remoteMcpFailure(surface: "mcp" | "identity", error: unknown): Response {
  const category = error instanceof MissingDatabaseBindingError
    ? "missing_database_binding"
    : error instanceof RemoteMcpRuntimeConfigurationError
      ? "runtime_configuration"
      : "unexpected_runtime_error";
  const diagnostic = error instanceof RemoteMcpRuntimeConfigurationError
    ? error.message
    : error instanceof Error
      ? error.name
      : typeof error;
  console.error("proofweave_remote_runtime_failure", {
    surface,
    category,
    diagnostic,
  });
  const message = error instanceof MissingDatabaseBindingError
    ? "Proofweave connection storage is unavailable."
    : "Proofweave local connection is temporarily unavailable.";
  return Response.json({ error: "temporarily_unavailable", error_description: message }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}
