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
    monotonicNow = () => performance.now(),
    observePhase = () => {},
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
    if (
      typeof fetcher !== "function" ||
      typeof sleep !== "function" ||
      typeof monotonicNow !== "function" ||
      typeof observePhase !== "function"
    ) {
      throw new E2BSandboxContainerError("E2B runner requires HTTPS fetch, bounded wait, clock, and phase observation implementations.");
    }
    this.sandboxApi = sandboxApi;
    this.templateApi = templateApi;
    this.port = port;
    this.fetcher = fetcher;
    this.sleep = sleep;
    this.monotonicNow = monotonicNow;
    this.observePhase = observePhase;
    this.active = new Map();
    this.quarantined = new Map();
    this.quarantineCleanup = null;
  }

  async get(runId) {
    const normalizedRunId = requireIdentifier(runId, "Run id", 240);
    let existing = this.active.get(normalizedRunId);
    if (existing) return existing;
    if (this.quarantined.size > 0) {
      if (!this.quarantineCleanup) {
        this.quarantineCleanup = this.retryQuarantinedSandboxes().finally(() => {
          this.quarantineCleanup = null;
        });
      }
      await this.quarantineCleanup;
      existing = this.active.get(normalizedRunId);
      if (existing) return existing;
    }
    if (this.active.size + this.quarantined.size >= 1) {
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
    await Promise.allSettled([...this.quarantined.values()].map((state) => (
      state.cleanupPromise && !state.sandbox
        ? waitForCleanup(state.cleanupPromise, Math.min(10_000, this.startupTimeoutMs))
        : Promise.resolve()
    )));
    await this.retryQuarantinedSandboxes();
  }

  async create(runId) {
    let sandbox;
    let sandboxCreation;
    const startupDeadline = finiteMonotonic(this.monotonicNow()) + this.startupTimeoutMs;
    const startupController = new AbortController();
    const startupTimer = setTimeout(
      () => startupController.abort(startupTimeoutError()),
      this.startupTimeoutMs,
    );
    try {
      // E2B build UUID references are immutable. The reviewed tag remains a
      // human-readable release assertion, but must never be the creation
      // authority because a provider-side tag can move after it is checked.
      // The independent tag assertion and immutable build creation can run in
      // parallel. We still await both and kill an already-created Sandbox if
      // either side fails, so acceleration cannot leave an orphan or bypass
      // the reviewed release assertion.
      const tagTask = abortStartupOnFailure(this.runStartupPhase("e2b_template_assert", () => assertTemplateBuildReference(this.templateApi, {
          apiKey: this.apiKey,
          template: this.template,
          buildId: this.templateBuildId,
          requestTimeoutMs: remainingStartupMilliseconds(startupDeadline, this.monotonicNow),
          signal: startupController.signal,
        }), { startupDeadline, startupController }), startupController);
      sandboxCreation = Promise.resolve().then(() => this.sandboxApi.create(this.immutableTemplateReference, {
          apiKey: this.apiKey,
          secure: true,
          allowInternetAccess: false,
          network: {
            allowPublicTraffic: false,
            denyOut: [allTraffic],
          },
          lifecycle: { onTimeout: "kill" },
          timeoutMs: Math.min(3_600_000, this.timeoutMs + 60_000),
          requestTimeoutMs: remainingStartupMilliseconds(startupDeadline, this.monotonicNow),
          signal: startupController.signal,
          envs: {
            PROOFWEAVE_NETWORK_ISOLATED: "true",
            PROOFWEAVE_RESOURCE_LIMITS_ENFORCED: "true",
            PROOFWEAVE_REQUEST_TIMEOUT_MS: String(this.timeoutMs),
          },
          metadata: {
            component: "proofweave-lean-runner",
            protocol: "pw-lean-runner-v1",
          },
        }));
      sandboxCreation.then((created) => { sandbox = created; }, () => {});
      const sandboxTask = abortStartupOnFailure(this.runStartupPhase(
        "e2b_sandbox_create",
        () => sandboxCreation,
        { startupDeadline, startupController },
      ), startupController);
      const [tagResult, sandboxResult] = await Promise.allSettled([tagTask, sandboxTask]);
      if (sandboxResult.status === "fulfilled") sandbox = sandboxResult.value;
      if (tagResult.status === "rejected") throw tagResult.reason;
      if (sandboxResult.status === "rejected") throw sandboxResult.reason;

      const commandEnvironment = sandboxCommandEnvironment(this.timeoutMs);
      // Provider metadata verification and the one fixed cache-marker repair
      // touch no user bytes and are independent. Both must complete before the
      // unprivileged server is started or any workspace can be accepted.
      const [isolationResult, repairResult] = await Promise.allSettled([
        abortStartupOnFailure(this.runStartupPhase("e2b_isolation_assert", () => assertSandboxIsolation(sandbox, {
          templateId: this.template.id,
          requestTimeoutMs: remainingStartupMilliseconds(startupDeadline, this.monotonicNow),
          cpuCount: this.cpuCount,
          memoryMB: this.memoryMB,
          signal: startupController.signal,
        }), { startupDeadline, startupController }), startupController),
        abortStartupOnFailure(this.runStartupPhase("e2b_cache_marker_repair", () => prepareDependencyCache(sandbox, {
          timeoutMs: this.timeoutMs,
          requestTimeoutMs: remainingStartupMilliseconds(startupDeadline, this.monotonicNow),
          commandEnvironment,
          signal: startupController.signal,
        }), { startupDeadline, startupController }), startupController),
      ]);
      if (isolationResult.status === "rejected") throw isolationResult.reason;
      if (repairResult.status === "rejected") throw repairResult.reason;
      await this.runStartupPhase("e2b_runtime_probe", () => probeSandboxRuntime(sandbox, {
        timeoutMs: this.timeoutMs,
        requestTimeoutMs: remainingStartupMilliseconds(startupDeadline, this.monotonicNow),
        commandEnvironment,
        signal: startupController.signal,
      }), { startupDeadline, startupController });
      await this.runStartupPhase("e2b_server_spawn", () => spawnSandboxServer(sandbox, {
        timeoutMs: this.timeoutMs,
        requestTimeoutMs: remainingStartupMilliseconds(startupDeadline, this.monotonicNow),
        commandEnvironment,
        signal: startupController.signal,
      }), { startupDeadline, startupController });
      const container = new E2BSandboxContainer({
        sandbox,
        token: sandbox.trafficAccessToken,
        runId,
        port: this.port,
        requestTimeoutMs: this.startupTimeoutMs,
        fetcher: this.fetcher,
        sleep: this.sleep,
        monotonicNow: this.monotonicNow,
        onTerminated: () => this.active.delete(runId),
        onTerminationFailed: (failedSandbox) => {
          this.active.delete(runId);
          this.quarantined.set(runId, { sandbox: failedSandbox, cleanupPromise: null });
        },
      });
      await this.runStartupPhase(
        "e2b_ready_wait",
        () => container.waitUntilReady({ deadline: startupDeadline, signal: startupController.signal }),
        { startupDeadline, startupController },
      );
      this.active.set(runId, Promise.resolve(container));
      return container;
    } catch (error) {
      startupController.abort(error);
      if (sandbox) {
        await this.quarantineAndKill(runId, sandbox);
      } else if (sandboxCreation) {
        this.trackLateSandbox(runId, sandboxCreation);
      }
      throw error;
    } finally {
      clearTimeout(startupTimer);
    }
  }

  async runStartupPhase(phase, operation, { startupDeadline, startupController }) {
    const result = await this.measurePhase(
      phase,
      () => raceAgainstStartupSignal(Promise.resolve().then(operation), startupController.signal),
    );
    remainingStartupMilliseconds(startupDeadline, this.monotonicNow);
    return result;
  }

  trackLateSandbox(runId, sandboxCreation) {
    if (this.quarantined.has(runId)) return;
    const state = { sandbox: null, cleanupPromise: null };
    this.quarantined.set(runId, state);
    state.cleanupPromise = Promise.resolve(sandboxCreation).then(async (created) => {
      state.sandbox = created;
      await this.retryQuarantinedSandbox(runId, created);
    }, () => {
      this.quarantined.delete(runId);
    });
    state.cleanupPromise.catch(() => {});
  }

  async quarantineAndKill(runId, sandbox) {
    const state = { sandbox, cleanupPromise: null };
    this.quarantined.set(runId, state);
    await this.retryQuarantinedSandbox(runId, sandbox);
  }

  async retryQuarantinedSandboxes() {
    await Promise.allSettled([...this.quarantined.entries()].map(([runId, state]) => (
      state.sandbox ? this.retryQuarantinedSandbox(runId, state.sandbox) : Promise.resolve(false)
    )));
  }

  async retryQuarantinedSandbox(runId, sandbox) {
    const killed = await boundedProviderKill(sandbox, Math.min(10_000, this.startupTimeoutMs));
    if (killed) this.quarantined.delete(runId);
    return killed;
  }

  async measurePhase(phase, operation) {
    const started = finiteMonotonic(this.monotonicNow());
    try {
      const result = await operation();
      safeObservePhase(this.observePhase, phase, elapsedMilliseconds(started, this.monotonicNow()), "completed");
      return result;
    } catch (error) {
      safeObservePhase(this.observePhase, phase, elapsedMilliseconds(started, this.monotonicNow()), "failed");
      throw error;
    }
  }
}

