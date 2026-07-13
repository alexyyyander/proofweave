import assert from "node:assert/strict";
import test from "node:test";
import {
  renderGatewayWranglerConfig,
  validateMcpControlPlaneManifest,
} from "../scripts/preflight-mcp-control-plane.mjs";
import { createCloudflareGatewayWorker } from "../services/proofweave-mcp-gateway/cloudflare-worker.mjs";

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

test("MCP control-plane preflight can render the complete non-secret Runner producer binding", () => {
  const runner = {
    queue_name: "proofweave-runner-jobs-alpha",
    approved_images: [{
      image_digest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"a".repeat(64)}`,
      lean_toolchain: "leanprover/lean4:v4.30.0",
      mathlib_revision: "fixture-mathlib-revision",
    }],
    control_plane_key_id: "control-plane:closed-alpha",
    default_limits: {
      cpu_seconds: 60,
      wall_seconds: 120,
      memory_mib: 2_048,
      disk_mib: 2_048,
      output_bytes: 1_000_000,
    },
  };
  const normalized = validateMcpControlPlaneManifest({ ...manifest, runner });
  assert.deepEqual(normalized.runner, {
    queueName: runner.queue_name,
    approvedImages: [{
      imageDigest: runner.approved_images[0].image_digest,
      leanToolchain: runner.approved_images[0].lean_toolchain,
      mathlibRevision: runner.approved_images[0].mathlib_revision,
    }],
    controlPlaneKeyId: runner.control_plane_key_id,
    defaultLimits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
  });
  const generated = JSON.parse(renderGatewayWranglerConfig({ ...manifest, runner }));
  assert.deepEqual(generated.queues.producers, [{ binding: "RUNNER_QUEUE", queue: runner.queue_name }]);
  assert.equal(generated.vars.RUNNER_CONTROL_PLANE_KEY_ID, runner.control_plane_key_id);
  assert.deepEqual(JSON.parse(generated.vars.RUNNER_APPROVED_IMAGES_JSON), normalized.runner.approvedImages);
  assert.deepEqual(JSON.parse(generated.vars.RUNNER_DEFAULT_LIMITS_JSON), normalized.runner.defaultLimits);
  assert.doesNotMatch(JSON.stringify(generated), /RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK/);
});

test("MCP control-plane preflight rejects incomplete or unsafe Runner producer metadata", () => {
  assert.throws(
    () => validateMcpControlPlaneManifest({
      ...manifest,
      runner: { queue_name: "proofweave-runner-jobs-alpha" },
    }),
    /approved_images/,
  );
  assert.throws(
    () => validateMcpControlPlaneManifest({
      ...manifest,
      runner: {
        queue_name: "proofweave-runner-jobs-alpha",
        approved_images: [{
          image_digest: "registry.cloudflare.com/proofweave/lean-runner:latest",
          lean_toolchain: "leanprover/lean4:v4.30.0",
          mathlib_revision: "fixture-mathlib-revision",
        }],
        control_plane_key_id: "control-plane:closed-alpha",
        default_limits: { cpu_seconds: 60, wall_seconds: 30, memory_mib: 2_048, disk_mib: 2_048, output_bytes: 1_000_000 },
      },
    }),
    /sha256 digest|resource limits/,
  );
});

test("MCP gateway runs every request through its structured audit boundary", async () => {
  const calls = [];
  const worker = createCloudflareGatewayWorker({
    audit: {
      async handle(request, handler) {
        calls.push(request);
        return handler({ requestId: "pw-test-request" });
      },
    },
  });

  const response = await worker.fetch(new Request("https://mcp.example.test/mcp"), {});
  assert.equal(response.status, 503);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://mcp.example.test/mcp");
});
