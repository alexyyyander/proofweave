import compatibilityContract from "@/packages/protocol/proofweave-client-compatibility.json";

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

export async function GET() {
  return Response.json({
    protocolVersion: compatibilityContract.protocolVersion,
    toolSchemaVersion: compatibilityContract.toolSchemaVersion,
    minimumConnectorApiVersion: compatibilityContract.connectorApiVersion,
    recommendedConnectorApiVersion: compatibilityContract.connectorApiVersion,
    capabilities,
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
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
