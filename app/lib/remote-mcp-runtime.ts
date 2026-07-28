import {
  MissingDatabaseBindingError,
  getControlPlaneOperationState,
  getD1,
} from "@/db";
import { createD1SitesIdentityRuntime } from "@/services/proofweave-identity/sites-runtime.mjs";
import { ControlPlaneReadOnlyError } from "@/services/database/control-plane-operation-mode.mjs";
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
    const operationState = getControlPlaneOperationState();
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
      operationMode: operationState.mode,
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
    : error instanceof ControlPlaneReadOnlyError
      ? "control_plane_read_only"
    : error instanceof RemoteMcpRuntimeConfigurationError
      ? "runtime_configuration"
      : "unexpected_runtime_error";
  const diagnosticCode = remoteRuntimeDiagnosticCode(error);
  console.error(JSON.stringify({
    event: "proofweave_remote_runtime_failure",
    surface,
    category,
    diagnosticCode,
  }));
  const message = error instanceof MissingDatabaseBindingError
    ? "Proofweave connection storage is unavailable."
    : error instanceof ControlPlaneReadOnlyError
      ? "Proofweave is temporarily read-only for maintenance."
    : "Proofweave local connection is temporarily unavailable.";
  return Response.json({
    error: "temporarily_unavailable",
    error_description: message,
    diagnostic_code: diagnosticCode,
  }, {
    status: 503,
    headers: { "Cache-Control": "no-store" },
  });
}

function remoteRuntimeDiagnosticCode(error: unknown): string {
  if (error instanceof MissingDatabaseBindingError) return "database_binding_unavailable";
  if (error instanceof ControlPlaneReadOnlyError) return "control_plane_read_only";
  if (!(error instanceof RemoteMcpRuntimeConfigurationError)) return "unexpected_runtime_error";
  const message = error.message.toLowerCase();
  if (message.includes("runner wake") || message.includes("runner host authorization")) {
    return "runner_wake_configuration_invalid";
  }
  if (message.includes("runner queue") || message.includes("d1 runner queue")) {
    return "runner_queue_configuration_invalid";
  }
  if (message.includes("runner dispatch")) return "runner_dispatch_configuration_invalid";
  if (message.includes("receipt issuance")) return "receipt_issuer_configuration_invalid";
  if (message.includes("d1 db binding")) return "database_binding_invalid";
  return "runtime_configuration_invalid";
}
