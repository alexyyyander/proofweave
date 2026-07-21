import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  leanRunnerRequestHash,
  normalizeLeanRunnerRequest,
} from "../../packages/protocol/lean-runner.mjs";

const terminationExitCode = 137;
const axiomAuditFile = ".proofweave-axiom-audit.lean";

export class ContainerLeanExecutorError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "ContainerLeanExecutorError";
    if (options.diagnosticCode !== undefined) {
      this.diagnosticCode = requireExecutorDiagnosticCode(options.diagnosticCode);
    }
  }
}

/**
 * Source-only Lean process boundary intended for the private Container image.
 *
 * It accepts only a reconstructed ContainerWorkspaceRuntime result and a
 * matching normalized request. The outer image/Container policy must already
 * enforce network and cgroup limits; this class refuses to run unless those
 * deployment facts are asserted explicitly. It never receives a runner signing
 * key and returns unsigned infrastructure evidence plus bounded stdout/stderr
 * bytes for the trusted Runner Worker to persist and sign.
 */
export class ContainerLeanExecutor {
  constructor({ networkIsolated, resourceLimitsEnforced, executable = "lake", executablePath = executable, dependencyPackagesRoot = null, now = () => new Date() }) {
    if (networkIsolated !== true) {
      throw new TypeError("ContainerLeanExecutor requires an explicitly network-isolated Container.");
    }
    if (resourceLimitsEnforced !== true) {
      throw new TypeError("ContainerLeanExecutor requires externally enforced CPU, memory, disk, and process limits.");
    }
    if (typeof executable !== "string" || executable.length === 0 || executable.length > 240 || /[\0\r\n]/.test(executable)) {
      throw new TypeError("Container Lean executable must be a bounded executable name.");
    }
    if (typeof executablePath !== "string" || !isReviewedExecutablePath(executablePath)) {
      throw new TypeError("Container Lean executable path must be lake or a normalized absolute path ending in lake.");
    }
    if (dependencyPackagesRoot !== null && !isNormalizedAbsolutePath(dependencyPackagesRoot)) {
      throw new TypeError("Container dependency packages root must be a normalized absolute path.");
    }
    if (typeof now !== "function") throw new TypeError("ContainerLeanExecutor now must be a function.");
    this.executable = executable;
    this.executablePath = executablePath;
    this.dependencyPackagesRoot = dependencyPackagesRoot;
    this.now = now;
  }

