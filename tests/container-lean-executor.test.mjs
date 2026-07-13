import assert from "node:assert/strict";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { leanRunnerRequestHash } from "../packages/protocol/lean-runner.mjs";
import { fileURLToPath } from "node:url";
import {
  ContainerLeanExecutor,
} from "../services/lean-runner/container-lean-executor.mjs";

const fixturesRoot = new URL("./fixtures/lean/", import.meta.url);

test("Container Lean executor derives bounded unsigned evidence from real Lean fixtures", async (t) => {
  const cases = [
    {
      id: "core-success",
      declaration: "ProofweaveFixture.true_is_inhabited",
      expected: { status: "succeeded", kernelStatus: "accepted", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    },
    {
      id: "core-sorry",
      declaration: "ProofweaveFixture.unfinished",
      expected: { status: "rejected", kernelStatus: "rejected", noSorry: "failed", allowedAxioms: "failed", leanBuild: "passed" },
    },
    {
      id: "core-compiler-error",
      declaration: "ProofweaveFixture.broken",
      expected: { status: "failed", kernelStatus: "not_run", noSorry: "passed", allowedAxioms: "not_run", leanBuild: "failed" },
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.id, async () => {
      const workspaceDirectory = await mkdtemp(join(tmpdir(), "proofweave-lean-executor-"));
      try {
        await cp(fileURLToPath(new URL(`${fixture.id}/`, fixturesRoot)), workspaceDirectory, { recursive: true });
        const request = fixtureRequest({ id: fixture.id });
        const executor = new ContainerLeanExecutor({
          networkIsolated: true,
          resourceLimitsEnforced: true,
        });
        const execution = await executor.execute({
          request,
          workspace: {
            jobId: request.jobId,
            requestHash: await leanRunnerRequestHash(request),
            workspaceDirectory,
            treeHash: sha("f"),
            entries: [{ path: "ProofweaveFixture.lean", mode: 0o644, contentHash: sha("e") }],
            target: { declaration: fixture.declaration, statementHash: sha("d") },
            policy: request.policy,
            entryCommand: request.bundle.entryCommand,
          },
        });

        assert.equal(
          execution.result.status,
          fixture.expected.status,
          `${fixture.id}: ${JSON.stringify(execution.result.checks)}\nstdout:\n${execution.stdout}\nstderr:\n${execution.stderr}`,
        );
        assert.equal(execution.result.kernelStatus, fixture.expected.kernelStatus);
        assert.deepEqual(execution.result.checks, {
          network: "passed",
          noSorry: fixture.expected.noSorry,
          allowedAxioms: fixture.expected.allowedAxioms,
          leanBuild: fixture.expected.leanBuild,
        });
        assert.match(execution.result.requestHash, /^sha256:[a-f0-9]{64}$/);
        assert.match(execution.result.artifacts.stdoutHash, /^sha256:[a-f0-9]{64}$/);
        assert.match(execution.result.artifacts.stderrHash, /^sha256:[a-f0-9]{64}$/);
        assert.equal(Object.hasOwn(execution.result, "runnerSignature"), false);
        assert.equal(execution.outputTruncated, false);
      } finally {
        await rm(workspaceDirectory, { recursive: true, force: true });
      }
    });
  }
});

test("Container Lean executor refuses to run without deployment-enforced isolation", () => {
  assert.throws(
    () => new ContainerLeanExecutor({ networkIsolated: false, resourceLimitsEnforced: true }),
    TypeError,
  );
  assert.throws(
    () => new ContainerLeanExecutor({ networkIsolated: true, resourceLimitsEnforced: false }),
    TypeError,
  );
});

test("Container Lean executor returns normal unsigned cancellation evidence for an aborted private request", async () => {
  const workspaceDirectory = await mkdtemp(join(tmpdir(), "proofweave-lean-cancel-"));
  try {
    await cp(fileURLToPath(new URL("core-success/", fixturesRoot)), workspaceDirectory, { recursive: true });
    const request = fixtureRequest({ id: "core-cancelled" });
    const controller = new AbortController();
    controller.abort();
    const execution = await new ContainerLeanExecutor({
      networkIsolated: true,
      resourceLimitsEnforced: true,
    }).execute({
      request,
      workspace: {
        jobId: request.jobId,
        requestHash: await leanRunnerRequestHash(request),
        workspaceDirectory,
        treeHash: sha("f"),
        entries: [{ path: "ProofweaveFixture.lean", mode: 0o644, contentHash: sha("e") }],
        target: { declaration: "ProofweaveFixture.true_is_inhabited", statementHash: sha("d") },
        policy: request.policy,
        entryCommand: request.bundle.entryCommand,
      },
      signal: controller.signal,
    });

    assert.equal(execution.result.status, "cancelled");
    assert.equal(execution.result.exitCode, 137);
    assert.equal(execution.result.kernelStatus, "not_run");
    assert.deepEqual(execution.result.checks, {
      network: "passed",
      noSorry: "passed",
      allowedAxioms: "not_run",
      leanBuild: "not_run",
    });
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true });
  }
});

function fixtureRequest({ id }) {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: `run:${id}`,
    idempotencyKey: `fixture-${id}`,
    attemptId: `attempt:${id}`,
    bundle: {
      objectKey: `bundles/sha256/${"a".repeat(64)}/bundle.json`,
      contentHash: sha("a"),
      manifestHash: sha("a"),
      entryCommand: ["lake", "env", "lean", "ProofweaveFixture.lean"],
    },
    environment: {
      imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
      leanToolchain: "leanprover/lean4:v4.30.0",
      mathlibRevision: "fixture-mathlib",
      network: "disabled",
    },
    limits: { cpuSeconds: 10, wallSeconds: 30, memoryMiB: 512, diskMiB: 512, outputBytes: 1_000_000 },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
