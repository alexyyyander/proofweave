import assert from "node:assert/strict";
import test from "node:test";
import { validateAlphaControlPlaneTopology } from "../scripts/preflight-alpha-control-plane.mjs";

const mcpManifest = {
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
  runner: {
    queue_name: "proofweave-runner-jobs-alpha",
    approved_images: [{
      image_digest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"a".repeat(64)}`,
      lean_toolchain: "leanprover/lean4:v4.30.0",
      mathlib_revision: "fixture-mathlib-revision",
    }],
    control_plane_key_id: "control-plane:closed-alpha",
    default_limits: { cpu_seconds: 60, wall_seconds: 120, memory_mib: 2_048, disk_mib: 2_048, output_bytes: 1_000_000 },
  },
};

const runnerManifest = {
  control_plane: { ...mcpManifest.control_plane },
  queue: {
    name: "proofweave-runner-jobs-alpha",
    dead_letter_queue: "proofweave-runner-jobs-alpha-dlq",
    max_batch_size: 1,
    max_batch_timeout_seconds: 5,
    max_retries: 5,
    max_concurrency: 1,
  },
  runner: {
    worker_name: "proofweave-lean-runner-alpha",
    container_class: "LeanRunnerContainer",
    image: {
      image_digest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"a".repeat(64)}`,
      lean_toolchain: "leanprover/lean4:v4.30.0",
      mathlib_revision: "fixture-mathlib-revision",
    },
    retry_delay_seconds: 30,
  },
  keys: {
    control_plane_issuer: {
      id: "control-plane:closed-alpha",
      public_key: "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ",
    },
    runner_result: {
      id: "runner:closed-alpha",
      public_key: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg",
    },
  },
};

test("alpha deployment preflight requires MCP and Runner to share one D1/R2 authority", () => {
  const topology = validateAlphaControlPlaneTopology({ mcpManifest, runnerManifest });
  assert.deepEqual(topology.controlPlane, {
    databaseName: mcpManifest.control_plane.d1_database_name,
    databaseId: mcpManifest.control_plane.d1_database_id,
    bucketName: mcpManifest.control_plane.r2_bucket_name,
  });
  assert.equal(topology.gateway.resourceUrl, mcpManifest.gateway.resource_url);
  assert.equal(topology.runner.queueName, runnerManifest.queue.name);
  assert.equal(topology.runner.controlPlaneKeyId, runnerManifest.keys.control_plane_issuer.id);
  assert.deepEqual(topology.runner.defaultLimits, { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 });
  assert.equal(topology.runner.executionEnabled, false);
  assert.doesNotMatch(JSON.stringify(topology), new RegExp(runnerManifest.keys.control_plane_issuer.public_key));
});

test("alpha deployment preflight rejects D1 and R2 drift between otherwise valid manifests", () => {
  assert.throws(
    () => validateAlphaControlPlaneTopology({
      mcpManifest,
      runnerManifest: {
        ...runnerManifest,
        control_plane: { ...runnerManifest.control_plane, d1_database_name: "proofweave-other-alpha" },
      },
    }),
    /same D1 database name/,
  );
  assert.throws(
    () => validateAlphaControlPlaneTopology({
      mcpManifest,
      runnerManifest: {
        ...runnerManifest,
        control_plane: { ...runnerManifest.control_plane, d1_database_id: "6b3c0e15-443b-4e4d-b8e5-99c37ad5d2c3" },
      },
    }),
    /same D1 database ID/,
  );
  assert.throws(
    () => validateAlphaControlPlaneTopology({
      mcpManifest,
      runnerManifest: {
        ...runnerManifest,
        control_plane: { ...runnerManifest.control_plane, r2_bucket_name: "proofweave-other-artifacts" },
      },
    }),
    /same R2 bucket name/,
  );
});

test("alpha deployment preflight rejects Queue, image, and signing-key drift", () => {
  assert.throws(
    () => validateAlphaControlPlaneTopology({
      mcpManifest: { ...mcpManifest, runner: { ...mcpManifest.runner, queue_name: "proofweave-other-queue" } },
      runnerManifest,
    }),
    /same Runner Queue name/,
  );
  assert.throws(
    () => validateAlphaControlPlaneTopology({
      mcpManifest: { ...mcpManifest, runner: { ...mcpManifest.runner, control_plane_key_id: "control-plane:other" } },
      runnerManifest,
    }),
    /same Runner control-plane key ID/,
  );
  assert.throws(
    () => validateAlphaControlPlaneTopology({
      mcpManifest: {
        ...mcpManifest,
        runner: {
          ...mcpManifest.runner,
          approved_images: [{ ...mcpManifest.runner.approved_images[0], mathlib_revision: "other-mathlib" }],
        },
      },
      runnerManifest,
    }),
    /same single approved Runner image/,
  );
});
