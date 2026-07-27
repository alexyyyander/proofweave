import {
  leanRunnerRequestHash,
  normalizeLeanRunnerRequest,
} from "../../packages/protocol/lean-runner.mjs";

const maxExecutionResponseBytes = 256 * 1024;
const defaultExecutionPollMilliseconds = 1_000;
const executionPollGraceMilliseconds = 60_000;

export class RunnerContainerExecutionClientError extends Error {
  constructor(message, options = {}) {
    super(message, options);
    this.name = "RunnerContainerExecutionClientError";
    if (options.diagnosticCode !== undefined) {
      this.diagnosticCode = requireDiagnosticCode(options.diagnosticCode);
    }
  }
}

/**
 * Trusted Worker-side client for a private Container that has already received
 * a verified workspace. It returns unsigned evidence and raw output bytes for
 * RunnerExecutionResultSigner; it never exposes a browser route or hands the
 * Container an operator signing key.
 */
export class RunnerContainerExecutionClient {
  constructor({
    sleep = wait,
    now = () => Date.now(),
    pollMilliseconds = defaultExecutionPollMilliseconds,
  } = {}) {
    if (typeof sleep !== "function" || typeof now !== "function") {
      throw new TypeError("Runner Container execution polling requires clock and sleep functions.");
    }
    if (!Number.isInteger(pollMilliseconds) || pollMilliseconds < 10 || pollMilliseconds > 10_000) {
      throw new TypeError("Runner Container execution poll interval is invalid.");
    }
    this.sleep = sleep;
    this.now = now;
    this.pollMilliseconds = pollMilliseconds;
  }

  async execute({ container, run, request }) {
    if (!container || typeof container.fetch !== "function") {
      throw new TypeError("RunnerContainerExecutionClient requires a private Container fetch stub.");
    }
    const normalizedRequest = normalizeLeanRunnerRequest(request);
    const requestHash = await leanRunnerRequestHash(normalizedRequest);
    assertRunMatchesRequest(run, normalizedRequest, requestHash);
    const baseUrl = `https://proofweave-runner.internal/v1/runs/${encodeURIComponent(run.id)}`;
    const payload = await diagnoseStage(
      "runner_container_execute_response_error",
      () => this.pollExecution({
        container,
        run,
        request: normalizedRequest,
        baseUrl,
        deadline: this.now() + (normalizedRequest.limits.wallSeconds * 1_000) + executionPollGraceMilliseconds,
      }),
    );
    const [stdout, stderr] = await Promise.all([
      diagnoseStage(
        "runner_container_stdout_response_error",
        () => this.fetchOutput(container, `${baseUrl}/workspace/result/stdout`, payload.result.artifacts.stdoutHash, "stdout"),
      ),
      diagnoseStage(
        "runner_container_stderr_response_error",
        () => this.fetchOutput(container, `${baseUrl}/workspace/result/stderr`, payload.result.artifacts.stderrHash, "stderr"),
      ),
    ]);
    await diagnoseStage("runner_container_cleanup_response_error", async () => {
      await expectSuccess(
        await container.fetch(new Request(`${baseUrl}/workspace/complete`, { method: "POST" })),
        "workspace cleanup acknowledgement",
      );
    });
    return Object.freeze({
      result: payload.result,
      stdout,
      stderr,
      outputTruncated: payload.outputTruncated,
      workspaceTreeHash: payload.workspaceTreeHash,
    });
  }

