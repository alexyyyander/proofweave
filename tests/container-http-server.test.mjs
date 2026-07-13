import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createLeanRunnerContainerProcess,
  createPrivateContainerHttpServer,
} from "../services/lean-runner/container-http-server.mjs";

test("private Container HTTP server preserves streaming Fetch requests and keeps readiness outside the ingress handler", async (t) => {
  const requests = [];
  let cleaned = false;
  const handler = async (request) => {
    requests.push({
      method: request.method,
      pathname: new URL(request.url).pathname,
      trace: request.headers.get("x-proofweave-trace"),
      body: await request.text(),
    });
    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "content-type": "application/json", "x-proofweave-result": "ok" },
    });
  };
  handler.cleanup = async () => { cleaned = true; };
  const processServer = createPrivateContainerHttpServer({ handler });
  let address;
  try {
    address = await processServer.listen({ host: "127.0.0.1", port: 0 });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("The current sandbox does not permit a loopback listener; CI runs this real HTTP adapter test.");
      return;
    }
    throw error;
  }
  assert.equal(typeof address, "object");
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const ready = await fetch(`${origin}/ready`);
    assert.equal(ready.status, 204);
    assert.equal(requests.length, 0);

    const response = await fetch(`${origin}/v1/runs/run%3Ahttp/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-proofweave-trace": "private" },
      body: JSON.stringify({ bounded: true }),
    });
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("x-proofweave-result"), "ok");
    assert.deepEqual(await response.json(), { accepted: true });
    assert.deepEqual(requests, [{
      method: "POST",
      pathname: "/v1/runs/run%3Ahttp/workspace",
      trace: "private",
      body: "{\"bounded\":true}",
    }]);
  } finally {
    await processServer.close();
  }
  assert.equal(cleaned, true);
});

test("Lean Container process fails closed until deployment proves both isolation layers", async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-container-process-"));
  try {
    assert.throws(
      () => createLeanRunnerContainerProcess({ environment: { PROOFWEAVE_NETWORK_ISOLATED: "true" } }),
      /CPU, memory, disk, and process limits/,
    );
    assert.throws(
      () => createLeanRunnerContainerProcess({ environment: { PROOFWEAVE_RESOURCE_LIMITS_ENFORCED: "true" } }),
      /disabled network access/,
    );

    const processServer = createLeanRunnerContainerProcess({
      environment: {
        PROOFWEAVE_NETWORK_ISOLATED: "true",
        PROOFWEAVE_RESOURCE_LIMITS_ENFORCED: "true",
        PROOFWEAVE_STAGING_ROOT: join(root, "staging"),
        PROOFWEAVE_WORKSPACE_ROOT: join(root, "workspaces"),
      },
    });
    await processServer.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("private Container server rejects broad listeners and invalid timeout configuration", async () => {
  assert.throws(
    () => createPrivateContainerHttpServer({ handler: async () => new Response(), requestTimeoutMilliseconds: 999 }),
    /timeout/,
  );
  const processServer = createPrivateContainerHttpServer({ handler: async () => new Response() });
  await assert.rejects(processServer.listen({ host: "example.test", port: 8080 }), /host/);
});
