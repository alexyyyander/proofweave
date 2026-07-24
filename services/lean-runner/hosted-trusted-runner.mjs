import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const defaultPort = 7860;

export class HostedTrustedRunnerConfigurationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "HostedTrustedRunnerConfigurationError";
  }
}

/**
 * HTTP lifecycle wrapper for a trusted Runner on a scale-to-zero host. It
 * never accepts workspaces or Lean source over HTTP. Signed jobs stay in the
 * Turso lease queue and execute only in the configured isolated Sandbox.
 */
export class HostedTrustedRunnerService {
  constructor({
    environment = process.env,
    runtimeFactory = defaultRuntimeFactory,
    now = () => new Date(),
    emit = emitStructuredConsole,
  } = {}) {
    if (typeof runtimeFactory !== "function" || typeof now !== "function" || typeof emit !== "function") {
      throw new HostedTrustedRunnerConfigurationError("Hosted Runner requires runtime, clock, and audit functions.");
    }
    this.environment = environment;
    this.runtimeFactory = runtimeFactory;
    this.now = now;
    this.emit = emit;
    this.port = integerSetting(environment.PORT, "PORT", defaultPort, 0, 65_535);
    this.host = normalizedHost(environment.HOST ?? "0.0.0.0");
    this.wakeToken = requireWakeToken(environment.PROOFWEAVE_RUNNER_WAKE_TOKEN);
    this.revision = boundedLabel(
      environment.RENDER_GIT_COMMIT ?? environment.PROOFWEAVE_RUNNER_REVISION ?? "development",
      "Runner revision",
    );
    this.provider = boundedLabel(environment.PROOFWEAVE_RUNNER_PROVIDER ?? "unconfigured", "Runner provider");
    this.controller = new AbortController();
    this.runtime = null;
    this.server = null;
    this.workerPromise = null;
    this.state = "starting";
    this.startedAt = timestamp(now);
    this.lastWakeAt = null;
    this.failureCode = null;
  }

  async start() {
    if (this.server) throw new HostedTrustedRunnerConfigurationError("Hosted Runner is already started.");
    this.server = createServer((request, response) => {
      this.handle(request, response).catch((error) => {
        this.emitAudit("http_error", privacySafeErrorCode(error));
        sendJson(response, 500, { error: "internal_error" });
      });
    });
    await listen(this.server, this.port, this.host);
    this.port = this.server.address().port;
    this.startWorker();
    this.emitAudit("listening");
    return this;
  }

  async close() {
    if (this.state === "stopped") return;
    this.state = "stopping";
    this.controller.abort();
    await Promise.allSettled([this.workerPromise, this.runtime?.close?.(), closeServer(this.server)]);
    this.runtime = null;
    this.server = null;
    this.state = "stopped";
    this.emitAudit("stopped");
  }

  startWorker() {
    this.workerPromise = (async () => {
      try {
        this.runtime = await this.runtimeFactory({ environment: this.environment });
        this.state = "ready";
        this.emitAudit("ready");
        await this.runtime.run({ signal: this.controller.signal });
        if (!this.controller.signal.aborted) {
          this.state = "degraded";
          this.failureCode = "worker_stopped";
          this.emitAudit("worker_stopped", this.failureCode);
        }
      } catch (error) {
        this.state = "degraded";
        this.failureCode = privacySafeErrorCode(error);
        this.emitAudit("startup_or_worker_error", this.failureCode);
      }
    })();
  }

  async handle(request, response) {
    applySecurityHeaders(response);
    const url = new URL(request.url ?? "/", "http://proofweave-runner.internal");
    if (request.method === "GET" && url.pathname === "/") {
      return sendHtml(response, 200, statusPage(this.snapshot()));
    }
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/healthz") {
      return sendJson(response, this.state === "ready" ? 200 : 503, this.snapshot(), request.method === "HEAD");
    }
    if (request.method === "POST" && url.pathname === "/v1/wake") {
      if (!authorized(request.headers.authorization, request.headers["x-proofweave-wake-token"], this.wakeToken)) {
        return sendJson(response, 401, { error: "unauthorized" });
      }
      if (!requestHasEmptyBody(request)) {
        return sendJson(response, 413, { error: "request_body_not_allowed" });
      }
      this.lastWakeAt = timestamp(this.now);
      this.emitAudit("wake_accepted");
      return sendJson(response, 202, { accepted: true, state: this.state, revision: this.revision });
    }
    return sendJson(response, 404, { error: "not_found" });
  }

  snapshot() {
    return Object.freeze({
      service: "proofweave-trusted-runner",
      state: this.state,
      provider: this.provider,
      revision: this.revision,
      startedAt: this.startedAt,
      lastWakeAt: this.lastWakeAt,
      ...(this.failureCode ? { failureCode: this.failureCode } : {}),
      executionBoundary: "isolated-sandbox-only",
    });
  }

  emitAudit(outcome, errorCode) {
    try {
      this.emit(Object.freeze({
        schemaVersion: "pw-audit-v1",
        kind: "hosted_trusted_runner",
        component: "trusted_lean_runner",
        occurredAt: timestamp(this.now),
        outcome,
        ...(errorCode ? { errorCode } : {}),
      }));
    } catch {
      // Observability cannot change the service lifecycle.
    }
  }
}

