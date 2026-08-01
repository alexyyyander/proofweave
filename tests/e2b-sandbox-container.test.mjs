import assert from "node:assert/strict";
import test from "node:test";
import {
  createE2BSandboxContainerFactoryFromEnvironment,
  E2BSandboxContainer,
  E2BSandboxContainerError,
  E2BSandboxContainerFactory,
} from "../services/lean-runner/e2b-sandbox-container.mjs";

const imageReference = "registry.example/proofweave/lean-runner@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const apiKey = "e2b_test_api_key_1234567890";
const templateId = "template_proofweave_lean_v1";
const templateTag = "commit_0123456789abcdef";
const templateReference = `${templateId}:${templateTag}`;
const templateBuildId = "9420e83e-3c6d-48b8-94fe-a73807af5797";
const immutableTemplateReference = `${templateId}:${templateBuildId}`;

test("E2B adapter creates one secure no-egress Sandbox and keeps control credentials outside", async () => {
  const e2b = fakeE2B();
  const forwarded = [];
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async (url, options) => {
      forwarded.push({ url: String(url), options });
      return new Response(null, { status: 204 });
    },
  });

  const container = await factory.get("run:e2b-1");
  assert.equal(e2b.templateId, immutableTemplateReference);
  assert.equal(e2b.createOptions.apiKey, apiKey);
  assert.equal(e2b.createOptions.secure, true);
  assert.equal(e2b.createOptions.allowInternetAccess, false);
  assert.deepEqual(e2b.createOptions.network, {
    allowPublicTraffic: false,
    denyOut: ["0.0.0.0/0"],
  });
  assert.deepEqual(e2b.createOptions.lifecycle, { onTimeout: "kill" });
  assert.equal(e2b.createOptions.envs.PROOFWEAVE_NETWORK_ISOLATED, "true");
  assert.equal(e2b.createOptions.envs.PROOFWEAVE_RESOURCE_LIMITS_ENFORCED, "true");
  assert.equal(e2b.createOptions.envs.PROOFWEAVE_REQUEST_TIMEOUT_MS, "120000");
  assert.equal(Object.values(e2b.createOptions.envs).includes(apiKey), false);
  assert.equal(JSON.stringify(e2b.createOptions.metadata).includes("run:e2b-1"), false);
  assert.equal(
    e2b.dependencyCacheCommand,
    "touch /opt/proofweave/lake-packages/proofwidgets/widget/package-lock.json.hash && chown proofweave:proofweave /opt/proofweave/lake-packages/proofwidgets/widget/package-lock.json.hash && chmod 0644 /opt/proofweave/lake-packages/proofwidgets/widget/package-lock.json.hash",
  );
  assert.equal(e2b.dependencyCacheOptions.user, "root");
  assert.equal(e2b.runtimeProbeCommand, "/opt/lean/bin/lake --version");
  assert.equal(e2b.runtimeProbeOptions.user, "proofweave");
  assert.equal(e2b.serverCommand, "node /opt/proofweave/services/lean-runner/container-http-server.mjs");
  assert.equal(e2b.serverOptions.background, true);
  assert.equal(e2b.serverOptions.user, "proofweave");
  assert.equal(e2b.serverOptions.envs.HOME, "/home/proofweave");
  assert.equal(e2b.serverOptions.envs.PATH.startsWith("/opt/lean/bin:"), true);
  assert.equal(e2b.serverOptions.envs.PROOFWEAVE_LEAN_EXECUTABLE_PATH, "/opt/lean/bin/lake");
  assert.equal(e2b.serverOptions.envs.PROOFWEAVE_LAKE_PACKAGES_ROOT, "/opt/proofweave/lake-packages");
  assert.equal(e2b.serverOptions.envs.PROOFWEAVE_NETWORK_ISOLATED, "true");
  assert.equal(e2b.serverOptions.envs.PROOFWEAVE_REQUEST_TIMEOUT_MS, "120000");
  assert.equal(forwarded[0].url, "https://8080-sandbox.e2b.test/ready");
  assert.equal(forwarded[0].options.headers.get("e2b-traffic-access-token"), "e2b-traffic-token-1234567890");
  assert.equal(forwarded[0].options.signal instanceof AbortSignal, true);

  const response = await container.fetch(new Request(
    "https://proofweave-runner.internal/v1/runs/run%3Ae2b-1/workspace",
    { method: "POST", body: "{}", headers: { authorization: "must-not-forward", "content-type": "application/json" } },
  ));
  assert.equal(response.status, 204);
  assert.equal(forwarded[1].url, "https://8080-sandbox.e2b.test/v1/runs/run%3Ae2b-1/workspace");
  assert.equal(forwarded[1].options.headers.has("authorization"), false);
  assert.equal(forwarded[1].options.headers.get("e2b-traffic-access-token"), "e2b-traffic-token-1234567890");
  assert.equal(await factory.get("run:e2b-1"), container);
  await factory.close();
  assert.equal(e2b.killed, 1);
});

