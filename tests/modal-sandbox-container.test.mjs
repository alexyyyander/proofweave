import assert from "node:assert/strict";
import test from "node:test";
import {
  ModalSandboxContainerError,
  ModalSandboxContainerFactory,
} from "../services/lean-runner/modal-sandbox-container.mjs";

const imageReference = `registry.example/proofweave/lean-runner@sha256:${"a".repeat(64)}`;
const resources = {
  cpu: 0.5,
  cpuLimit: 1,
  memoryMiB: 512,
  memoryLimitMiB: 1_024,
  timeoutMs: 120_000,
  idleTimeoutMs: 30_000,
};

test("Modal adapter creates one no-egress Sandbox and keeps its Connect Token outside", async () => {
  const observed = [];
  const modal = fakeModalClient();
  const factory = new ModalSandboxContainerFactory({
    client: modal.client,
    appName: "proofweave-alpha",
    imageReference,
    resources,
    resourcePolicyReviewed: true,
    fetcher: async (url, init) => {
      observed.push({ url: url.toString(), init });
      return new Response("accepted", { status: 202 });
    },
  });
  const container = await factory.get("run:modal-1");
  const response = await container.fetch(new Request(
    `${"https://proofweave-runner.internal"}/v1/runs/run%3Amodal-1/workspace`,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "must-not-forward" },
      body: "{}",
    },
  ));

  assert.equal(response.status, 202);
  assert.deepEqual(modal.appLookup, { name: "proofweave-alpha", options: { createIfMissing: false } });
  assert.equal(modal.imageReference, imageReference);
  assert.equal(modal.createOptions.blockNetwork, true);
  assert.equal(modal.createOptions.memoryLimitMiB, 1_024);
  assert.equal(modal.createOptions.env.PROOFWEAVE_NETWORK_ISOLATED, "true");
  assert.equal(modal.createOptions.env.PROOFWEAVE_RESOURCE_LIMITS_ENFORCED, "true");
  assert.equal(modal.connectOptions.userMetadata, JSON.stringify({ protocolVersion: "pw-modal-connect-v1", runId: "run:modal-1" }));
  assert.equal(observed[0].url, "https://connect.modal.test/v1/runs/run%3Amodal-1/workspace");
  assert.equal(observed[0].init.headers.get("authorization"), "Bearer modal-connect-token-1234567890");
  assert.equal(observed[0].init.headers.get("cookie"), null);
  assert.equal(JSON.stringify(modal.createOptions).includes("modal-connect-token"), false);
  await factory.close();
  assert.equal(modal.terminated, 1);
});

test("Modal adapter binds the Sandbox to one Run and terminates after completion", async () => {
  const modal = fakeModalClient();
  const factory = new ModalSandboxContainerFactory({
    client: modal.client,
    appName: "proofweave-alpha",
    imageReference,
    resources,
    resourcePolicyReviewed: true,
    fetcher: async () => new Response(null, { status: 204 }),
  });
  const container = await factory.get("run:modal-2");
  await assert.rejects(
    container.fetch(new Request("https://proofweave-runner.internal/v1/runs/run%3Aother/workspace")),
    /bound Run/,
  );
  const completed = await container.fetch(new Request(
    "https://proofweave-runner.internal/v1/runs/run%3Amodal-2/workspace/complete",
    { method: "POST" },
  ));
  assert.equal(completed.status, 204);
  assert.equal(modal.terminated, 1);
  await assert.rejects(
    container.fetch(new Request("https://proofweave-runner.internal/v1/runs/run%3Amodal-2/workspace")),
    /already terminated/,
  );
});

test("Modal adapter fails closed for mutable images and unreviewed resource policy", () => {
  const modal = fakeModalClient();
  assert.throws(() => new ModalSandboxContainerFactory({
    client: modal.client,
    appName: "proofweave-alpha",
    imageReference: "registry.example/proofweave/lean-runner:latest",
    resources,
    resourcePolicyReviewed: true,
  }), /sha256/);
  assert.throws(() => new ModalSandboxContainerFactory({
    client: modal.client,
    appName: "proofweave-alpha",
    imageReference,
    resources,
    resourcePolicyReviewed: false,
  }), ModalSandboxContainerError);
});

function fakeModalClient() {
  const state = {
    appLookup: null,
    imageReference: null,
    createOptions: null,
    connectOptions: null,
    terminated: 0,
  };
  const sandbox = {
    async waitUntilReady() {},
    async createConnectToken(options) {
      state.connectOptions = options;
      return { url: "https://connect.modal.test", token: "modal-connect-token-1234567890" };
    },
    async terminate() { state.terminated += 1; },
  };
  state.client = {
    apps: {
      async fromName(name, options) {
        state.appLookup = { name, options };
        return { appId: "app-1" };
      },
    },
    images: {
      fromRegistry(reference) {
        state.imageReference = reference;
        return { imageId: "image-1" };
      },
    },
    sandboxes: {
      async create(_app, _image, options) {
        state.createOptions = options;
        return sandbox;
      },
    },
  };
  return state;
}