  async pollExecution({ container, run, request, baseUrl, deadline }) {
    const body = JSON.stringify(request);
    while (true) {
      const response = await container.fetch(new Request(`${baseUrl}/workspace/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }));
      if (response?.status === 202) {
        if (this.now() >= deadline) {
          throw new RunnerContainerExecutionClientError(
            "Private Container execution polling exceeded its bounded window.",
            { diagnosticCode: "runner_container_execute_poll_timeout_error" },
          );
        }
        await this.sleep(Math.min(this.pollMilliseconds, Math.max(1, deadline - this.now())));
        continue;
      }
      await expectSuccess(response, "Lean execution request");
      const normalized = normalizeExecutionPayload(await readJson(response));
      assertResultMatchesRun(normalized.result, run);
      return normalized;
    }
  }

  async fetchOutput(container, url, expectedHash, label) {
    const response = await container.fetch(new Request(url, { method: "GET" }));
    await expectSuccess(response, `Lean ${label} retrieval`);
    if (response.headers.get("x-proofweave-content-sha256") !== expectedHash) {
      throw new RunnerContainerExecutionClientError(`Container ${label} response hash header does not match unsigned execution evidence.`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 20_000_000) {
      throw new RunnerContainerExecutionClientError(`Container ${label} exceeds the Runner output limit.`);
    }
    return bytes;
  }

  /**
   * Forward an already-durable control-plane cancellation to the named private
   * Container. This never changes D1 state itself and cannot target another
   * Run because the private URL is derived solely from the persisted Run id.
   */
  async cancel({ container, run }) {
    if (!container || typeof container.fetch !== "function") {
      throw new TypeError("RunnerContainerExecutionClient requires a private Container fetch stub.");
    }
    assertActiveRun(run);
    const baseUrl = `https://proofweave-runner.internal/v1/runs/${encodeURIComponent(run.id)}`;
    await expectSuccess(
      await container.fetch(new Request(`${baseUrl}/workspace/cancel`, { method: "POST" })),
      "Lean cancellation request",
    );
  }
}

async function expectSuccess(response, label) {
  if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 299) {
    const privateCode = response?.headers?.get?.("x-proofweave-error-code");
    const diagnosticCode = typeof privateCode === "string" && /^lean_[a-z0-9_]{3,48}$/.test(privateCode)
      ? `runner_container_${privateCode}_error`
      : Number.isInteger(response?.status) && response.status >= 400 && response.status <= 599
        ? `runner_container_http_${response.status}_error`
        : undefined;
    throw new RunnerContainerExecutionClientError(`Private Container rejected ${label}.`, { diagnosticCode });
  }
}

async function readJson(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxExecutionResponseBytes) {
    throw new RunnerContainerExecutionClientError("Private Container execution response exceeds its metadata limit.");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new RunnerContainerExecutionClientError("Private Container execution response is not valid JSON.", { cause });
  }
}

function normalizeExecutionPayload(value) {
  requireRecord(value, "Private Container execution response");
  rejectExtraKeys(value, ["result", "outputTruncated", "workspaceTreeHash"], "Private Container execution response");
  requireRecord(value.result, "Private Container unsigned result");
  rejectExtraKeys(value.result, [
    "protocolVersion", "jobId", "attemptId", "requestHash", "status", "exitCode",
    "startedAt", "finishedAt", "kernelStatus", "checks", "artifacts",
  ], "Private Container unsigned result");
  requireRecord(value.result.artifacts, "Private Container unsigned result artifacts");
  requireSha256(value.result.artifacts.manifestHash, "Private Container manifest hash");
  requireSha256(value.result.artifacts.stdoutHash, "Private Container stdout hash");
  requireSha256(value.result.artifacts.stderrHash, "Private Container stderr hash");
  if (typeof value.outputTruncated !== "boolean") {
    throw new RunnerContainerExecutionClientError("Private Container execution response must declare output truncation.");
  }
  requireSha256(value.workspaceTreeHash, "Private Container workspace tree hash");
  return Object.freeze({
    result: Object.freeze({ ...value.result, artifacts: Object.freeze({ ...value.result.artifacts }) }),
    outputTruncated: value.outputTruncated,
    workspaceTreeHash: value.workspaceTreeHash,
  });
}

function assertRunMatchesRequest(run, request, requestHash) {
  assertActiveRun(run);
  if (
    run.id !== request.jobId ||
    run.attemptId !== request.attemptId ||
    run.requestHash !== requestHash ||
    run.artifactBundleHash !== request.bundle.manifestHash
  ) {
    throw new RunnerContainerExecutionClientError("Persisted Run does not match the immutable Runner request.");
  }
}

function assertActiveRun(run) {
  if (!run || typeof run !== "object" || !["running", "cancel_requested"].includes(run.state)) {
    throw new RunnerContainerExecutionClientError("Only an active persisted Run may invoke a private Container execution.");
  }
  if (typeof run.id !== "string" || run.id.length === 0 || run.id.length > 240) {
    throw new RunnerContainerExecutionClientError("Private Container execution requires a bounded Run id.");
  }
}

function assertResultMatchesRun(result, run) {
  if (
    result.jobId !== run.id ||
    result.attemptId !== run.attemptId ||
    result.requestHash !== run.requestHash ||
    result.artifacts.manifestHash !== run.artifactBundleHash
  ) {
    throw new RunnerContainerExecutionClientError("Private Container unsigned result does not match the persisted Run.");
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RunnerContainerExecutionClientError(`${label} must be an object.`);
  }
}

function rejectExtraKeys(value, allowed, label) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new RunnerContainerExecutionClientError(`${label} contains unsupported field ${extra}.`);
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new RunnerContainerExecutionClientError(`${label} must be sha256:<hex>.`);
  }
}

async function diagnoseStage(diagnosticCode, operation) {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof RunnerContainerExecutionClientError && cause.diagnosticCode) {
      throw cause;
    }
    throw new RunnerContainerExecutionClientError("Private Container execution stage failed.", {
      cause,
      diagnosticCode,
    });
  }
}

function requireDiagnosticCode(value) {
  if (typeof value !== "string" || !/^runner_container_[a-z0-9_]{3,48}_error$/.test(value)) {
    throw new TypeError("Runner Container diagnostic code is invalid.");
  }
  return value;
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}