test("E2B adapter overlaps independent startup checks and emits privacy-safe phase timings", async () => {
  const e2b = fakeE2B();
  const originalGetTags = e2b.templateApi.getTags;
  const originalCreate = e2b.api.create;
  const originalGetInfo = e2b.sandbox.getInfo;
  const originalRun = e2b.sandbox.commands.run;
  const tagStarted = deferred();
  const createStarted = deferred();
  const infoStarted = deferred();
  const repairStarted = deferred();
  e2b.templateApi.getTags = async (...args) => {
    tagStarted.resolve();
    await boundedBarrier(createStarted.promise);
    return originalGetTags(...args);
  };
  e2b.api.create = async (...args) => {
    createStarted.resolve();
    await boundedBarrier(tagStarted.promise);
    return originalCreate(...args);
  };
  e2b.sandbox.getInfo = async (...args) => {
    infoStarted.resolve();
    await boundedBarrier(repairStarted.promise);
    return originalGetInfo(...args);
  };
  e2b.sandbox.commands.run = async (command, options) => {
    if (command.startsWith("touch ")) {
      repairStarted.resolve();
      await boundedBarrier(infoStarted.promise);
    }
    return originalRun(command, options);
  };
  const phases = [];
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
    observePhase: (record) => {
      phases.push(record);
      return Promise.reject(new Error("telemetry sink unavailable"));
    },
  });

  await factory.get("run:e2b-parallel");
  assert.deepEqual(new Set(phases.map((record) => record.phase)), new Set([
    "e2b_template_assert",
    "e2b_sandbox_create",
    "e2b_isolation_assert",
    "e2b_cache_marker_repair",
    "e2b_runtime_probe",
    "e2b_server_spawn",
    "e2b_ready_wait",
  ]));
  assert.equal(phases.every((record) => Number.isSafeInteger(record.durationMs)), true);
  assert.equal(phases.every((record) => record.outcome === "completed"), true);
  assert.equal(JSON.stringify(phases).includes("run:e2b-parallel"), false);
  await factory.close();
});

test("E2B adapter kills a concurrently created Sandbox when the reviewed tag drifts", async () => {
  const e2b = fakeE2B();
  e2b.templateApi.getTags = async () => [{ tag: templateTag, buildId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }];
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });

  await assert.rejects(factory.get("run:e2b-tag-drift"), /tag no longer resolves/);
  assert.equal(e2b.killed, 1);
  assert.equal(e2b.serverCommand, undefined);
});

test("E2B adapter enforces one end-to-end startup deadline and destroys the Sandbox on timeout", async () => {
  const e2b = fakeE2B();
  let clockReads = 0;
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 1_000,
    resourcePolicyReviewed: true,
    monotonicNow: () => (clockReads++ < 5 ? 0 : 2_000),
    fetcher: async () => new Response(null, { status: 204 }),
  });

  await assert.rejects(factory.get("run:e2b-startup-timeout"), /end-to-end startup timeout/);
  assert.equal(e2b.killed, 1);
  assert.equal(e2b.serverCommand, undefined);
});

test("E2B adapter aborts a hanging provider create at the total deadline and kills a late Sandbox", async () => {
  const e2b = fakeE2B();
  const originalCreate = e2b.api.create;
  let releaseCreation;
  e2b.api.create = async (requestedTemplateId, options) => {
    e2b.templateId = requestedTemplateId;
    e2b.createOptions = options;
    return new Promise((resolve) => {
      releaseCreation = () => resolve(e2b.sandbox);
    });
  };
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 1_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });

  await assert.rejects(factory.get("run:e2b-hanging-create"), /end-to-end startup timeout/);
  await assert.rejects(factory.get("run:e2b-second"), /only one active Sandbox/);
  releaseCreation();
  await waitFor(() => e2b.killed === 1);
  e2b.api.create = originalCreate;
  await factory.get("run:e2b-after-cleanup");
  await factory.close();
});

test("E2B adapter retains a fail-closed fence until failed cleanup is retried", async () => {
  const e2b = fakeE2B();
  const originalKill = e2b.sandbox.kill;
  e2b.templateApi.getTags = async () => [{ tag: templateTag, buildId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }];
  e2b.sandbox.kill = async () => { throw new Error("provider cleanup unavailable"); };
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });

  await assert.rejects(factory.get("run:e2b-cleanup-fence"), /tag no longer resolves/);
  await assert.rejects(factory.get("run:e2b-blocked"), /only one active Sandbox/);
  e2b.sandbox.kill = originalKill;
  e2b.templateApi.getTags = async () => [{ tag: templateTag, buildId: templateBuildId }];
  await factory.get("run:e2b-after-retry");
  await factory.close();
  assert.equal(e2b.killed, 2);
});