  async execute({ request, workspace, signal }) {
    const normalizedRequest = normalizeLeanRunnerRequest(request);
    const requestHash = await leanRunnerRequestHash(normalizedRequest);
    await diagnoseExecutorStage("lean_request_binding_failed", async () => {
      assertWorkspaceMatchesRequest(workspace, normalizedRequest, requestHash, this.executable);
    });
    await diagnoseExecutorStage("lean_dependency_environment_failed", () => mountPinnedLakePackages({
      workspace,
      request: normalizedRequest,
      dependencyPackagesRoot: this.dependencyPackagesRoot,
    }));
    const startedAt = isoInstant(this.now(), "Container Lean execution start time");
    const deadline = Date.now() + normalizedRequest.limits.wallSeconds * 1_000;
    const collector = new BoundedOutputCollector(normalizedRequest.limits.outputBytes);
    const noSorry = await diagnoseExecutorStage(
      "lean_no_sorry_audit_failed",
      () => auditNoSorry(workspace),
    );

    const build = await diagnoseExecutorStage("lean_build_execution_failed", () => runCommand({
      command: this.executablePath,
      args: normalizedRequest.bundle.entryCommand.slice(1),
      cwd: workspace.workspaceDirectory,
      collector,
      deadline,
      signal,
    }));

    let status;
    let kernelStatus;
    let allowedAxioms = "not_run";
    let leanBuild = build.code === 0 && !build.reason ? "passed" : "failed";
    if (build.reason === "cancelled") {
      status = "cancelled";
      kernelStatus = "not_run";
      leanBuild = "not_run";
    } else if (build.reason === "timed_out") {
      status = "timed_out";
      kernelStatus = "not_run";
      leanBuild = "not_run";
    } else if (build.reason === "output_limited") {
      status = "failed";
      kernelStatus = "not_run";
      leanBuild = "failed";
    } else if (build.code !== 0) {
      status = "failed";
      kernelStatus = "not_run";
    } else {
      const axiomAudit = await diagnoseExecutorStage("lean_axiom_audit_execution_failed", () => auditAllowedAxioms({
        workspace,
        request: normalizedRequest,
        command: this.executablePath,
        collector,
        deadline,
        signal,
      }));
      allowedAxioms = axiomAudit.check;
      if (axiomAudit.reason === "cancelled") {
        status = "cancelled";
        kernelStatus = "not_run";
        leanBuild = "not_run";
      } else if (axiomAudit.reason === "timed_out") {
        status = "timed_out";
        kernelStatus = "not_run";
        leanBuild = "not_run";
      } else if (axiomAudit.reason === "output_limited") {
        status = "failed";
        kernelStatus = "not_run";
        leanBuild = "failed";
      } else if (axiomAudit.check === "failed") {
        status = "rejected";
        kernelStatus = "rejected";
      } else if (noSorry === "failed") {
        status = "rejected";
        kernelStatus = "rejected";
      } else {
        status = "succeeded";
        kernelStatus = "accepted";
      }
    }

    const finishedAt = isoInstant(this.now(), "Container Lean execution finish time");
    const stdout = collector.stdout();
    const stderr = collector.stderr();
    const result = Object.freeze({
      protocolVersion: "pw-lean-runner-v1",
      jobId: normalizedRequest.jobId,
      attemptId: normalizedRequest.attemptId,
      requestHash,
      status,
      exitCode: normalizedExitCode(build, status),
      startedAt,
      finishedAt,
      kernelStatus,
      checks: Object.freeze({
        network: "passed",
        noSorry,
        allowedAxioms,
        leanBuild,
      }),
      artifacts: Object.freeze({
        manifestHash: normalizedRequest.bundle.manifestHash,
        stdoutHash: hashBytes(stdout),
        stderrHash: hashBytes(stderr),
      }),
    });
    return Object.freeze({
      result,
      stdout,
      stderr,
      outputTruncated: collector.truncated,
      workspaceTreeHash: workspace.treeHash,
    });
  }
}

async function mountPinnedLakePackages({ workspace, request, dependencyPackagesRoot }) {
  if (request.environment.mathlibRevision === "none") {
    if (dependencyPackagesRoot !== null) {
      throw new ContainerLeanExecutorError("Lean Core execution cannot mount a Mathlib dependency closure.", { diagnosticCode: "lean_environment_mismatch" });
    }
    return;
  }
  if (dependencyPackagesRoot === null) {
    throw new ContainerLeanExecutorError("Pinned Mathlib execution requires the image-owned Lake package closure.", { diagnosticCode: "lean_environment_missing" });
  }
  const dependencyRoot = await lstat(dependencyPackagesRoot).catch((cause) => {
    throw new ContainerLeanExecutorError("Pinned Lake package closure is missing from the Runner image.", { cause, diagnosticCode: "lean_environment_missing" });
  });
  if (!dependencyRoot.isDirectory() || dependencyRoot.isSymbolicLink()) {
    throw new ContainerLeanExecutorError("Pinned Lake package closure must be an image-owned directory.", { diagnosticCode: "lean_environment_mismatch" });
  }
  const lakeDirectory = join(workspace.workspaceDirectory, ".lake");
  const existingLakeDirectory = await lstat(lakeDirectory).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (existingLakeDirectory !== null) {
    throw new ContainerLeanExecutorError("Submitted workspace cannot provide its own .lake directory.", { diagnosticCode: "lean_workspace_unsafe" });
  }
  await mkdir(lakeDirectory, { mode: 0o700 });
  await symlink(dependencyPackagesRoot, join(lakeDirectory, "packages"), "dir");
}

