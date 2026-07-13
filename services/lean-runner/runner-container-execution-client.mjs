import {
  leanRunnerRequestHash,
  normalizeLeanRunnerRequest,
} from "../../packages/protocol/lean-runner.mjs";

const maxExecutionResponseBytes = 256 * 1024;

export class RunnerContainerExecutionClientError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerContainerExecutionClientError";
  }
}

/**
 * Trusted Worker-side client for a private Container that has already received
 * a verified workspace. It returns unsigned evidence and raw output bytes for
 * RunnerExecutionResultSigner; it never exposes a browser route or hands the
 * Container an operator signing key.
 */
export class RunnerContainerExecutionClient {
  async execute({ container, run, request }) {
    if (!container || typeof container.fetch !== "function") {
      throw new TypeError("RunnerContainerExecutionClient requires a private Container fetch stub.");
    }
    const normalizedRequest = normalizeLeanRunnerRequest(request);
    const requestHash = await leanRunnerRequestHash(normalizedRequest);
    assertRunMatchesRequest(run, normalizedRequest, requestHash);
    const baseUrl = `https://proofweave-runner.internal/v1/runs/${encodeURIComponent(run.id)}`;
    const response = await container.fetch(new Request(`${baseUrl}/workspace/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(normalizedRequest),
    }));
    await expectSuccess(response, "Lean execution request");
    const payload = normalizeExecutionPayload(await readJson(response));
    assertResultMatchesRun(payload.result, run);
    const [stdout, stderr] = await Promise.all([
      this.fetchOutput(container, `${baseUrl}/workspace/result/stdout`, payload.result.artifacts.stdoutHash, "stdout"),
      this.fetchOutput(container, `${baseUrl}/workspace/result/stderr`, payload.result.artifacts.stderrHash, "stderr"),
    ]);
    await expectSuccess(
      await container.fetch(new Request(`${baseUrl}/workspace/complete`, { method: "POST" })),
      "workspace cleanup acknowledgement",
    );
    return Object.freeze({
      result: payload.result,
      stdout,
      stderr,
      outputTruncated: payload.outputTruncated,
      workspaceTreeHash: payload.workspaceTreeHash,
    });
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
}

async function expectSuccess(response, label) {
  if (!response || !Number.isInteger(response.status) || response.status < 200 || response.status > 299) {
    throw new RunnerContainerExecutionClientError(`Private Container rejected ${label}.`);
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
  if (!run || typeof run !== "object" || !["running", "cancel_requested"].includes(run.state)) {
    throw new RunnerContainerExecutionClientError("Only an active persisted Run may invoke a private Container execution.");
  }
  if (
    run.id !== request.jobId ||
    run.attemptId !== request.attemptId ||
    run.requestHash !== requestHash ||
    run.artifactBundleHash !== request.bundle.manifestHash
  ) {
    throw new RunnerContainerExecutionClientError("Persisted Run does not match the immutable Runner request.");
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