test("E2B adapter keeps the active fence when completion cleanup fails", async () => {
  const e2b = fakeE2B();
  const originalKill = e2b.sandbox.kill;
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });
  const container = await factory.get("run:e2b-complete-cleanup");
  e2b.sandbox.kill = async () => { throw new Error("provider cleanup unavailable"); };

  await assert.rejects(
    container.fetch(new Request(
      "https://proofweave-runner.internal/v1/runs/run%3Ae2b-complete-cleanup/workspace/complete",
      { method: "POST" },
    )),
    /cleanup could not be confirmed/,
  );
  await assert.rejects(factory.get("run:e2b-complete-blocked"), /only one active Sandbox/);
  e2b.sandbox.kill = originalKill;
  await factory.get("run:e2b-complete-after-retry");
  await factory.close();
  assert.equal(e2b.killed, 2);
});

test("E2B adapter treats provider not-found cleanup as an already absent Sandbox", async () => {
  const e2b = fakeE2B();
  e2b.templateApi.getTags = async () => [{ tag: templateTag, buildId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }];
  e2b.sandbox.kill = async () => false;
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });

  await assert.rejects(factory.get("run:e2b-not-found-cleanup"), /tag no longer resolves/);
  e2b.templateApi.getTags = async () => [{ tag: templateTag, buildId: templateBuildId }];
  await factory.get("run:e2b-not-found-after-cleanup");
  await factory.close();
  assert.equal(e2b.killed, 0);
});

test("E2B adapter single-flights concurrent completion and factory cleanup", async () => {
  const e2b = fakeE2B();
  const killStarted = deferred();
  const releaseKill = deferred();
  e2b.sandbox.kill = async () => {
    killStarted.resolve();
    return releaseKill.promise;
  };
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });
  const container = await factory.get("run:e2b-single-flight");
  const terminating = container.terminate();
  await killStarted.promise;
  let closeFinished = false;
  const closing = factory.close().then(() => { closeFinished = true; });
  await Promise.resolve();
  assert.equal(closeFinished, false);
  releaseKill.resolve(true);
  await Promise.all([terminating, closing]);
  assert.equal(closeFinished, true);
});

test("E2B adapter close retries a single-flight cleanup rejection through quarantine", async () => {
  const e2b = fakeE2B();
  const originalKill = e2b.sandbox.kill;
  const killStarted = deferred();
  const releaseKill = deferred();
  e2b.sandbox.kill = async () => {
    killStarted.resolve();
    return releaseKill.promise;
  };
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });
  const container = await factory.get("run:e2b-single-flight-retry");
  const terminating = container.terminate();
  await killStarted.promise;
  e2b.sandbox.kill = originalKill;
  const closing = factory.close();
  releaseKill.reject(new Error("provider cleanup unavailable"));
  await assert.rejects(terminating, /cleanup could not be confirmed/);
  await closing;
  assert.equal(e2b.killed, 1);
});

test("E2B adapter binds one Run, terminates on completion, and fails closed on provider isolation drift", async () => {
  const e2b = fakeE2B();
  const factory = new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });
  const container = await factory.get("run:e2b-2");
  await assert.rejects(
    container.fetch(new Request("https://proofweave-runner.internal/v1/runs/run%3Aother/workspace")),
    /bound Run/,
  );
  const completed = await container.fetch(new Request(
    "https://proofweave-runner.internal/v1/runs/run%3Ae2b-2/workspace/complete",
    { method: "POST" },
  ));
  assert.equal(completed.status, 204);
  assert.equal(e2b.killed, 1);
  await assert.rejects(
    container.fetch(new Request("https://proofweave-runner.internal/v1/runs/run%3Ae2b-2/workspace")),
    /already terminated/,
  );

  const drifted = fakeE2B({ allowInternetAccess: true });
  const driftedFactory = new E2BSandboxContainerFactory({
    sandboxApi: drifted.api,
    templateApi: drifted.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 200 }),
  });
  await assert.rejects(driftedFactory.get("run:e2b-drift"), /disabled Internet access/);
  assert.equal(drifted.killed, 1);

  const mutableAlias = fakeE2B({ reportedTemplateId: "template_unreviewed_build" });
  const mutableAliasFactory = new E2BSandboxContainerFactory({
    sandboxApi: mutableAlias.api,
    templateApi: mutableAlias.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 200 }),
  });
  await assert.rejects(mutableAliasFactory.get("run:e2b-alias"), /immutable template id/);
  assert.equal(mutableAlias.killed, 1);
});