export class E2BSandboxContainer {
  constructor({
    sandbox,
    token,
    runId,
    port,
    requestTimeoutMs,
    fetcher,
    sleep,
    monotonicNow = () => performance.now(),
    onTerminated,
    onTerminationFailed,
  }) {
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
    this.monotonicNow = monotonicNow;
    this.onTerminated = onTerminated;
    this.onTerminationFailed = onTerminationFailed;
    this.terminated = false;
    this.terminationPromise = null;
  }

  async waitUntilReady({ deadline, signal }) {
    let lastError;
    while (!signal.aborted) {
      const remaining = remainingStartupMilliseconds(deadline, this.monotonicNow);
      try {
        const response = await this.forward(new Request(`${internalOrigin}/ready`, { signal }), {
          timeoutMs: Math.min(this.requestTimeoutMs, remaining),
        });
        if (response.status === 204) {
          remainingStartupMilliseconds(deadline, this.monotonicNow);
          return;
        }
        lastError = new Error(`status_${response.status}`);
      } catch (error) {
        if (signal.aborted) throw startupTimeoutError(error);
        lastError = error;
      }
      await raceAgainstStartupSignal(
        Promise.resolve(this.sleep(Math.min(250, remainingStartupMilliseconds(deadline, this.monotonicNow)))),
        signal,
      );
    }
    throw startupTimeoutError(lastError ?? signal.reason);
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

  async forward(request, { timeoutMs = this.requestTimeoutMs } = {}) {
    if (this.terminated) throw new E2BSandboxContainerError("E2B Sandbox is already terminated.");
    const source = new URL(request.url);
    const target = new URL(this.baseUrl);
    target.pathname = source.pathname;
    target.search = source.search;
    const headers = forwardedHeaders(request.headers);
    headers.set("e2b-traffic-access-token", this.token);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(request.signal.reason);
    if (request.signal.aborted) forwardAbort();
    else request.signal.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error("E2B authenticated Sandbox request exceeded its bounded timeout.")),
      boundedRequestTimeout(timeoutMs),
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
    if (this.terminationPromise) return this.terminationPromise;
    this.terminated = true;
    this.token = "";
    this.terminationPromise = (async () => {
      try {
        const killed = await boundedProviderKill(this.sandbox, this.requestTimeoutMs);
        if (!killed) {
          throw new E2BSandboxContainerError("E2B Sandbox cleanup could not be confirmed.");
        }
        this.onTerminated?.();
      } catch (error) {
        this.onTerminationFailed?.(this.sandbox);
        throw error;
      }
    })();
    return this.terminationPromise;
  }
}

