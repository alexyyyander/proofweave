import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Validate the non-secret operator manifest before a remote MCP gateway is
 * pointed at production. The gateway, authorization service, and web control
 * plane must use one D1/R2 evidence boundary; a fresh empty Worker database is
 * not a valid deployment.
 */
export function validateMcpControlPlaneManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Deployment manifest must be a JSON object.");
  }
  const controlPlane = object(value.control_plane, "control_plane");
  const gateway = object(value.gateway, "gateway");
  const identity = object(value.identity, "identity");

  const databaseName = requiredName(controlPlane.d1_database_name, "control_plane.d1_database_name");
  const databaseId = requiredUuid(controlPlane.d1_database_id, "control_plane.d1_database_id");
  const bucketName = requiredName(controlPlane.r2_bucket_name, "control_plane.r2_bucket_name");
  const gatewayName = requiredWorkerName(gateway.worker_name, "gateway.worker_name");
  const resourceUrl = requiredHttpsUrl(gateway.resource_url, "gateway.resource_url", "/mcp");
  const issuerUrl = requiredHttpsUrl(identity.issuer_url, "identity.issuer_url", "/");

  if (new URL(resourceUrl).origin === new URL(issuerUrl).origin) {
    throw new Error("gateway.resource_url and identity.issuer_url must use separate origins.");
  }
  return {
    controlPlane: { databaseName, databaseId, bucketName },
    gateway: { workerName: gatewayName, resourceUrl },
    identity: { issuerUrl },
  };
}

export function renderGatewayWranglerConfig(manifest) {
  const config = validateMcpControlPlaneManifest(manifest);
  return JSON.stringify({
    "$schema": "../../node_modules/wrangler/config-schema.json",
    name: config.gateway.workerName,
    main: "cloudflare-worker.mjs",
    compatibility_date: "2026-07-13",
    compatibility_flags: ["nodejs_compat"],
    vars: {
      MCP_RESOURCE_URL: config.gateway.resourceUrl,
      OAUTH_ISSUER_URL: config.identity.issuerUrl,
    },
    d1_databases: [{
      binding: "DB",
      database_name: config.controlPlane.databaseName,
      database_id: config.controlPlane.databaseId,
    }],
    r2_buckets: [{ binding: "ARTIFACTS", bucket_name: config.controlPlane.bucketName }],
  }, null, 2) + "\n";
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: node scripts/preflight-mcp-control-plane.mjs <deployment-manifest.json>");
  }
  const source = await readFile(manifestPath, "utf8");
  let manifest;
  try {
    manifest = JSON.parse(source);
  } catch {
    throw new Error("Deployment manifest must be valid JSON.");
  }
  validateMcpControlPlaneManifest(manifest);
  process.stdout.write(`${renderGatewayWranglerConfig(manifest)}\n`);
  process.stdout.write("MCP control-plane manifest is valid. Use the rendered configuration only after the same D1/R2 bindings serve the Proofweave web control plane.\n");
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function requiredName(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{1,62}$/i.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder Cloudflare resource name.`);
  }
  return value;
}

function requiredWorkerName(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{2,62}$/.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a lowercase Cloudflare Worker name.`);
  }
  return value;
}

function requiredUuid(value, label) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder D1 database UUID.`);
  }
  return value;
}

function requiredHttpsUrl(value, label, requiredPath) {
  if (typeof value !== "string" || isPlaceholder(value)) throw new Error(`${label} must be an HTTPS URL.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search || url.pathname !== requiredPath) {
    throw new Error(`${label} must be an HTTPS URL with path ${requiredPath}.`);
  }
  return url.toString();
}

function isPlaceholder(value) {
  return value.includes("REPLACE_") || value.includes("example") || value.includes("localhost");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Invalid deployment manifest."}\n`);
    process.exitCode = 1;
  });
}
