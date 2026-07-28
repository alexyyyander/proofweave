import { Sandbox, Template } from "e2b";
import { assertPinnedRunnerImage } from "./cloudflare-container-policy.mjs";

const defaultPort = 8080;
const allTraffic = "0.0.0.0/0";
const internalOrigin = "https://proofweave-runner.internal";
const runnerUser = "proofweave";
const runnerHome = "/home/proofweave";
const runnerPath = "/opt/lean/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const runnerLeanExecutable = "/opt/lean/bin/lake";
const runnerDependencyPackagesRoot = "/opt/proofweave/lake-packages";
const maximumExecutionTimeoutMs = 1_260_000;
const proofWidgetsPackageLockHash = `${runnerDependencyPackagesRoot}/proofwidgets/widget/package-lock.json.hash`;
const prepareDependencyCacheCommand = `touch ${proofWidgetsPackageLockHash} && chown proofweave:proofweave ${proofWidgetsPackageLockHash} && chmod 0644 ${proofWidgetsPackageLockHash}`;
const runPath = /^\/v1\/runs\/([^/]+)\/workspace(?:\/artifacts\/(?:source-archive|source-patch|lake-manifest)|\/(?:finalize|execute|cancel|complete)|\/result\/(?:stdout|stderr))?$/;

export class E2BSandboxContainerError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "E2BSandboxContainerError";
  }
}

/**
 * Provider adapter for the private Runner Container fetch contract.
 *
 * The E2B management API is used only by the trusted Runner process. Each Run
 * receives a fresh secure Sandbox with all egress denied and public traffic
 * disabled. The E2B API key and Runner signing material never enter it.
 */
export class E2BSandboxContainerFactory {
  constructor({
    sandboxApi = Sandbox,
    templateApi = Template,
    apiKey,
    templateId,
    templateBuildId,
    imageReference,
    cpuCount,
    memoryMB,
    timeoutMs,
    startupTimeoutMs,
    resourcePolicyReviewed,
    port = defaultPort,
    fetcher = globalThis.fetch,
    sleep = wait,
  } = {}) {
    if (!sandboxApi || typeof sandboxApi.create !== "function") {
      throw new E2BSandboxContainerError("E2B runner requires the official Sandbox API.");
    }
    if (!templateApi || typeof templateApi.getTags !== "function") {
      throw new E2BSandboxContainerError("E2B runner requires the official Template API.");
    }
    this.apiKey = requireSecret(apiKey, "E2B API key");
    this.template = requireVersionedTemplateReference(templateId);
    this.templateBuildId = requireBuildId(templateBuildId);
    this.immutableTemplateReference = `${this.template.id}:${this.templateBuildId}`;
    this.imageReference = assertPinnedRunnerImage(imageReference);
    this.cpuCount = integerRange(cpuCount, "E2B template CPU count", 1, 8);
    this.memoryMB = integerRange(memoryMB, "E2B template memory", 512, 8_192);
    this.timeoutMs = integerRange(timeoutMs, "E2B execution timeout", 1_000, maximumExecutionTimeoutMs);
    this.startupTimeoutMs = integerRange(startupTimeoutMs, "E2B startup timeout", 1_000, Math.min(120_000, this.timeoutMs));
    if (resourcePolicyReviewed !== true) {
      throw new E2BSandboxContainerError("E2B runner stays disabled until its template, no-egress policy, resources, and timeout are reviewed.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new E2BSandboxContainerError("E2B runner port is invalid.");
    }
    if (typeof fetcher !== "function" || typeof sleep !== "function") {
      throw new E2BSandboxContainerError("E2B runner requires HTTPS fetch and bounded wait implementations.");
    }
    this.sandboxApi = sandboxApi;
    this.templateApi = templateApi;
    this.port = port;
    this.fetcher = fetcher;
    this.sleep = sleep;
    this.active = new Map();
  }

  async get(runId) {
    const normalizedRunId = requireIdentifier(runId, "Run id", 240);
    const existing = this.active.get(normalizedRunId);
    if (existing) return existing;
    if (this.active.size >= 1) {
      throw new E2BSandboxContainerError("Closed-alpha E2B runner permits only one active Sandbox.");
    }
    const creating = this.create(normalizedRunId).catch((error) => {
      this.active.delete(normalizedRunId);
      if (error instanceof E2BSandboxContainerError) throw error;
      throw new E2BSandboxContainerError("E2B could not create the isolated Lean Sandbox.", { cause: error });
    });
    this.active.set(normalizedRunId, creating);
    return creating;
  }

  async terminate(runId) {
    const normalizedRunId = requireIdentifier(runId, "Run id", 240);
    const pending = this.active.get(normalizedRunId);
    if (!pending) return false;
    const container = await pending;
    await container.terminate();
    return true;
  }

  async close() {
    const containers = await Promise.allSettled([...this.active.values()]);
    await Promise.allSettled(containers
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value.terminate()));
  }

