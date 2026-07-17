import { signLeanRunnerResult } from "../../packages/protocol/lean-runner.mjs";

export class RunnerExecutionResultSignerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerExecutionResultSignerError";
  }
}

/**
 * Trusted Worker-side bridge between untrusted Container output and a signed
 * Runner result. The Container never receives this key; it cannot choose a
 * different Run, request, manifest, or output hash and have the Worker attest
 * to it. Persistence is deliberately separate so output blobs can be stored
 * atomically by a deployment-specific R2 adapter before D1 accepts the result.
 */
export class RunnerExecutionResultSigner {
  constructor({ runnerKeyId, runnerPrivateKey }) {
    if (typeof runnerKeyId !== "string" || runnerKeyId.trim().length === 0 || runnerKeyId.length > 240) {
      throw new TypeError("RunnerExecutionResultSigner requires a bounded runner key id.");
    }
    if (!runnerPrivateKey) throw new TypeError("RunnerExecutionResultSigner requires an operator-held private key.");
    this.runnerKeyId = runnerKeyId;
    this.runnerPrivateKey = runnerPrivateKey;
  }

  async sign({ execution, run }) {
    const normalized = await normalizeContainerExecution(execution);
    assertBoundToRun(normalized.result, run);
    return signLeanRunnerResult({
      result: { ...normalized.result, runnerKeyId: this.runnerKeyId },
      runnerPrivateKey: this.runnerPrivateKey,
    });
  }
}

async function normalizeContainerExecution(execution) {
  if (!execution || typeof execution !== "object" || Array.isArray(execution)) {
    throw new RunnerExecutionResultSignerError("Runner execution evidence must be an object.");
  }
  rejectExtraKeys(execution, ["result", "stdout", "stderr", "outputTruncated", "workspaceTreeHash"], "Runner execution evidence");
  if (!execution.result || typeof execution.result !== "object" || Array.isArray(execution.result)) {
    throw new RunnerExecutionResultSignerError("Runner execution evidence requires an unsigned result.");
  }
  rejectExtraKeys(execution.result, [
    "protocolVersion", "jobId", "attemptId", "requestHash", "status", "exitCode",
    "startedAt", "finishedAt", "kernelStatus", "checks", "artifacts",
  ], "Unsigned Runner result");
  const stdout = requireBytes(execution.stdout, "Runner stdout");
  const stderr = requireBytes(execution.stderr, "Runner stderr");
  if (typeof execution.outputTruncated !== "boolean") {
    throw new RunnerExecutionResultSignerError("Runner execution evidence must declare whether output was truncated.");
  }
  if (execution.outputTruncated && execution.result.status !== "failed") {
    throw new RunnerExecutionResultSignerError("Truncated Container output cannot be signed as a non-failed Runner result.");
  }
  requireSha256(execution.workspaceTreeHash, "Runner workspace tree hash");
  const result = execution.result;
  if (!result.artifacts || typeof result.artifacts !== "object") {
    throw new RunnerExecutionResultSignerError("Unsigned Runner result requires artifact hashes.");
  }
  if (result.artifacts.stdoutHash !== await sha256Bytes(stdout) || result.artifacts.stderrHash !== await sha256Bytes(stderr)) {
    throw new RunnerExecutionResultSignerError("Container stdout/stderr bytes do not match the unsigned result hashes.");
  }
  return Object.freeze({ result: Object.freeze({ ...result }), stdout, stderr });
}

function assertBoundToRun(result, run) {
  if (!run || typeof run !== "object") throw new RunnerExecutionResultSignerError("Runner signing requires a persisted Run.");
  if (!['running', 'cancel_requested'].includes(run.state)) {
    throw new RunnerExecutionResultSignerError("Only an active Run can receive a signed Container result.");
  }
  if (
    result.jobId !== run.id ||
    result.attemptId !== run.attemptId ||
    result.requestHash !== run.requestHash ||
    result.artifacts.manifestHash !== run.artifactBundleHash
  ) {
    throw new RunnerExecutionResultSignerError("Container execution evidence does not match its persisted Run.");
  }
}

async function sha256Bytes(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${hex(new Uint8Array(digest))}`;
}

function requireBytes(value, label) {
  if (!(value instanceof Uint8Array)) {
    throw new RunnerExecutionResultSignerError(`${label} must be a byte array.`);
  }
  return value;
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RunnerExecutionResultSignerError(`${label} must be sha256:<hex>.`);
  }
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new RunnerExecutionResultSignerError(`${label} contains unsupported field ${extra}.`);
}

function hex(value) {
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
