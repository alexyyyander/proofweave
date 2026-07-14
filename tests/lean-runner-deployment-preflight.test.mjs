import assert from "node:assert/strict";
import test from "node:test";
import {
  renderLeanRunnerWranglerConfig,
  validateLeanRunnerDeploymentManifest,
} from "../scripts/preflight-lean-runner-deployment.mjs";

const manifest = {
  control_plane: {
    d1_database_name: "proofweave-control-alpha",
    d1_database_id: "ce75f2fb-40a9-4d14-9393-6cdb6a6f6069",
    artifact_storage: "d1_inline",
  },
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

test("Runner deployment preflight normalizes one pinned non-secret topology", () => {
  const normalized = validateLeanRunnerDeploymentManifest(manifest);
  assert.equal(normalized.controlPlane.databaseId, manifest.control_plane.d1_database_id);
  assert.equal(normalized.queue.maxConcurrency, 1);
  assert.equal(normalized.runner.image.imageDigest, manifest.runner.image.image_digest);
  assert.equal(normalized.keys.controlPlaneIssuer.id, manifest.keys.control_plane_issuer.id);

  const config = JSON.parse(renderLeanRunnerWranglerConfig(manifest));
  assert.equal(config.name, manifest.runner.worker_name);
  assert.equal(config.queues.consumers[0].queue, manifest.queue.name);
  assert.equal(config.queues.consumers[0].dead_letter_queue, manifest.queue.dead_letter_queue);
  assert.equal(config.vars.RUNNER_EXECUTION_ENABLED, "false");
  assert.equal(config.vars.RUNNER_RETRY_DELAY_SECONDS, "30");
  assert.deepEqual(JSON.parse(config.vars.RUNNER_APPROVED_IMAGES_JSON), [{
    imageDigest: manifest.runner.image.image_digest,
    leanToolchain: manifest.runner.image.lean_toolchain,
    mathlibRevision: manifest.runner.image.mathlib_revision,
  }]);
  assert.deepEqual(JSON.parse(config.vars.RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON), [{
    id: manifest.keys.control_plane_issuer.id,
    publicKey: manifest.keys.control_plane_issuer.public_key,
  }]);
  assert.equal(config.containers[0].max_instances, 1);
  assert.equal(config.containers[0].instance_type, "standard-1");
  assert.equal(config.r2_buckets, undefined);
  assert.doesNotMatch(JSON.stringify(config), /RUNNER_RESULT_PRIVATE_KEY_JWK/);
});

test("Runner deployment preflight rejects unsafe topology and placeholder values", () => {
  assert.throws(
    () => validateLeanRunnerDeploymentManifest({
      ...manifest,
      queue: { ...manifest.queue, dead_letter_queue: manifest.queue.name },
    }),
    /must be different resources/,
  );
  assert.throws(
    () => validateLeanRunnerDeploymentManifest({
      ...manifest,
      runner: {
        ...manifest.runner,
        image: { ...manifest.runner.image, image_digest: "registry.cloudflare.com/proofweave/lean-runner:latest" },
      },
    }),
    /immutable image reference|sha256 digest/,
  );
  assert.throws(
    () => validateLeanRunnerDeploymentManifest({
      ...manifest,
      control_plane: { ...manifest.control_plane, d1_database_id: "REPLACE_WITH_D1_DATABASE_UUID" },
    }),
    /database UUID/,
  );
  assert.throws(
    () => validateLeanRunnerDeploymentManifest({
      ...manifest,
      queue: { ...manifest.queue, max_concurrency: 2 },
    }),
    /between 1 and 1/,
  );
  assert.throws(
    () => validateLeanRunnerDeploymentManifest({
      ...manifest,
      keys: {
        ...manifest.keys,
        control_plane_issuer: { ...manifest.keys.control_plane_issuer, public_key: "A".repeat(43) },
      },
    }),
    /public key/,
  );
});
