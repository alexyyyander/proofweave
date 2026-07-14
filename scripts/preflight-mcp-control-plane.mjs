import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PinnedRunnerImageRegistry } from "../services/lean-runner/runner-image-policy.mjs";
import { normalizeLeanRunnerLimits } from "../packages/protocol/lean-runner.mjs";
import { maxInlineArtifactObjectBytes } from "../services/artifacts/d1-inline-artifact-store.mjs";

/**
 * Validate the non-secret operator manifest before a remote MCP gateway is
 * pointed at production. The gateway, authorization service, and web control
 * plane must use one D1 evidence boundary; a fresh empty Worker database is
 * not a valid deployment.
 */
export function validateMcpControlPlaneManifest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Deployment manifest must be a JSON object.");
  }
  rejectExtraKeys(value, ["control_plane", "gateway", "identity", "runner"], "Deployment manifest");
  const controlPlane = object(value.control_plane, "control_plane");
  const gateway = object(value.gateway, "gateway");
  const identity = object(value.identity, "identity");
  rejectExtraKeys(controlPlane, ["d1_database_name", "d1_database_id", "artifact_storage"], "control_plane");
  rejectExtraKeys(gateway, ["worker_name", "resource_url"], "gateway");
  rejectExtraKeys(identity, ["issuer_url"], "identity");

  const databaseName = requiredName(controlPlane.d1_database_name, "control_plane.d1_database_name");
  const databaseId = requiredUuid(controlPlane.d1_database_id, "control_plane.d1_database_id");
  const artifactStorage = requiredExact(controlPlane.artifact_storage, "d1_inline", "control_plane.artifact_storage");
  const gatewayName = requiredWorkerName(gateway.worker_name, "gateway.worker_name");
  const resourceUrl = requiredHttpsUrl(gateway.resource_url, "gateway.resource_url", "/mcp");
  const issuerUrl = requiredHttpsUrl(identity.issuer_url, "identity.issuer_url", "/");

  if (new URL(resourceUrl).origin === new URL(issuerUrl).origin) {
    throw new Error("gateway.resource_url and identity.issuer_url must use separate origins.");
  }
  const result = {
    controlPlane: { databaseName, databaseId, artifactStorage },
    gateway: { workerName: gatewayName, resourceUrl },
    identity: { issuerUrl },
  };
  if (value.runner !== undefined) result.runner = normalizeRunnerIntegration(value.runner);
  return Object.freeze(result);
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
      ...(config.runner ? {
        RUNNER_APPROVED_IMAGES_JSON: JSON.stringify(config.runner.approvedImages),
        RUNNER_CONTROL_PLANE_KEY_ID: config.runner.controlPlaneKeyId,
        RUNNER_DEFAULT_LIMITS_JSON: JSON.stringify(config.runner.defaultLimits),
      } : {}),
    },
    ...(config.runner ? {
      queues: { producers: [{ binding: "RUNNER_QUEUE", queue: config.runner.queueName }] },
    } : {}),
    d1_databases: [{
      binding: "DB",
      database_name: config.controlPlane.databaseName,
      database_id: config.controlPlane.databaseId,
    }],
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
  process.stdout.write("MCP control-plane manifest is valid. Use the rendered configuration only after the same D1 inline-evidence boundary serves the Proofweave web control plane.\n");
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function rejectExtraKeys(value, allowed, label) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`${label} contains unsupported field ${unexpected}.`);
}

function normalizeRunnerIntegration(value) {
  const runner = object(value, "runner");
  rejectExtraKeys(runner, ["queue_name", "approved_images", "control_plane_key_id", "default_limits"], "runner");
  const queueName = requiredQueueName(runner.queue_name, "runner.queue_name");
  if (!Array.isArray(runner.approved_images) || runner.approved_images.length === 0 || runner.approved_images.length > 16) {
    throw new Error("runner.approved_images must contain between one and sixteen image definitions.");
  }
  const approvedImages = runner.approved_images.map((image, index) => normalizeRunnerImage(image, index));
  // Align manifest validation with the exact image registry that will choose
  // an image for a signed Artifact Bundle in the deployed gateway.
  new PinnedRunnerImageRegistry({ images: approvedImages });
  let defaultLimits;
  try {
    defaultLimits = normalizeLeanRunnerLimits(normalizeRunnerLimits(runner.default_limits));
  } catch {
    throw new Error("runner.default_limits must satisfy the Lean Runner resource limits.");
  }
  if (defaultLimits.outputBytes > maxInlineArtifactObjectBytes) {
    throw new Error("Runner output limit exceeds the D1 inline alpha evidence limit.");
  }
  return Object.freeze({
    queueName,
    approvedImages: Object.freeze(approvedImages),
    controlPlaneKeyId: requiredIdentifier(runner.control_plane_key_id, "runner.control_plane_key_id"),
    defaultLimits,
  });
}

function normalizeRunnerImage(value, index) {
  const image = object(value, `runner.approved_images[${index}]`);
  rejectExtraKeys(image, ["image_digest", "lean_toolchain", "mathlib_revision"], `runner.approved_images[${index}]`);
  return Object.freeze({
    imageDigest: requiredText(image.image_digest, `runner.approved_images[${index}].image_digest`, 512),
    leanToolchain: requiredText(image.lean_toolchain, `runner.approved_images[${index}].lean_toolchain`, 240),
    mathlibRevision: requiredText(image.mathlib_revision, `runner.approved_images[${index}].mathlib_revision`, 160),
  });
}

function normalizeRunnerLimits(value) {
  const limits = object(value, "runner.default_limits");
  rejectExtraKeys(limits, ["cpu_seconds", "wall_seconds", "memory_mib", "disk_mib", "output_bytes"], "runner.default_limits");
  return {
    cpuSeconds: limits.cpu_seconds,
    wallSeconds: limits.wall_seconds,
    memoryMiB: limits.memory_mib,
    diskMiB: limits.disk_mib,
    outputBytes: limits.output_bytes,
  };
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

function requiredQueueName(value, label) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{2,62}$/.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a lowercase Cloudflare Queue name.`);
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

function requiredText(value, label, maximum) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder non-empty value.`);
  }
  return value;
}

function requiredIdentifier(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 240 || /[\0\r\n]/.test(value) || isPlaceholder(value)) {
    throw new Error(`${label} must be a non-placeholder bounded identifier.`);
  }
  return value;
}

function requiredExact(value, expected, label) {
  if (value !== expected) throw new Error(`${label} must be ${expected}.`);
  return value;
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
