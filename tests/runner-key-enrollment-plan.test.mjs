import assert from "node:assert/strict";
import test from "node:test";
import { runnerKeyFingerprint } from "../packages/protocol/runner-key-registry.mjs";
import { renderRunnerKeyEnrollmentPlan } from "../scripts/render-runner-key-enrollment.mjs";

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
    control_plane_issuer: { id: "control-plane:closed-alpha", public_key: "BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ" },
    runner_result: { id: "runner:closed-alpha", public_key: "CAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAg" },
  },
};

test("Runner key enrollment plan binds the reviewed public key to one D1 record", async () => {
  const plan = await renderRunnerKeyEnrollmentPlan(manifest);
  const fingerprint = await runnerKeyFingerprint(manifest.keys.runner_result.public_key);

  assert.equal(plan.protocolVersion, "pw-runner-key-enrollment-v1");
  assert.deepEqual(plan.runnerKey, {
    id: "runner:closed-alpha",
    publicKey: manifest.keys.runner_result.public_key,
    fingerprint,
  });
  assert.deepEqual(plan.precondition.parameters, ["runner:closed-alpha", manifest.keys.runner_result.public_key, fingerprint]);
  assert.equal(plan.precondition.expectedRows, 0);
  assert.match(plan.enrollment.statement, /^INSERT INTO runner_keys/);
  assert.equal(plan.verification.expectedRows, 1);
  assert.doesNotMatch(JSON.stringify(plan), /private|JWK/i);
});

test("Runner key enrollment plan fails closed for an invalid reviewed public key", async () => {
  await assert.rejects(
    () => renderRunnerKeyEnrollmentPlan({
      ...manifest,
      keys: { ...manifest.keys, runner_result: { ...manifest.keys.runner_result, public_key: "A".repeat(43) } },
    }),
    /keys\.runner_result\.public_key/,
  );
});