async function auditAllowedAxioms({ workspace, request, command, collector, deadline, signal }) {
  const auditPath = join(workspace.workspaceDirectory, axiomAuditFile);
  const entrySource = await readFile(join(workspace.workspaceDirectory, ...workspace.entryCommand[3].split("/")), "utf8");
  const source = `${entrySource}\n#print axioms ${workspace.target.declaration}\n`;
  await writeFile(auditPath, source, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    const execution = await runCommand({
      command,
      args: ["env", "lean", axiomAuditFile],
      cwd: workspace.workspaceDirectory,
      collector,
      deadline,
      signal,
    });
    if (execution.reason) return { check: "failed", reason: execution.reason };
    if (execution.code !== 0) return { check: "failed", reason: null };
    const axioms = parseAxiomOutput(Buffer.concat([execution.stdout, execution.stderr]).toString("utf8"));
    if (!axioms) return { check: "failed", reason: null };
    const allowed = new Set(request.policy.allowedAxioms);
    return { check: axioms.every((axiom) => allowed.has(axiom)) ? "passed" : "failed", reason: null };
  } finally {
    await rm(auditPath, { force: true });
  }
}

async function auditNoSorry(workspace) {
  for (const entry of workspace.entries) {
    if (!entry.path.endsWith(".lean")) continue;
    const source = await readFile(join(workspace.workspaceDirectory, ...entry.path.split("/")), "utf8");
    if (containsLeanSorry(source)) return "failed";
  }
  return "passed";
}

function containsLeanSorry(source) {
  let index = 0;
  let blockDepth = 0;
  let inString = false;
  while (index < source.length) {
    if (blockDepth > 0) {
      if (source.startsWith("/-", index)) {
        blockDepth += 1;
        index += 2;
      } else if (source.startsWith("-/", index)) {
        blockDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }
    if (inString) {
      if (source[index] === "\\") index += 2;
      else if (source[index] === "\"") {
        inString = false;
        index += 1;
      } else index += 1;
      continue;
    }
    if (source.startsWith("--", index)) {
      const nextLine = source.indexOf("\n", index + 2);
      index = nextLine === -1 ? source.length : nextLine + 1;
      continue;
    }
    if (source.startsWith("/-", index)) {
      blockDepth = 1;
      index += 2;
      continue;
    }
    if (source[index] === "\"") {
      inString = true;
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(source[index])) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9_']/.test(source[index])) index += 1;
      if (source.slice(start, index) === "sorry") return true;
      continue;
    }
    index += 1;
  }
  return false;
}

function parseAxiomOutput(output) {
  if (/does not depend on any axioms/m.test(output)) return [];
  const match = /depends on axioms:\s*\[([^\]]*)\]/m.exec(output);
  if (!match) return null;
  if (match[1].trim() === "") return [];
  const axioms = match[1].split(",").map((value) => value.trim()).filter(Boolean);
  return axioms.every((axiom) => /^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*$/.test(axiom)) ? axioms : null;
}

async function runCommand({ command, args, cwd, collector, deadline, signal }) {
  if (signal?.aborted) return { code: terminationExitCode, reason: "cancelled", stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  const remaining = deadline - Date.now();
  if (remaining <= 0) return { code: terminationExitCode, reason: "timed_out", stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  return new Promise((resolveExecution, rejectExecution) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: restrictedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let reason = null;
    const terminate = (nextReason) => {
      if (reason) return;
      reason = nextReason;
      child.kill("SIGKILL");
    };
    const timeout = setTimeout(() => terminate("timed_out"), remaining);
    const onAbort = () => terminate("cancelled");
    signal?.addEventListener("abort", onAbort, { once: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => {
      const received = collector.append("stdout", chunk);
      stdout.push(received);
      if (collector.truncated) terminate("output_limited");
    });
    child.stderr.on("data", (chunk) => {
      const received = collector.append("stderr", chunk);
      stderr.push(received);
      if (collector.truncated) terminate("output_limited");
    });
    child.once("error", (cause) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      rejectExecution(new ContainerLeanExecutorError("Container could not start the fixed lake executable.", {
        cause,
        diagnosticCode: "lean_process_start_failed",
      }));
    });
    child.once("close", (code, processSignal) => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      resolveExecution({
        code: Number.isInteger(code) ? code : terminationExitCode,
        signal: processSignal,
        reason,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
      });
    });
  });
}

