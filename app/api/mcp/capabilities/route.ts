import compatibilityContract from "@/packages/protocol/proofweave-client-compatibility.json";
import {
  getControlPlaneOperationState,
  getLiveControlPlaneDiagnostics,
  type LiveControlPlaneDiagnostics,
} from "@/db";

export const dynamic = "force-dynamic";

const capabilities = Object.freeze([
  "oauth_pkce_connection",
  "stable_attempt_handoff",
  "server_driven_attempt_lifecycle",
  "signed_research_checkpoints",
  "owner_approved_workspace_bundles",
  "isolated_lean_runs",
  "independent_review_replay",
]);
const distributionManifestPath = "/downloads/proofweave-research-marketplace.json";

export async function GET(request: Request) {
  const distributionManifestUrl = new URL(distributionManifestPath, request.url).toString();
  const releaseDiagnostics = await safeReleaseDiagnostics();
  const controlPlaneOperations = getControlPlaneOperationState();
  return Response.json({
    protocolVersion: compatibilityContract.protocolVersion,
    toolSchemaVersion: compatibilityContract.toolSchemaVersion,
    minimumConnectorApiVersion: compatibilityContract.connectorApiVersion,
    recommendedConnectorApiVersion: compatibilityContract.connectorApiVersion,
    distributionManifestUrl,
    capabilities,
    releaseDiagnostics,
    controlPlaneOperations,
    updatePolicy: {
      liveWithoutRestart: [
        "server_workflow",
        "authorization_policy",
        "attempt_lifecycle",
        "compatibility_metadata",
      ],
      restartCodexAfterPluginUpdate: [
        "mcp_tool_names",
        "mcp_tool_input_schemas",
        "plugin_skills",
      ],
    },
  }, {
    status: releaseDiagnostics.state === "ready" ? 200 : 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

async function safeReleaseDiagnostics(): Promise<LiveControlPlaneDiagnostics> {
  try {
    return await getLiveControlPlaneDiagnostics();
  } catch {
    return {
      schemaVersion: "pw-live-release-diagnostics-v2",
      state: "degraded",
      authority: "invalid",
      databaseFingerprint: null,
      ledgerHead: null,
      sourceRevision: null,
      sitesVersion: null,
      siteProjectId: null,
      failureCode: "control_plane_diagnostics_failed",
    };
  }
}
