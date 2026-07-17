import assert from "node:assert/strict";
import test from "node:test";
import { leanRunnerRequestHash } from "../packages/protocol/lean-runner.mjs";
import {
  RunnerContainerExecutionClient,
  RunnerContainerExecutionClientError,
} from "../services/lean-runner/runner-container-execution-client.mjs";

test("Worker execution client binds private Container result and byte streams to an active Run", async () => {
  const request = fixtureRequest();
  const requestHash = await leanRunnerRequestHash(request);
  const stdout = new TextEncoder().encode("lean output\n");
  const stderr = new Uint8Array();
  const result = await fixtureResult({ requestHash, stdout, stderr });
  const calls = [];
  const container = {
    async fetch(requestObject) {
      const url = new URL(requestObject.url);
      calls.push(`${requestObject.method} ${url.pathname}`);
      if (url.pathname.endsWith("/workspace/execute")) {
        return json({ result, outputTruncated: false, workspaceTreeHash: sha("c") });
      }
      if (url.pathname.endsWith("/stdout")) return output(stdout, result.artifacts.stdoutHash);
      if (url.pathname.endsWith("/stderr")) return output(stderr, result.artifacts.stderrHash);
      if (url.pathname.endsWith("/workspace/complete")) return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    },
  };

  const execution = await new RunnerContainerExecutionClient().execute({
    container,
    run: fixtureRun(requestHash),
    request,
  });

  assert.deepEqual(execution.result, result);
  assert.deepEqual(execution.stdout, stdout);
  assert.deepEqual(execution.stderr, stderr);
  assert.equal(calls[0], "POST /v1/runs/run%3Acontainer-client/workspace/execute");
  assert.deepEqual(calls.slice(1).sort(), [
    "GET /v1/runs/run%3Acontainer-client/workspace/result/stdout",
    "GET /v1/runs/run%3Acontainer-client/workspace/result/stderr",
    "POST /v1/runs/run%3Acontainer-client/workspace/complete",
  ].sort());
});

test("Worker execution client rejects a substituted private output stream", async () => {
  const request = fixtureRequest();
  const requestHash = await leanRunnerRequestHash(request);
  const stdout = new TextEncoder().encode("lean output\n");
  const stderr = new Uint8Array();
  const result = await fixtureResult({ requestHash, stdout, stderr });
  const container = {
    async fetch(requestObject) {
      const path = new URL(requestObject.url).pathname;
      if (path.endsWith("/workspace/execute")) return json({ result, outputTruncated: false, workspaceTreeHash: sha("c") });
      if (path.endsWith("/stdout")) return output(stdout, sha("f"));
      return output(stderr, result.artifacts.stderrHash);
    },
  };

  await assert.rejects(
    new RunnerContainerExecutionClient().execute({ container, run: fixtureRun(requestHash), request }),
    RunnerContainerExecutionClientError,
  );
});

test("Worker cancellation client can target only the active Run's private Container route", async () => {
  const calls = [];
  const container = {
    async fetch(requestObject) {
      calls.push(`${requestObject.method} ${new URL(requestObject.url).pathname}`);
      return new Response(null, { status: 204 });
    },
  };

  await new RunnerContainerExecutionClient().cancel({
    container,
    run: fixtureRun(sha("c")),
  });

  assert.deepEqual(calls, ["POST /v1/runs/run%3Acontainer-client/workspace/cancel"]);
  await assert.rejects(
    new RunnerContainerExecutionClient().cancel({ container, run: { ...fixtureRun(sha("c")), state: "succeeded" } }),
    RunnerContainerExecutionClientError,
  );
});

function fixtureRequest() {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:container-client",
    idempotencyKey: "container-client",
    attemptId: "attempt:container-client",
    bundle: {
      objectKey: `bundles/sha256/${"a".repeat(64)}/bundle.json`,
      contentHash: sha("a"),
      manifestHash: sha("a"),
      entryCommand: ["lake", "env", "lean", "Proofweave/Client.lean"],
    },
    environment: {
      imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
      leanToolchain: "leanprover/lean4:v4.30.0",
      mathlibRevision: "fixture-mathlib",
      network: "disabled",
    },
    limits: { cpuSeconds: 10, wallSeconds: 20, memoryMiB: 512, diskMiB: 512, outputBytes: 1_000_000 },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
}

async function fixtureResult({ requestHash, stdout, stderr }) {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:container-client",
    attemptId: "attempt:container-client",
    requestHash,
    status: "succeeded",
    exitCode: 0,
    startedAt: "2026-07-13T00:00:00Z",
    finishedAt: "2026-07-13T00:00:01Z",
    kernelStatus: "accepted",
    checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: { manifestHash: sha("a"), stdoutHash: await sha256(stdout), stderrHash: await sha256(stderr) },
  };
}

function fixtureRun(requestHash) {
  return {
    id: "run:container-client",
    attemptId: "attempt:container-client",
    requestHash,
    artifactBundleHash: sha("a"),
    state: "running",
  };
}

function output(bytes, contentHash) {
  return new Response(bytes, { status: 200, headers: { "x-proofweave-content-sha256": contentHash } });
}

function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
