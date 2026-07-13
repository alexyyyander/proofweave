import assert from "node:assert/strict";
import test from "node:test";
import {
  renderGatewayWranglerConfig,
  validateMcpControlPlaneManifest,
} from "../scripts/preflight-mcp-control-plane.mjs";

const manifest = {
  control_plane: {
    d1_database_name: "proofweave-control-alpha",
    d1_database_id: "ce75f2fb-40a9-4d14-9393-6cdb6a6f6069",
    r2_bucket_name: "proofweave-control-artifacts-alpha",
  },
  gateway: {
    worker_name: "proofweave-mcp-gateway-alpha",
    resource_url: "https://mcp.proofweave.test/mcp",
  },
  identity: { issuer_url: "https://auth.proofweave.test/" },
};

test("MCP control-plane preflight requires one concrete external binding manifest", () => {
  assert.deepEqual(validateMcpControlPlaneManifest(manifest), {
    controlPlane: {
      databaseName: "proofweave-control-alpha",
      databaseId: "ce75f2fb-40a9-4d14-9393-6cdb6a6f6069",
      bucketName: "proofweave-control-artifacts-alpha",
    },
    gateway: {
      workerName: "proofweave-mcp-gateway-alpha",
      resourceUrl: "https://mcp.proofweave.test/mcp",
    },
    identity: { issuerUrl: "https://auth.proofweave.test/" },
  });
  const generated = JSON.parse(renderGatewayWranglerConfig(manifest));
  assert.equal(generated.vars.MCP_RESOURCE_URL, manifest.gateway.resource_url);
  assert.equal(generated.vars.OAUTH_ISSUER_URL, manifest.identity.issuer_url);
  assert.equal(generated.d1_databases[0].database_id, manifest.control_plane.d1_database_id);
  assert.equal(generated.r2_buckets[0].bucket_name, manifest.control_plane.r2_bucket_name);
});

test("MCP control-plane preflight rejects placeholders and a same-origin authorization server", () => {
  assert.throws(
    () => validateMcpControlPlaneManifest({
      ...manifest,
      control_plane: { ...manifest.control_plane, d1_database_id: "REPLACE_WITH_D1_DATABASE_UUID" },
    }),
    /database UUID/,
  );
  assert.throws(
    () => validateMcpControlPlaneManifest({
      ...manifest,
      identity: { issuer_url: "https://mcp.proofweave.test/" },
    }),
    /separate origins/,
  );
});
