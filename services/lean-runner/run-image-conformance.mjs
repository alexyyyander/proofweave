import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import {
  leanRunnerRequestHash,
  normalizeLeanRunnerRequest,
} from "../../packages/protocol/lean-runner.mjs";
import {
  conformanceFixtureSetHash,
  conformanceFixtures,
} from "./conformance-fixtures.mjs";
import { ContainerLeanExecutor } from "./container-lean-executor.mjs";

export const conformanceReportSchemaVersion = "pw-runner-conformance-report-v1";
const imageDigestPattern = /^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/;
const zeroDigest = `sha256:${"0".repeat(64)}`;

export class RunnerConformanceError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerConformanceError";
  }
}

/**
 * Compare one fixture's expected audit outcome with the real Container
 * executor result. A missing or extra check is a failure, not a pass.
 */
export function compareConformanceCase(fixture, result) {
  const observed = Object.freeze({
    status: result.status,
    kernelStatus: result.kernelStatus,
    checks: Object.freeze({ ...result.checks }),
  });
  const expected = fixture.expected;
  const passed = observed.status === expected.status
    && observed.kernelStatus === expected.kernelStatus
    && Object.keys(expected.checks).every((key) => observed.checks[key] === expected.checks[key]);
  return Object.freeze({ expected, observed, passed });
}

export async function buildConformanceReport({
  fixtureSetHash,
  imageDigest,
  leanToolchain,
  mathlibRevision,
  generatedAt,
  cases,
}) {
  const base = {
    schemaVersion: conformanceReportSchemaVersion,
    fixtureSetHash,
    imageDigest,
    leanToolchain,
    mathlibRevision,
    generatedAt,
    cases: Object.freeze(cases),
    passed: cases.every((entry) => entry.skipped || entry.passed),
  };
  return Object.freeze({ ...base, reportHash: await sha256Canonical(base) });
}