export function createE2BSandboxContainerFactoryFromEnvironment({
  environment = process.env,
  sandboxApi = Sandbox,
  templateApi = Template,
  fetcher = globalThis.fetch,
  sleep = wait,
  monotonicNow = () => performance.now(),
  observePhase = () => {},
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
    monotonicNow,
    observePhase,
  });
}

async function assertTemplateBuildReference(templateApi, { apiKey, template, buildId, requestTimeoutMs, signal }) {
  let tags;
  try {
    tags = await templateApi.getTags(template.id, { apiKey, requestTimeoutMs, signal });
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

async function assertSandboxIsolation(sandbox, { templateId, requestTimeoutMs, cpuCount, memoryMB, signal }) {
  if (!sandbox || typeof sandbox.getInfo !== "function") {
    throw new E2BSandboxContainerError("E2B Sandbox does not expose verifiable isolation metadata.");
  }
  const info = await sandbox.getInfo({ requestTimeoutMs, signal });
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

function sandboxCommandEnvironment(timeoutMs) {
  return {
    HOME: runnerHome,
    PATH: runnerPath,
    PROOFWEAVE_LEAN_EXECUTABLE_PATH: runnerLeanExecutable,
    PROOFWEAVE_LAKE_PACKAGES_ROOT: runnerDependencyPackagesRoot,
    PROOFWEAVE_NETWORK_ISOLATED: "true",
    PROOFWEAVE_RESOURCE_LIMITS_ENFORCED: "true",
    PROOFWEAVE_REQUEST_TIMEOUT_MS: String(timeoutMs),
  };
}

function requireSandboxCommands(sandbox) {
  if (!sandbox?.commands || typeof sandbox.commands.run !== "function") {
    throw new E2BSandboxContainerError("E2B Sandbox does not expose the reviewed command boundary.");
  }
}

async function prepareDependencyCache(sandbox, { timeoutMs, requestTimeoutMs, commandEnvironment, signal }) {
  requireSandboxCommands(sandbox);
  // E2B can remap imported-image ownership. Mathlib's ProofWidgets target
  // refreshes this generated marker during `lake build`, so the trusted
  // startup boundary repairs only this exact file before dropping back to the
  // unprivileged Runner user. The dependency tree remains read-only.
  await sandbox.commands.run(prepareDependencyCacheCommand, {
    cwd: "/opt/proofweave",
    user: "root",
    timeoutMs: Math.min(10_000, timeoutMs),
    requestTimeoutMs,
    signal,
    envs: commandEnvironment,
  });
}

async function probeSandboxRuntime(sandbox, { timeoutMs, requestTimeoutMs, commandEnvironment, signal }) {
  requireSandboxCommands(sandbox);
  await sandbox.commands.run(`${runnerLeanExecutable} --version`, {
    cwd: "/opt/proofweave",
    user: runnerUser,
    timeoutMs: Math.min(10_000, timeoutMs),
    requestTimeoutMs,
    signal,
    envs: commandEnvironment,
  });
}

async function spawnSandboxServer(sandbox, { timeoutMs, requestTimeoutMs, commandEnvironment, signal }) {
  requireSandboxCommands(sandbox);
  await sandbox.commands.run(
    "node /opt/proofweave/services/lean-runner/container-http-server.mjs",
    {
      background: true,
      cwd: "/opt/proofweave",
      user: runnerUser,
      timeoutMs: Math.min(3_600_000, timeoutMs + 30_000),
      requestTimeoutMs,
      signal,
      envs: commandEnvironment,
    },
  );
}

function remainingStartupMilliseconds(deadline, monotonicNow) {
  const remaining = Math.ceil(deadline - finiteMonotonic(monotonicNow()));
  if (remaining <= 0) {
    throw startupTimeoutError();
  }
  return Math.min(120_000, remaining);
}

function startupTimeoutError(cause) {
  return new E2BSandboxContainerError("E2B Lean Sandbox exceeded its end-to-end startup timeout.", cause ? { cause } : undefined);
}

function abortStartupOnFailure(promise, controller) {
  return Promise.resolve(promise).catch((error) => {
    if (!controller.signal.aborted) controller.abort(error);
    throw error;
  });
}

function raceAgainstStartupSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason ?? startupTimeoutError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? startupTimeoutError());
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

async function boundedProviderKill(sandbox, timeoutMs) {
  if (!sandbox || typeof sandbox.kill !== "function") return false;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error("E2B Sandbox cleanup exceeded its bounded timeout.")),
    boundedRequestTimeout(timeoutMs),
  );
  try {
    await Promise.race([
      sandbox.kill({ requestTimeoutMs: boundedRequestTimeout(timeoutMs), signal: controller.signal }),
      new Promise((_resolve, reject) => controller.signal.addEventListener(
        "abort",
        () => reject(controller.signal.reason),
        { once: true },
      )),
    ]);
    // E2B resolves `false` when the Sandbox is already absent. Both `true`
    // and `false` therefore confirm that no live provider resource remains.
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForCleanup(cleanupPromise, timeoutMs) {
  let timeout;
  try {
    await Promise.race([
      cleanupPromise,
      new Promise((resolve) => { timeout = setTimeout(resolve, timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function elapsedMilliseconds(started, value) {
  return Math.max(0, Math.min(86_400_000, Math.round(finiteMonotonic(value) - started)));
}

function finiteMonotonic(value) {
  if (!Number.isFinite(value)) {
    throw new E2BSandboxContainerError("E2B runner clock returned an invalid monotonic timestamp.");
  }
  return value;
}

function boundedRequestTimeout(value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new E2BSandboxContainerError("E2B private request timeout is invalid.");
  }
  return Math.min(120_000, Math.max(1, Math.ceil(value)));
}

function safeObservePhase(observe, phase, durationMs, outcome) {
  try {
    const pending = observe(Object.freeze({ phase, durationMs, outcome }));
    if (pending && typeof pending.then === "function") Promise.resolve(pending).catch(() => {});
  } catch {
    // Optional observability must never alter Sandbox creation.
  }
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