test("E2B adapter requires a pinned image, reviewed policy, private traffic token, and complete environment", async () => {
  const e2b = fakeE2B();
  assert.throws(() => new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference: "registry.example/proofweave/lean-runner:latest",
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
  }), /sha256/);
  assert.throws(() => new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: false,
  }), E2BSandboxContainerError);

  const missingTrafficToken = fakeE2B({ trafficAccessToken: "" });
  const missingTokenFactory = new E2BSandboxContainerFactory({
    sandboxApi: missingTrafficToken.api,
    templateApi: missingTrafficToken.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 120_000,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 200 }),
  });
  await assert.rejects(missingTokenFactory.get("run:e2b-token"), /traffic access token/);
  assert.equal(missingTrafficToken.killed, 1);

  assert.throws(() => createE2BSandboxContainerFactoryFromEnvironment({
    environment: {
      E2B_API_KEY: apiKey,
      PROOFWEAVE_E2B_TEMPLATE_ID: templateReference,
      PROOFWEAVE_E2B_TEMPLATE_BUILD_ID: templateBuildId,
      PROOFWEAVE_E2B_RUNNER_IMAGE: imageReference,
      PROOFWEAVE_E2B_RESOURCE_POLICY_REVIEWED: "true",
      PROOFWEAVE_E2B_CPU: "2",
      PROOFWEAVE_E2B_MEMORY_MB: "2048",
      PROOFWEAVE_E2B_TIMEOUT_MS: "120000",
    },
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
  }), /STARTUP_TIMEOUT/);

  assert.throws(() => new E2BSandboxContainerFactory({
    sandboxApi: e2b.api,
    templateApi: e2b.templateApi,
    apiKey,
    templateId: templateReference,
    templateBuildId,
    imageReference,
    cpuCount: 2,
    memoryMB: 2_048,
    timeoutMs: 1_260_001,
    startupTimeoutMs: 10_000,
    resourcePolicyReviewed: true,
  }), /between 1000 and 1260000/);
});

test("E2B adapter bounds each authenticated private Sandbox request", async () => {
  const sandbox = {
    trafficAccessToken: "e2b-traffic-token-1234567890",
    async kill() {},
    getHost(port) { return `${port}-sandbox.e2b.test`; },
  };
  const container = new E2BSandboxContainer({
    sandbox,
    token: sandbox.trafficAccessToken,
    runId: "run:e2b-timeout",
    port: 8080,
    requestTimeoutMs: 1_000,
    fetcher: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }),
    sleep: async () => {},
    onTerminated: () => {},
  });
  const startedAt = Date.now();
  await assert.rejects(
    container.fetch(new Request("https://proofweave-runner.internal/v1/runs/run%3Ae2b-timeout/workspace")),
    /Authenticated E2B Sandbox request failed/,
  );
  assert.equal(Date.now() - startedAt < 2_000, true);
});

function fakeE2B({
  allowInternetAccess = false,
  allowPublicTraffic = false,
  trafficAccessToken = "e2b-traffic-token-1234567890",
  reportedTemplateId,
} = {}) {
  const state = {
    templateId: null,
    createOptions: null,
    killed: 0,
  };
  state.templateApi = {
    async getTags(requestedTemplateId) {
      assert.equal(requestedTemplateId, templateId);
      return [{ tag: templateTag, buildId: templateBuildId }];
    },
  };
  const sandbox = {
    trafficAccessToken,
    commands: {
      async run(command, options) {
        if (command.startsWith("touch ")) {
          state.dependencyCacheCommand = command;
          state.dependencyCacheOptions = options;
        } else if (command.endsWith("lake --version")) {
          state.runtimeProbeCommand = command;
          state.runtimeProbeOptions = options;
        } else {
          state.serverCommand = command;
          state.serverOptions = options;
        }
        return { pid: 17 };
      },
    },
    getHost(port) { return `${port}-sandbox.e2b.test`; },
    async getInfo() {
      return {
        templateId: reportedTemplateId ?? templateId,
        allowInternetAccess,
        cpuCount: 2,
        memoryMB: 2_048,
        network: { allowPublicTraffic },
      };
    },
    async kill() { state.killed += 1; return true; },
  };
  state.sandbox = sandbox;
  state.api = {
    async create(templateId, options) {
      state.templateId = templateId;
      state.createOptions = options;
      return sandbox;
    },
  };
  return state;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

async function boundedBarrier(promise) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("startup phases did not overlap")), 250);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition did not become true");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