export async function runConformanceFixtures({
  imageDigest,
  leanToolchain,
  mathlibRevision,
  dependencyPackagesRoot = null,
  fixtures = conformanceFixtures,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (typeof imageDigest !== "string" || !imageDigestPattern.test(imageDigest)) {
    throw new RunnerConformanceError("Conformance requires the immutable image reference that is being tested.");
  }
  if (typeof leanToolchain !== "string" || leanToolchain.trim() === "") {
    throw new RunnerConformanceError("Conformance requires the expected Lean toolchain.");
  }
  if (typeof mathlibRevision !== "string" || mathlibRevision.trim() === "") {
    throw new RunnerConformanceError("Conformance requires the expected Mathlib revision or the none sentinel.");
  }
  if (mathlibRevision !== "none" && (typeof dependencyPackagesRoot !== "string" || !dependencyPackagesRoot.startsWith("/"))) {
    throw new RunnerConformanceError("Mathlib conformance requires the image-owned Lake package root.");
  }
  const fixtureSetHash = await conformanceFixtureSetHash();
  const cases = [];
  for (const fixture of fixtures) {
    if (fixture.kind === "mathlib" && mathlibRevision === "none") {
      cases.push(Object.freeze({
        id: fixture.id,
        kind: fixture.kind,
        skipped: true,
        reason: "mathlib_not_available",
        expected: fixture.expected,
        observed: null,
        passed: false,
      }));
      continue;
    }
    if (Array.isArray(fixture.appliesToToolchains) && !fixture.appliesToToolchains.includes(leanToolchain)) {
      cases.push(Object.freeze({
        id: fixture.id,
        kind: fixture.kind,
        skipped: true,
        reason: "toolchain_not_applicable",
        expected: fixture.expected,
        observed: null,
        passed: false,
      }));
      continue;
    }
    cases.push(await runConformanceCase({
      fixture,
      imageDigest,
      leanToolchain,
      mathlibRevision,
      dependencyPackagesRoot,
    }));
  }
  return buildConformanceReport({
    fixtureSetHash,
    imageDigest,
    leanToolchain,
    mathlibRevision,
    generatedAt,
    cases,
  });
}

async function runConformanceCase({
  fixture,
  imageDigest,
  leanToolchain,
  mathlibRevision,
  dependencyPackagesRoot,
}) {
  const directory = await mkdtemp(join(tmpdir(), "proofweave-conformance-"));
  try {
    const files = { ...fixture.files };
    if (fixture.kind === "mathlib") {
      files["lakefile.lean"] = mathlibLakefile(mathlibRevision);
      files["lake-manifest.json"] = await mathlibManifest(dependencyPackagesRoot, mathlibRevision);
    }
    files["lean-toolchain"] = `${leanToolchain}\n`;
    const entries = [];
    for (const [path, content] of Object.entries(files)) {
      const absolute = join(directory, ...path.split("/"));
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content, { encoding: "utf8", mode: 0o644 });
      entries.push(Object.freeze({
        path,
        mode: 0o644,
        contentHash: sha256Text(content),
      }));
    }
    const request = normalizeLeanRunnerRequest({
      protocolVersion: "pw-lean-runner-v1",
      jobId: `conformance:${fixture.id}`,
      idempotencyKey: `conformance:${fixture.id}`,
      attemptId: `conformance:${fixture.id}`,
      bundle: {
        objectKey: `bundles/sha256/${"0".repeat(64)}/bundle.json`,
        contentHash: zeroDigest,
        manifestHash: zeroDigest,
        entryCommand: fixture.entryCommand,
      },
      environment: {
        imageDigest,
        leanToolchain,
        mathlibRevision,
        network: "disabled",
      },
      limits: {
        cpuSeconds: 60,
        wallSeconds: 120,
        memoryMiB: 2_048,
        diskMiB: 2_048,
        outputBytes: 1_000_000,
      },
      policy: { requireNoSorry: true, allowedAxioms: fixture.allowedAxioms },
    });
    const requestHash = await leanRunnerRequestHash(request);
    const executor = new ContainerLeanExecutor({
      networkIsolated: true,
      resourceLimitsEnforced: true,
      dependencyPackagesRoot: fixture.kind === "mathlib" ? dependencyPackagesRoot : null,
    });
    const execution = await executor.execute({
      request,
      workspace: {
        jobId: request.jobId,
        requestHash,
        workspaceDirectory: directory,
        treeHash: await sha256Canonical(entries),
        entries: Object.freeze(entries),
        target: Object.freeze({
          declaration: fixture.target,
          statementHash: zeroDigest,
        }),
        policy: request.policy,
        entryCommand: request.bundle.entryCommand,
      },
    });
    const comparison = compareConformanceCase(fixture, execution.result);
    return Object.freeze({
      id: fixture.id,
      kind: fixture.kind,
      skipped: false,
      reason: null,
      ...comparison,
    });
  } catch (error) {
    return Object.freeze({
      id: fixture.id,
      kind: fixture.kind,
      skipped: false,
      reason: null,
      expected: fixture.expected,
      observed: null,
      passed: false,
      errorCode: typeof error?.diagnosticCode === "string"
        ? error.diagnosticCode
        : typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(error.name)
          ? error.name
          : "RunnerConformanceError",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function mathlibLakefile(mathlibRevision) {
  return [
    "import Lake",
    "open Lake DSL",
    "package proofweaveConformance",
    `require mathlib from git "https://github.com/leanprover-community/mathlib4.git" @ "${mathlibRevision}"`,
    "@[default_target] lean_lib ProofweaveConformance",
    "",
  ].join("\n");
}

async function mathlibManifest(packagesRoot, mathlibRevision) {
  const source = join(packagesRoot, "mathlib", "lake-manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(source, "utf8"));
  } catch (cause) {
    throw new RunnerConformanceError("The image Mathlib Lake manifest is unavailable.", { cause });
  }
  const mathlib = {
    url: "https://github.com/leanprover-community/mathlib4.git",
    type: "git",
    subDir: null,
    scope: "",
    rev: mathlibRevision,
    name: "mathlib",
    manifestFile: "lake-manifest.json",
    inputRev: mathlibRevision,
    inherited: false,
    configFile: "lakefile.lean",
  };
  return `${JSON.stringify({
    ...manifest,
    name: "proofweaveConformance",
    packages: [mathlib, ...(Array.isArray(manifest.packages) ? manifest.packages : [])],
  }, null, 2)}\n`;
}

function sha256Text(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function main() {
  const imageDigest = process.env.PROOFWEAVE_IMAGE_DIGEST;
  const leanToolchain = process.env.EXPECTED_LEAN_TOOLCHAIN;
  const mathlibRevision = process.env.EXPECTED_MATHLIB_REVISION;
  const dependencyPackagesRoot = mathlibRevision === "none"
    ? null
    : process.env.PROOFWEAVE_LAKE_PACKAGES_ROOT ?? "/opt/proofweave/lake-packages";
  const report = await runConformanceFixtures({
    imageDigest,
    leanToolchain,
    mathlibRevision,
    dependencyPackagesRoot,
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  process.stdout.write(serialized);
  if (process.env.PROOFWEAVE_CONFORMANCE_OUTPUT) {
    await writeFile(process.env.PROOFWEAVE_CONFORMANCE_OUTPUT, serialized, { encoding: "utf8", mode: 0o600 });
  }
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