export async function startHostedTrustedRunner(options = {}) {
  return new HostedTrustedRunnerService(options).start();
}

function authorized(authorizationHeader, wakeHeader, expectedToken) {
  const supplied = typeof wakeHeader === "string"
    ? wakeHeader
    : typeof authorizationHeader === "string" && authorizationHeader.startsWith("Bearer ")
      ? authorizationHeader.slice(7)
      : null;
  if (supplied === null) return false;
  const received = Buffer.from(supplied);
  const expected = Buffer.from(expectedToken);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function requestHasEmptyBody(request) {
  if (request.headers["transfer-encoding"] !== undefined) return false;
  const rawLength = request.headers["content-length"];
  return rawLength === undefined || (/^\d+$/.test(rawLength) && Number(rawLength) === 0);
}

async function defaultRuntimeFactory(options) {
  const { createTrustedRunnerRuntimeFromEnvironment } = await import("./trusted-runner-process.mjs");
  return createTrustedRunnerRuntimeFromEnvironment(options);
}

function requireWakeToken(value) {
  if (typeof value !== "string" || value.length < 32 || value.length > 512 || /\s|\0/.test(value)) {
    throw new HostedTrustedRunnerConfigurationError("Hosted Runner requires a 32-512 character PROOFWEAVE_RUNNER_WAKE_TOKEN.");
  }
  return value;
}

function normalizedHost(value) {
  if (typeof value !== "string" || !/^(?:0\.0\.0\.0|127\.0\.0\.1|::1)$/.test(value)) {
    throw new HostedTrustedRunnerConfigurationError("HOST must be a local bind address.");
  }
  return value;
}

function boundedLabel(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._+@/-]{1,191}$/.test(value)) {
    throw new HostedTrustedRunnerConfigurationError(`${label} must be a bounded label.`);
  }
  return value;
}

function integerSetting(value, label, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new HostedTrustedRunnerConfigurationError(`${label} must be an integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new HostedTrustedRunnerConfigurationError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function timestamp(now) {
  const value = now();
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new HostedTrustedRunnerConfigurationError("Runner clock is invalid.");
  return instant.toISOString();
}

function privacySafeErrorCode(error) {
  const name = typeof error?.name === "string" ? error.name : "runner_error";
  const normalized = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "").toLowerCase().slice(0, 56);
  return /^[a-z][a-z0-9_]{2,63}$/.test(normalized) ? normalized : "runner_error";
}

function applySecurityHeaders(response) {
  response.setHeader("cache-control", "no-store");
  response.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
}

function sendJson(response, status, value, head = false) {
  if (response.headersSent || response.destroyed) return;
  const body = `${JSON.stringify(value)}\n`;
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(head ? undefined : body);
}

function sendHtml(response, status, body) {
  if (response.headersSent || response.destroyed) return;
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.setHeader("content-length", Buffer.byteLength(body));
  response.end(body);
}

function statusPage(status) {
  const healthy = status.state === "ready";
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Proofweave Runner</title><style>body{margin:0;background:#0b1b37;color:#eef3ff;font:16px/1.5 system-ui,sans-serif}main{max-width:720px;margin:12vh auto;padding:32px}p{color:#b8c4dd}.status{display:inline-block;padding:6px 10px;border:1px solid ${healthy ? "#7fc6a4" : "#e2a46f"};color:${healthy ? "#9bddbd" : "#ffc28a"};text-transform:uppercase;letter-spacing:.08em;font-size:12px}code{color:#9eb8ff}</style><main><p class="status">${escapeHtml(status.state)}</p><h1>Proofweave trusted Runner</h1><p>This host coordinates signed queue leases. Submitted Lean code executes only inside a fresh, network-isolated <code>${escapeHtml(status.provider)}</code> Sandbox.</p><p>Revision <code>${escapeHtml(status.revision)}</code></p></main>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolve(); });
  });
}

function closeServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function emitStructuredConsole(record) {
  console.log(JSON.stringify(record));
}
