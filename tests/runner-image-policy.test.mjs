import assert from "node:assert/strict";
import test from "node:test";
import {
  PinnedRunnerImageRegistry,
  RunnerImagePolicyError,
} from "../services/lean-runner/runner-image-policy.mjs";

test("an approved pinned image is bound to its exact Lean and Mathlib environment", () => {
  const registry = new PinnedRunnerImageRegistry({ images: [approvedImage()] });
  const resolved = registry.resolve(fixtureRequest());
  assert.deepEqual(resolved, approvedImage());
});

test("a syntactically pinned image is rejected unless it is approved with matching environment", () => {
  const registry = new PinnedRunnerImageRegistry({ images: [approvedImage()] });
  assert.throws(
    () => registry.resolve({
      ...fixtureRequest(),
      environment: {
        ...fixtureRequest().environment,
        imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
      },
    }),
    /operator-approved allowlist/,
  );
  assert.throws(
    () => registry.resolve({
      ...fixtureRequest(),
      environment: { ...fixtureRequest().environment, mathlibRevision: "substituted-mathlib" },
    }),
    /does not match the approved image digest/,
  );
  assert.throws(
    () => new PinnedRunnerImageRegistry({ images: [{ ...approvedImage(), unknown: true }] }),
    RunnerImagePolicyError,
  );
});

function approvedImage() {
  return {
    imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"a".repeat(64)}`,
    leanToolchain: "leanprover/lean4:v4.30.0",
    mathlibRevision: "fixture-mathlib",
  };
}

function fixtureRequest() {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:image-policy",
    idempotencyKey: "image-policy-idempotency",
    attemptId: "attempt:image-policy",
    bundle: {
      objectKey: `bundles/sha256/${"c".repeat(64)}/bundle.json`,
      contentHash: `sha256:${"c".repeat(64)}`,
      manifestHash: `sha256:${"c".repeat(64)}`,
      entryCommand: ["lake", "env", "lean", "Proofweave/ImagePolicy.lean"],
    },
    environment: {
      imageDigest: approvedImage().imageDigest,
      leanToolchain: approvedImage().leanToolchain,
      mathlibRevision: approvedImage().mathlibRevision,
      network: "disabled",
    },
    limits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}