function restrictedEnvironment() {
  const path = process.env.PATH;
  const home = process.env.HOME;
  if (!path) throw new ContainerLeanExecutorError("Container image must provide PATH for its fixed lake executable.", { diagnosticCode: "lean_environment_missing" });
  if (!home) throw new ContainerLeanExecutorError("Container image must provide HOME for its fixed Lean toolchain installation.", { diagnosticCode: "lean_environment_missing" });
  return {
    PATH: path,
    HOME: home,
    ELAN_HOME: process.env.ELAN_HOME ?? join(home, ".elan"),
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
  };
}

class BoundedOutputCollector {
  constructor(limit) {
    this.limit = limit;
    this.length = 0;
    this.truncated = false;
    this.stdoutChunks = [];
    this.stderrChunks = [];
  }

  append(channel, chunk) {
    const bytes = Buffer.from(chunk);
    const remaining = Math.max(0, this.limit - this.length);
    const accepted = bytes.subarray(0, remaining);
    if (accepted.length > 0) {
      this.length += accepted.length;
      this[`${channel}Chunks`].push(accepted);
    }
    if (accepted.length !== bytes.length) this.truncated = true;
    return accepted;
  }

  stdout() {
    return Buffer.concat(this.stdoutChunks);
  }

  stderr() {
    return Buffer.concat(this.stderrChunks);
  }
}

function assertWorkspaceMatchesRequest(workspace, request, requestHash, executable) {
  if (!workspace || typeof workspace !== "object" || typeof workspace.workspaceDirectory !== "string" || !Array.isArray(workspace.entries)) {
    throw new ContainerLeanExecutorError("Container Lean execution requires a finalized private workspace.");
  }
  if (
    workspace.jobId !== request.jobId ||
    workspace.requestHash !== requestHash ||
    !sameArray(workspace.entryCommand, request.bundle.entryCommand) ||
    workspace.entryCommand[0] !== executable ||
    !samePolicy(workspace.policy, request.policy) ||
    !workspace.target || typeof workspace.target.declaration !== "string"
  ) {
    throw new ContainerLeanExecutorError("Finalized workspace does not match its immutable Runner request.");
  }
}

function sameArray(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => value === right[index]);
}

async function diagnoseExecutorStage(diagnosticCode, operation) {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof ContainerLeanExecutorError && cause.diagnosticCode) throw cause;
    throw new ContainerLeanExecutorError("Container Lean execution stage failed.", {
      cause,
      diagnosticCode,
    });
  }
}

function requireExecutorDiagnosticCode(value) {
  if (typeof value !== "string" || !/^lean_[a-z0-9_]{3,48}$/.test(value)) {
    throw new TypeError("Container Lean diagnostic code is invalid.");
  }
  return value;
}

function isReviewedExecutablePath(value) {
  return value === "lake" || /^\/(?:[A-Za-z0-9._+-]+\/)*lake$/.test(value);
}

function isNormalizedAbsolutePath(value) {
  return typeof value === "string"
    && value.startsWith("/")
    && value !== "/"
    && !value.includes("\0")
    && !value.includes("\\")
    && resolve(value) === value;
}

function samePolicy(left, right) {
  return Boolean(left && right && left.requireNoSorry === true && right.requireNoSorry === true && sameArray(left.allowedAxioms, right.allowedAxioms));
}

function normalizedExitCode(execution, status) {
  if (["timed_out", "cancelled"].includes(status)) return terminationExitCode;
  if (Number.isInteger(execution.code) && execution.code >= 0 && execution.code <= 255) return execution.code;
  return 1;
}

function hashBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isoInstant(value, label) {
  const normalized = value instanceof Date ? value.toISOString() : value;
  if (typeof normalized !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized) || !Number.isFinite(Date.parse(normalized))) {
    throw new ContainerLeanExecutorError(`${label} must be an ISO-8601 UTC instant.`);
  }
  return normalized;
}
