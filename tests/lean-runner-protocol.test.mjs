import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalLeanRunnerRequest,
  leanRunnerRequestHash,
  normalizeLeanRunnerRequest,
  normalizeLeanRunnerResult,
} from "../packages/protocol/lean-runner.mjs";

test("normalizes a deterministic network-isolated Lean runner request", async () => {
  const request = fixtureRequest();
  assert.equal(normalizeLeanRunnerRequest(request).environment.network, "disabled");
  assert.equal(canonicalLeanRunnerRequest(request), canonicalLeanRunnerRequest({ ...request }));
  assert.match(await leanRunnerRequestHash(request), /^sha256:[a-f0-9]{64}$/);
});

test("rejects runner requests that could widen execution authority", () => {
  assert.throws(
    () => normalizeLeanRunnerRequest({ ...fixtureRequest(), environment: { ...fixtureRequest().environment, network: "enabled" } }),
    /network must be disabled/,
  );
  assert.throws(
    () => normalizeLeanRunnerRequest({ ...fixtureRequest(), bundle: { ...fixtureRequest().bundle, entryCommand: ["sh", "-c", "lake env lean Main.lean"] } }),
    /must begin with lake env lean/,
  );
  assert.throws(
    () => normalizeLeanRunnerRequest({ ...fixtureRequest(), bundle: { ...fixtureRequest().bundle, objectKey: "bundles/sha256/../escape" } }),
    /safe content-addressed R2 key/,
  );
});

test("requires complete evidence before a runner can report success", () => {
  const result = fixtureResult();
  assert.equal(normalizeLeanRunnerResult(result).kernelStatus, "accepted");
  assert.throws(
    () => normalizeLeanRunnerResult({ ...result, checks: { ...result.checks, noSorry: "failed" } }),
    /succeeded runner result requires clean accepted checks/,
  );
  assert.throws(
    () => normalizeLeanRunnerResult({ ...result, checks: { ...result.checks, network: "not_run" } }),
    /succeeded runner result requires clean accepted checks/,
  );
});

function fixtureRequest() {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:fixture-1",
    idempotencyKey: "runner-fixture-1",
    attemptId: "attempt:fixture-1",
    bundle: {
      objectKey: "bundles/sha256/a1/fixture.tar.zst",
      contentHash: `sha256:${"a".repeat(64)}`,
      manifestHash: `sha256:${"b".repeat(64)}`,
      entryCommand: ["lake", "env", "lean", "Proofweave/Fixture.lean"],
    },
    environment: {
      imageDigest: `ghcr.io/proofweave/lean-runner@sha256:${"c".repeat(64)}`,
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "a3a10db0e9d6",
      network: "disabled",
    },
    limits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}

function fixtureResult() {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:fixture-1",
    attemptId: "attempt:fixture-1",
    requestHash: `sha256:${"d".repeat(64)}`,
    status: "succeeded",
    exitCode: 0,
    startedAt: "2026-07-13T00:00:00Z",
    finishedAt: "2026-07-13T00:00:05Z",
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: {
      manifestHash: `sha256:${"e".repeat(64)}`,
      stdoutHash: `sha256:${"f".repeat(64)}`,
      stderrHash: `sha256:${"0".repeat(64)}`,
    },
  };
}
