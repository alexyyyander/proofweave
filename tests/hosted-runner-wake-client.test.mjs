import assert from "node:assert/strict";
import test from "node:test";
import {
  HostedRunnerWakeClient,
  HostedRunnerWakeConfigurationError,
  HostedRunnerWakeError,
  HostedRunnerWakeUnconfirmedError,
} from "../services/lean-runner/hosted-runner-wake-client.mjs";

const wakeToken = "wake-token-0123456789abcdef-0123456789abcdef";
const hostToken = "host-token-0123456789abcdef-0123456789abcdef";

test("hosted Runner wake client authenticates both the private host and app endpoint", async () => {
  let request;
  const client = new HostedRunnerWakeClient({
    url: "https://proofweave-runner.example/v1/wake",
    wakeToken,
    hostAuthorizationToken: hostToken,
    fetcher: async (url, init) => {
      request = { url, init };
      return Response.json({ accepted: true }, { status: 202 });
    },
  });

  assert.deepEqual(await client.wake(), { state: "wake_accepted" });
  assert.equal(request.url, "https://proofweave-runner.example/v1/wake");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.redirect, "error");
  assert.equal(request.init.headers.authorization, `Bearer ${hostToken}`);
  assert.equal(request.init.headers["x-proofweave-wake-token"], wakeToken);
  assert.equal(request.init.body, undefined);
});

test("hosted Runner wake failures are privacy-safe and durable-queue compatible", async () => {
  const client = new HostedRunnerWakeClient({
    url: "https://proofweave-runner.example/v1/wake",
    wakeToken,
    fetcher: async () => new Response("private provider error", { status: 503 }),
  });
  await assert.rejects(() => client.wake(), (error) => {
    assert.ok(error instanceof HostedRunnerWakeError);
    assert.equal(error.diagnosticCode, "runner_wake_failed");
    assert.doesNotMatch(error.message, /private provider error/);
    return true;
  });
});

test("hosted Runner wake transport uncertainty preserves truthful durable-queue state", async () => {
  const client = new HostedRunnerWakeClient({
    url: "https://proofweave-runner.example/v1/wake",
    wakeToken,
    fetcher: async () => {
      throw new TypeError("provider connection timed out with private details");
    },
  });
  await assert.rejects(() => client.wake(), (error) => {
    assert.ok(error instanceof HostedRunnerWakeUnconfirmedError);
    assert.equal(error.diagnosticCode, "runner_wake_unconfirmed");
    assert.doesNotMatch(error.message, /private details/);
    return true;
  });
});

test("hosted Runner wake client accepts only an exact HTTPS wake route", () => {
  for (const url of [
    "http://proofweave-runner.example/v1/wake",
    "https://proofweave-runner.example/v1/wake?token=secret",
    "https://proofweave-runner.example/healthz",
  ]) {
    assert.throws(
      () => new HostedRunnerWakeClient({ url, wakeToken }),
      HostedRunnerWakeConfigurationError,
    );
  }
});

test("hosted Runner wake timeout accommodates free-host cold starts but remains bounded", () => {
  assert.doesNotThrow(() => new HostedRunnerWakeClient({
    url: "https://proofweave-runner.example/v1/wake",
    wakeToken,
    timeoutMilliseconds: 90_000,
  }));
  assert.throws(
    () => new HostedRunnerWakeClient({
      url: "https://proofweave-runner.example/v1/wake",
      wakeToken,
      timeoutMilliseconds: 90_001,
    }),
    HostedRunnerWakeConfigurationError,
  );
});