  async create(runId) {
    let sandbox;
    try {
      await assertTemplateBuildReference(this.templateApi, {
        apiKey: this.apiKey,
        template: this.template,
        buildId: this.templateBuildId,
      });
      // E2B build UUID references are immutable. The reviewed tag remains a
      // human-readable release assertion, but must never be the creation
      // authority because a provider-side tag can move after it is checked.
      sandbox = await this.sandboxApi.create(this.immutableTemplateReference, {
        apiKey: this.apiKey,
        secure: true,
        allowInternetAccess: false,
        network: {
          allowPublicTraffic: false,
          denyOut: [allTraffic],
        },
        lifecycle: { onTimeout: "kill" },
        timeoutMs: Math.min(3_600_000, this.timeoutMs + 60_000),
        requestTimeoutMs: this.startupTimeoutMs,
        envs: {
          PROOFWEAVE_NETWORK_ISOLATED: "true",
          PROOFWEAVE_RESOURCE_LIMITS_ENFORCED: "true",
          PROOFWEAVE_REQUEST_TIMEOUT_MS: String(this.timeoutMs),
        },
        metadata: {
          component: "proofweave-lean-runner",
          protocol: "pw-lean-runner-v1",
        },
      });
      await assertSandboxIsolation(sandbox, {
        templateId: this.template.id,
        requestTimeoutMs: this.startupTimeoutMs,
        cpuCount: this.cpuCount,
        memoryMB: this.memoryMB,
      });
      await startSandboxServer(sandbox, this.timeoutMs, this.startupTimeoutMs);
      const container = new E2BSandboxContainer({
        sandbox,
        token: sandbox.trafficAccessToken,
        runId,
        port: this.port,
        requestTimeoutMs: this.startupTimeoutMs,
        fetcher: this.fetcher,
        sleep: this.sleep,
        onTerminated: () => this.active.delete(runId),
      });
      await container.waitUntilReady(this.startupTimeoutMs);
      this.active.set(runId, Promise.resolve(container));
      return container;
    } catch (error) {
      await sandbox?.kill?.().catch(() => {});
      throw error;
    }
  }
}

export class E2BSandboxContainer {
  constructor({ sandbox, token, runId, port, requestTimeoutMs, fetcher, sleep, onTerminated }) {
    if (!sandbox || typeof sandbox.kill !== "function" || typeof sandbox.getHost !== "function") {
      throw new E2BSandboxContainerError("E2B Sandbox handle is invalid.");
    }
    this.runId = requireIdentifier(runId, "Run id", 240);
    this.baseUrl = requireSandboxUrl(sandbox.getHost(port));
    this.token = requireTrafficToken(token);
    this.sandbox = sandbox;
    this.requestTimeoutMs = integerRange(requestTimeoutMs, "E2B private request timeout", 1_000, 120_000);
    this.fetcher = fetcher;
    this.sleep = sleep;
    this.onTerminated = onTerminated;
    this.terminated = false;
  }

