import assert from "node:assert/strict";
import { test } from "node:test";
import { createDockerAcceptanceContainer, createLocalAcceptanceRunner } from "../scripts/lib/local-acceptance-runner.mjs";

const base = {
  database: { prepare() {} }, bucket: {}, root: "/tmp/proofweave-acceptance-test",
  imageDigest: `local/proofweave@sha256:${"a".repeat(64)}`,
  leanToolchain: "leanprover/lean4:v4.35.0", mathlibRevision: "none",
};

test("local Runner refuses unspecified fixtures and implicit isolation doubles", async () => {
  await assert.rejects(createLocalAcceptanceRunner(base), /exact approved fixture/);
  await assert.rejects(createLocalAcceptanceRunner({ ...base, approvedBundleHashes: ["wildcard"] }), /exact approved fixture/);
  await assert.rejects(createLocalAcceptanceRunner({ ...base, approvedBundleHashes: [`sha256:${"a".repeat(64)}`] }), /pinned Docker image/);
});

test("local Runner refuses mutable Docker tags and non-core environments", async () => {
  await assert.rejects(createDockerAcceptanceContainer({ dockerImageId: "lean:latest" }), /pinned by immutable/);
  await assert.rejects(createLocalAcceptanceRunner({
    ...base, approvedBundleHashes: [`sha256:${"a".repeat(64)}`], mathlibRevision: "arbitrary",
  }), /Lean Core fixture only/);
});

test("actual isolated Docker runtime verifies network denial and image toolchain", {
  skip: !process.env.PROOFWEAVE_LOCAL_ACCEPTANCE_DOCKER_IMAGE_ID,
}, async () => {
  const container = await createDockerAcceptanceContainer({
    dockerImageId: process.env.PROOFWEAVE_LOCAL_ACCEPTANCE_DOCKER_IMAGE_ID,
    leanToolchain: "leanprover/lean4:v4.35.0", mathlibRevision: "none",
    limits: { cpuSeconds: 30, wallSeconds: 60, memoryMiB: 512, diskMiB: 128, outputBytes: 100_000 },
  });
  try {
    assert.equal(container.isolation.isolationVerified, true);
    assert.equal(container.isolation.productionAcceptance, false);
    assert.equal(container.isolation.probe.networkError, "ENETUNREACH");
    assert.equal(container.isolation.readonlyRootfs, true);
    await assert.rejects(container.fetch("https://example.com/v1/runs/x"), /Unexpected private/);
    const response = await container.fetch("https://proofweave-runner.internal/v1/runs/not-created/workspace/result");
    assert.notEqual(response.status, 200);
  } finally { await container.close(); }
});
