import assert from "node:assert/strict";
import test from "node:test";
import { createQueuedRun, markRunStarted } from "../packages/domain/run.mjs";
import { leanRunnerRequestHash } from "../packages/protocol/lean-runner.mjs";
import { createRunnerQueueMessage } from "../services/lean-runner/queue.mjs";
import {
  RunnerJobPreflight,
  RunnerJobPreflightError,
} from "../services/lean-runner/runner-job-preflight.mjs";

test("preflight binds an authenticated message to one queued D1 Run before claiming it", async () => {
  const { message, request } = await fixtureMessage();
  const runStore = new MemoryRunStore(await fixtureRun(request));
  const resolvedBundle = Object.freeze({ bundle: Object.freeze({ id: "bundle:preflight" }) });
  const resolver = new MemoryBundleResolver(resolvedBundle);
  const preflight = new RunnerJobPreflight({ runStore, bundleResolver: resolver });

  const claimed = await preflight.claimAuthenticatedMessage(message, { startedAt: "2026-07-13T00:00:01Z" });
  assert.equal(claimed.action, "execute");
  assert.equal(claimed.run.state, "running");
  assert.equal(claimed.resolvedBundle, resolvedBundle);
  assert.equal(resolver.requests.length, 1);
  assert.equal(runStore.startCalls, 1);

  const duplicate = await preflight.claimAuthenticatedMessage(message, { startedAt: "2026-07-13T00:00:02Z" });
  assert.deepEqual(duplicate, {
    action: "skip",
    reason: "run_running",
    run: runStore.run,
    message: null,
    resolvedBundle: null,
  });
  assert.equal(resolver.requests.length, 1);
});

test("preflight rejects a signed message that disagrees with persisted Run evidence", async () => {
  const { message, request } = await fixtureMessage();
  const run = await fixtureRun(request);
  const runStore = new MemoryRunStore({ ...run, artifactBundleHash: sha("f") });
  const resolver = new MemoryBundleResolver(Object.freeze({}));
  const preflight = new RunnerJobPreflight({ runStore, bundleResolver: resolver });

  await assert.rejects(
    preflight.claimAuthenticatedMessage(message, { startedAt: "2026-07-13T00:00:01Z" }),
    RunnerJobPreflightError,
  );
  assert.equal(resolver.requests.length, 0);
  assert.equal(runStore.startCalls, 0);
});

test("a concurrent claim is skipped instead of starting another Container", async () => {
  const { message, request } = await fixtureMessage();
  const queued = await fixtureRun(request);
  const runStore = new MemoryRunStore(markRunStarted(queued, "2026-07-13T00:00:01Z"));
  const resolver = new MemoryBundleResolver(Object.freeze({}));
  const preflight = new RunnerJobPreflight({ runStore, bundleResolver: resolver });

  const result = await preflight.claimAuthenticatedMessage(message, { startedAt: "2026-07-13T00:00:02Z" });
  assert.equal(result.action, "skip");
  assert.equal(result.reason, "run_running");
  assert.equal(resolver.requests.length, 0);
  assert.equal(runStore.startCalls, 0);
});

class MemoryRunStore {
  constructor(run) {
    this.run = run;
    this.startCalls = 0;
  }

  async find(runId) {
    return this.run.id === runId ? this.run : null;
  }

  async start(runId, startedAt) {
    assert.equal(runId, this.run.id);
    this.startCalls += 1;
    this.run = markRunStarted(this.run, startedAt);
    return this.run;
  }
}

class MemoryBundleResolver {
  constructor(result) {
    this.result = result;
    this.requests = [];
  }

  async resolve(request) {
    this.requests.push(request);
    return this.result;
  }
}

async function fixtureMessage() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const request = {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:preflight",
    idempotencyKey: "preflight-idempotency",
    attemptId: "attempt:preflight",
    bundle: {
      objectKey: `bundles/sha256/${"a".repeat(64)}/bundle.json`,
      contentHash: sha("a"),
      manifestHash: sha("a"),
      entryCommand: ["lake", "env", "lean", "Proofweave/Preflight.lean"],
    },
    environment: {
      imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
      leanToolchain: "leanprover/lean4:v4.30.0",
      mathlibRevision: "fixture-mathlib",
      network: "disabled",
    },
    limits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  const message = await createRunnerQueueMessage({
    runId: request.jobId,
    request,
    enqueuedAt: "2026-07-13T00:00:00Z",
    controlPlaneKeyId: "control-plane:preflight",
    controlPlanePrivateKey: pair.privateKey,
  });
  return { message, request };
}

async function fixtureRun(request) {
  return createQueuedRun({
    id: request.jobId,
    attemptId: request.attemptId,
    idempotencyKey: request.idempotencyKey,
    requestHash: await leanRunnerRequestHash(request),
    artifactBundleHash: request.bundle.manifestHash,
    queuedAt: "2026-07-13T00:00:00Z",
  });
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
