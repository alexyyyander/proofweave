import assert from "node:assert/strict";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  assert.throws(
    () => new ContainerLeanExecutor({
      networkIsolated: true,
      resourceLimitsEnforced: true,
      executablePath: "../lake",
    }),
    /normalized absolute path/,
  );
  assert.throws(
    () => new ContainerLeanExecutor({
      networkIsolated: true,
      resourceLimitsEnforced: true,
      dependencyPackagesRoot: "../packages",
    }),
    /dependency packages root/,
  );
});

test("Container Lean executor mounts only the image-owned pinned Lake package closure", async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-lean-dependencies-"));
  const workspaceDirectory = join(root, "workspace");
  const dependencyPackagesRoot = join(root, "image-packages");
  try {
    await mkdir(workspaceDirectory);
    await mkdir(dependencyPackagesRoot);
    await cp(fileURLToPath(new URL("core-success/", fixturesRoot)), workspaceDirectory, { recursive: true });
    const request = fixtureRequest({ id: "pinned-dependencies", mathlibRevision: "fixture-mathlib" });
    const execution = await new ContainerLeanExecutor({
      networkIsolated: true,
      resourceLimitsEnforced: true,
      dependencyPackagesRoot,
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
    });
    assert.equal(execution.result.status, "succeeded");
    assert.equal((await lstat(join(workspaceDirectory, ".lake", "packages"))).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Container Lean executor builds imported workspace modules before checking the selected entry", async () => {
  const workspaceDirectory = await mkdtemp(join(tmpdir(), "proofweave-lean-multi-module-"));
  try {
    await mkdir(join(workspaceDirectory, "MultiModule"));
    await Promise.all([
      cp(fileURLToPath(new URL("core-success/lean-toolchain", fixturesRoot)), join(workspaceDirectory, "lean-toolchain")),
      cp(fileURLToPath(new URL("core-success/lake-manifest.json", fixturesRoot)), join(workspaceDirectory, "lake-manifest.json")),
      writeFile(join(workspaceDirectory, "lakefile.toml"), [
        'name = "multiModuleFixture"',
        'version = "0.1.0"',
        'defaultTargets = ["MultiModule"]',
        "",
        "[[lean_lib]]",
        'name = "MultiModule"',
        "",
      ].join("\n")),
      writeFile(join(workspaceDirectory, "MultiModule", "Dependency.lean"), [
        "namespace MultiModule",
        "theorem dependency : True := True.intro",
        "end MultiModule",
        "",
      ].join("\n")),
      writeFile(join(workspaceDirectory, "MultiModule", "Main.lean"), [
        "import MultiModule.Dependency",
        "namespace MultiModule",
        "theorem assembled : True := dependency",
        "end MultiModule",
        "",
      ].join("\n")),
      writeFile(join(workspaceDirectory, "MultiModule.lean"), [
        "import MultiModule.Main",
        "",
      ].join("\n")),
    ]);
    const request = fixtureRequest({ id: "multi-module" });
    request.bundle.entryCommand = ["lake", "env", "lean", "MultiModule/Main.lean"];
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
        entries: [
          { path: "MultiModule.lean", mode: 0o644, contentHash: sha("b") },
          { path: "MultiModule/Dependency.lean", mode: 0o644, contentHash: sha("c") },
          { path: "MultiModule/Main.lean", mode: 0o644, contentHash: sha("e") },
        ],
        target: { declaration: "MultiModule.assembled", statementHash: sha("d") },
        policy: request.policy,
        entryCommand: request.bundle.entryCommand,
      },
    });

    assert.equal(execution.result.status, "succeeded", execution.stdout.toString("utf8"));
    assert.equal(execution.result.kernelStatus, "accepted");
    assert.deepEqual(execution.result.checks, {
      network: "passed",
      noSorry: "passed",
      allowedAxioms: "passed",
      leanBuild: "passed",
    });
    assert.equal((await lstat(join(workspaceDirectory, ".lake", "build", "lib", "lean", "MultiModule", "Dependency.olean"))).isFile(), true);
  } finally {
    await rm(workspaceDirectory, { recursive: true, force: true });
  }
});

test("Container Lean executor builds dependencies once and audits the exact entry source once", async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-lean-command-count-"));
  const workspaceDirectory = join(root, "workspace");
  const executable = join(root, "lake");
  try {
    await mkdir(workspaceDirectory);
    await writeFile(join(workspaceDirectory, "ProofweaveFixture.lean"), [
      "namespace ProofweaveFixture",
      "theorem true_is_inhabited : True := True.intro",
      "end ProofweaveFixture",
      "",
    ].join("\n"));
    await writeFile(executable, [
      "#!/bin/sh",
      "printf '%s\\n' \"$*\" >> .lake-invocations",
      "if [ \"$1\" = \"env\" ]; then cp \"$3\" .captured-audit; echo \"'ProofweaveFixture.true_is_inhabited' does not depend on any axioms\"; fi",
      "exit 0",
      "",
    ].join("\n"));
    await chmod(executable, 0o755);
    const request = fixtureRequest({ id: "command-count" });
    const execution = await new ContainerLeanExecutor({
      networkIsolated: true,
      resourceLimitsEnforced: true,
      executablePath: executable,
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
    });

    assert.equal(execution.result.status, "succeeded");
    assert.deepEqual(
      (await readFile(join(workspaceDirectory, ".lake-invocations"), "utf8")).trim().split("\n"),
      ["build ProofweaveFixture", "env lean .proofweave-axiom-audit.lean"],
    );
    const auditSource = await readFile(join(workspaceDirectory, ".captured-audit"), "utf8");
    assert.match(auditSource, /theorem true_is_inhabited : True := True\.intro/);
    assert.match(auditSource, /#print axioms ProofweaveFixture\.true_is_inhabited/);
    assert.doesNotMatch(auditSource, /^import ProofweaveFixture$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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

function fixtureRequest({ id, mathlibRevision = "none" }) {
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
      mathlibRevision,
      network: "disabled",
    },
    limits: { cpuSeconds: 10, wallSeconds: 30, memoryMiB: 512, diskMiB: 512, outputBytes: 1_000_000 },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
