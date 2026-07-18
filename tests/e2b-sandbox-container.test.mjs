import assert from "node:assert/strict";
import test from "node:test";
import {
  createE2BSandboxContainerFactoryFromEnvironment,
  E2BSandboxContainerError,
  E2BSandboxContainerFactory,
} from "../services/lean-runner/e2b-sandbox-container.mjs";

const imageReference = "registry.example/proofweave/lean-runner@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const apiKey = "e2b_test_api_key_1234567890";
const templateId = "template_proofweave_lean_v1";
const templateTag = "commit_0123456789abcdef";
const templateReference = `${templateId}:${templateTag}`;
const templateBuildId = "9420e83e-3c6d-48b8-94fe-a73807af5797";

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
      return new Response(null, { status: new URL(url).pathname === "/ready" ? 200 : 204 });
    },
  });

  const container = await factory.get("run:e2b-1");
  assert.equal(e2b.templateId, templateReference);
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
  assert.equal(Object.values(e2b.createOptions.envs).includes(apiKey), false);
  assert.equal(JSON.stringify(e2b.createOptions.metadata).includes("run:e2b-1"), false);
  assert.equal(e2b.serverCommand, "node /opt/proofweave/services/lean-runner/container-http-server.mjs");
  assert.equal(e2b.serverOptions.background, true);
  assert.equal(e2b.serverOptions.envs.PROOFWEAVE_NETWORK_ISOLATED, "true");
  assert.equal(forwarded[0].url, "https://8080-sandbox.e2b.test/ready");
  assert.equal(forwarded[0].options.headers.get("e2b-traffic-access-token"), "e2b-traffic-token-1234567890");

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
    fetcher: async (url) => new Response(null, { status: new URL(url).pathname === "/ready" ? 200 : 204 }),
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
        state.serverCommand = command;
        state.serverOptions = options;
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
  state.api = {
    async create(templateId, options) {
      state.templateId = templateId;
      state.createOptions = options;
      return sandbox;
    },
  };
  return state;
}