  async waitUntilReady(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastError;
    while (Date.now() < deadline) {
      try {
        const response = await this.forward(new Request(`${internalOrigin}/ready`));
        if (response.status === 204) return;
        lastError = new Error(`status_${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await this.sleep(Math.min(250, Math.max(1, deadline - Date.now())));
    }
    throw new E2BSandboxContainerError("E2B Lean Sandbox did not become ready before its bounded startup timeout.", { cause: lastError });
  }

  async fetch(request) {
    if (this.terminated) throw new E2BSandboxContainerError("E2B Sandbox is already terminated.");
    if (!(request instanceof Request)) throw new E2BSandboxContainerError("E2B Sandbox fetch requires a Request.");
    const source = new URL(request.url);
    if (source.origin !== internalOrigin) {
      throw new E2BSandboxContainerError("E2B Sandbox accepts only the private Runner origin.");
    }
    const runId = runIdFromPath(source.pathname);
    if (runId !== this.runId) {
      throw new E2BSandboxContainerError("E2B Sandbox request does not belong to its bound Run.");
    }
    const response = await this.forward(request);
    if (source.pathname.endsWith("/workspace/complete")) {
      const buffered = await bufferResponse(response);
      await this.terminate();
      return buffered;
    }
    return response;
  }

  async forward(request) {
    if (this.terminated) throw new E2BSandboxContainerError("E2B Sandbox is already terminated.");
    const source = new URL(request.url);
    const target = new URL(this.baseUrl);
    target.pathname = source.pathname;
    target.search = source.search;
    const headers = forwardedHeaders(request.headers);
    headers.set("e2b-traffic-access-token", this.token);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(request.signal.reason);
    request.signal.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("E2B authenticated Sandbox request exceeded its bounded timeout.")),
      this.requestTimeoutMs,
    );
    let response;
    try {
      response = await this.fetcher(target, {
        method: request.method,
        headers,
        body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
        duplex: ["GET", "HEAD"].includes(request.method) ? undefined : "half",
        redirect: "error",
        signal: controller.signal,
      });
    } catch (cause) {
      throw new E2BSandboxContainerError("Authenticated E2B Sandbox request failed.", { cause });
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", forwardAbort);
    }
    if (!(response instanceof Response)) {
      throw new E2BSandboxContainerError("E2B Sandbox returned an invalid HTTP response.");
    }
    return response;
  }

  async terminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.token = "";
    try {
      await this.sandbox.kill();
    } finally {
      this.onTerminated?.();
    }
  }
}

export function createE2BSandboxContainerFactoryFromEnvironment({
  environment = process.env,
  sandboxApi = Sandbox,
  templateApi = Template,
  fetcher = globalThis.fetch,
  sleep = wait,
} = {}) {
  return new E2BSandboxContainerFactory({
    sandboxApi,
    templateApi,
    apiKey: environment.E2B_API_KEY,
    templateId: environment.PROOFWEAVE_E2B_TEMPLATE_ID,
    templateBuildId: environment.PROOFWEAVE_E2B_TEMPLATE_BUILD_ID,
    imageReference: environment.PROOFWEAVE_E2B_RUNNER_IMAGE,
    cpuCount: integerFromEnvironment(environment.PROOFWEAVE_E2B_CPU, "PROOFWEAVE_E2B_CPU"),
    memoryMB: integerFromEnvironment(environment.PROOFWEAVE_E2B_MEMORY_MB, "PROOFWEAVE_E2B_MEMORY_MB"),
    resourcePolicyReviewed: environment.PROOFWEAVE_E2B_RESOURCE_POLICY_REVIEWED === "true",
    timeoutMs: integerFromEnvironment(environment.PROOFWEAVE_E2B_TIMEOUT_MS, "PROOFWEAVE_E2B_TIMEOUT_MS"),
    startupTimeoutMs: integerFromEnvironment(environment.PROOFWEAVE_E2B_STARTUP_TIMEOUT_MS, "PROOFWEAVE_E2B_STARTUP_TIMEOUT_MS"),
    fetcher,
    sleep,
  });
}

async function assertTemplateBuildReference(templateApi, { apiKey, template, buildId }) {
  let tags;
  try {
    tags = await templateApi.getTags(template.id, { apiKey });
  } catch (cause) {
    throw new E2BSandboxContainerError("E2B could not verify the reviewed template build tag.", { cause });
  }
  if (!Array.isArray(tags)) {
    throw new E2BSandboxContainerError("E2B template build tags are unavailable.");
  }
  const matched = tags.find((entry) => entry?.tag === template.tag);
  if (matched?.buildId !== buildId) {
    throw new E2BSandboxContainerError("E2B template tag no longer resolves to the reviewed immutable build id.");
  }
}

async function assertSandboxIsolation(sandbox, { templateId, requestTimeoutMs, cpuCount, memoryMB }) {
  if (!sandbox || typeof sandbox.getInfo !== "function") {
    throw new E2BSandboxContainerError("E2B Sandbox does not expose verifiable isolation metadata.");
  }
  const info = await sandbox.getInfo({ requestTimeoutMs });
  if (info?.templateId !== templateId) {
    throw new E2BSandboxContainerError("E2B Sandbox template does not match the reviewed immutable template id.");
  }
  if (info?.allowInternetAccess !== false || info?.network?.allowPublicTraffic !== false) {
    throw new E2BSandboxContainerError("E2B Sandbox did not confirm disabled Internet access and private inbound traffic.");
  }
  if (info?.cpuCount !== cpuCount || info?.memoryMB !== memoryMB) {
    throw new E2BSandboxContainerError("E2B Sandbox resources do not match the reviewed template policy.");
  }
}

async function startSandboxServer(sandbox, timeoutMs, requestTimeoutMs) {
  if (!sandbox?.commands || typeof sandbox.commands.run !== "function") {
    throw new E2BSandboxContainerError("E2B Sandbox does not expose the reviewed command boundary.");
  }
  const commandEnvironment = {
    HOME: runnerHome,
    PATH: runnerPath,
    PROOFWEAVE_LEAN_EXECUTABLE_PATH: runnerLeanExecutable,
    PROOFWEAVE_LAKE_PACKAGES_ROOT: runnerDependencyPackagesRoot,
    PROOFWEAVE_NETWORK_ISOLATED: "true",
    PROOFWEAVE_RESOURCE_LIMITS_ENFORCED: "true",
    PROOFWEAVE_REQUEST_TIMEOUT_MS: String(timeoutMs),
  };
  // E2B can remap imported-image ownership. Mathlib's ProofWidgets target
  // refreshes this generated marker during `lake build`, so the trusted
  // startup boundary repairs only this exact file before dropping back to the
  // unprivileged Runner user. The dependency tree remains read-only.
  await sandbox.commands.run(prepareDependencyCacheCommand, {
    cwd: "/opt/proofweave",
    user: "root",
    timeoutMs: Math.min(10_000, timeoutMs),
    requestTimeoutMs,
    envs: commandEnvironment,
  });
  await sandbox.commands.run(`${runnerLeanExecutable} --version`, {
    cwd: "/opt/proofweave",
    user: runnerUser,
    timeoutMs: Math.min(10_000, timeoutMs),
    requestTimeoutMs,
    envs: commandEnvironment,
  });
  await sandbox.commands.run(
    "node /opt/proofweave/services/lean-runner/container-http-server.mjs",
    {
      background: true,
      cwd: "/opt/proofweave",
      user: runnerUser,
      timeoutMs: Math.min(3_600_000, timeoutMs + 30_000),
      requestTimeoutMs,
      envs: commandEnvironment,
    },
  );
}

function forwardedHeaders(source) {
  const headers = new Headers();
  const blocked = /^(?:authorization|cookie|host|connection|proxy-authorization|e2b-traffic-access-token|x-access-token|x-forwarded-.+|x-e2b-.+)$/i;
  source.forEach((value, name) => {
    if (!blocked.test(name)) headers.append(name, value);
  });
  return headers;
}

async function bufferResponse(response) {
  const headers = new Headers(response.headers);
  const body = await response.arrayBuffer();
  const responseBody = [204, 205, 304].includes(response.status) ? null : body;
  return new Response(responseBody, { status: response.status, statusText: response.statusText, headers });
}

function runIdFromPath(pathname) {
  const match = runPath.exec(pathname);
  if (!match) return null;
  try {
    const runId = decodeURIComponent(match[1]);
    return runId && !runId.includes("/") ? runId : null;
  } catch {
    return null;
  }
}

function requireSandboxUrl(host) {
  if (typeof host !== "string" || host.length === 0 || host.length > 2_048 || /[\0\r\n/@]/.test(host)) {
    throw new E2BSandboxContainerError("E2B Sandbox host is invalid.");
  }
  const url = new URL(`https://${host}`);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/") {
    throw new E2BSandboxContainerError("E2B Sandbox host must be credential-free HTTPS.");
  }
  return url.toString();
}

function requireTrafficToken(value) {
  if (typeof value !== "string" || value.length < 16 || value.length > 512 || /[\0\r\n]/.test(value)) {
    throw new E2BSandboxContainerError("E2B private traffic access token is invalid.");
  }
  return value;
}

function requireSecret(value, label) {
  if (typeof value !== "string" || value.length < 16 || value.length > 2_048 || /[\0\r\n]/.test(value)) {
    throw new E2BSandboxContainerError(`${label} is invalid.`);
  }
  return value;
}

function requireIdentifier(value, label, maximum) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,}$/.test(value) || value.length > maximum) {
    throw new E2BSandboxContainerError(`${label} must be a bounded identifier.`);
  }
  return value;
}

function requireVersionedTemplateReference(value) {
  const reference = requireIdentifier(value, "E2B template reference", 240);
  const separator = reference.indexOf(":");
  if (separator < 3 || separator === reference.length - 1 || reference.indexOf(":", separator + 1) !== -1) {
    throw new E2BSandboxContainerError("E2B template reference must include one explicit immutable build tag.");
  }
  const id = reference.slice(0, separator);
  const tag = reference.slice(separator + 1);
  requireIdentifier(id, "E2B template id", 160);
  requireIdentifier(tag, "E2B template tag", 80);
  return Object.freeze({ reference, id, tag });
}

function requireBuildId(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value)) {
    throw new E2BSandboxContainerError("E2B template build id must be an immutable UUID.");
  }
  return value;
}

function integerFromEnvironment(value, label) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new E2BSandboxContainerError(`${label} must be configured as an integer.`);
  }
  return Number(value);
}

function integerRange(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new E2BSandboxContainerError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
  });
}
