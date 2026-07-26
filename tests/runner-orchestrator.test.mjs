import assert from "node:assert/strict";
import test from "node:test";
import { createQueuedRun } from "../packages/domain/run.mjs";
import {
  artifactBundleSigningPayload,
  artifactBundleSigningPayloadHash,
} from "../packages/protocol/artifact-bundle.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { RunnerOrchestrator, RunnerDispatchError } from "../services/lean-runner/orchestrator.mjs";
import { InMemoryRunnerQueue, RunnerJobAuthenticator } from "../services/lean-runner/queue.mjs";

test("orchestrator binds one signed Artifact Bundle to an idempotent Run and authenticated queue message", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = base64Url(await crypto.subtle.exportKey("raw", pair.publicKey));
  const queue = new InMemoryRunnerQueue();
  const runStore = new MemoryRunStore();
  const orchestrator = new RunnerOrchestrator({
    runStore,
    runnerQueue: queue,
    imageDigest: `ghcr.io/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
    defaultLimits: fixtureLimits(),
    controlPlaneKeyId: "control-plane:closed-alpha",
    controlPlanePrivateKey: pair.privateKey,
  });
  const artifactBundle = await fixtureBundle();

  const first = await orchestrator.queueArtifactBundle({
    runId: "run:orchestrator-1",
    idempotencyKey: "orchestrator-idempotency-1",
    artifactBundle,
    queuedAt: "2026-07-13T00:00:00Z",
  });
  const retry = await orchestrator.queueArtifactBundle({
    runId: "run:ignored-on-retry",
    idempotencyKey: "orchestrator-idempotency-1",
    artifactBundle,
    queuedAt: "2026-07-13T00:00:00Z",
  });

  assert.equal(first.runCreated, true);
  assert.equal(retry.runCreated, false);
  assert.equal(retry.run.id, first.run.id);
  assert.equal(retry.delivery.created, false);
  assert.equal(first.message.request.bundle.objectKey.includes("bundle.json"), true);
  assert.equal((await new RunnerJobAuthenticator({
    issuerKeys: [{ id: "control-plane:closed-alpha", publicKey }],
  }).authenticate(first.message)).runId, first.message.runId);
});

test("a queue delivery failure leaves the recorded Run safe to retry", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const runStore = new MemoryRunStore();
  const common = {
    runStore,
    imageDigest: `ghcr.io/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
    defaultLimits: fixtureLimits(),
    controlPlaneKeyId: "control-plane:closed-alpha",
    controlPlanePrivateKey: pair.privateKey,
  };
  const input = {
    runId: "run:orchestrator-retry",
    idempotencyKey: "orchestrator-retry-key",
    artifactBundle: await fixtureBundle(),
    queuedAt: "2026-07-13T00:00:00Z",
  };
  const failed = new RunnerOrchestrator({
    ...common,
    runnerQueue: { enqueue: async () => { throw new Error("provider unavailable"); } },
  });
  await assert.rejects(failed.queueArtifactBundle(input), RunnerDispatchError);
  assert.equal(runStore.runs.length, 1);

  const recovered = new RunnerOrchestrator({ ...common, runnerQueue: new InMemoryRunnerQueue() });
  const result = await recovered.queueArtifactBundle({ ...input, runId: "run:ignored-on-retry" });
  assert.equal(result.runCreated, false);
  assert.equal(result.delivery.created, true);
});

test("an exact idempotent retry redrives only the original dead-lettered Run", async () => {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const queue = new InMemoryRunnerQueue();
  const runStore = new MemoryRunStore();
  const orchestrator = new RunnerOrchestrator({
    runStore,
    runnerQueue: queue,
    imageDigest: `ghcr.io/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
    defaultLimits: fixtureLimits(),
    controlPlaneKeyId: "control-plane:closed-alpha",
    controlPlanePrivateKey: pair.privateKey,
  });
  const input = {
    runId: "run:orchestrator-redrive",
    idempotencyKey: "orchestrator-redrive-key",
    artifactBundle: await fixtureBundle(),
    queuedAt: "2026-07-13T00:00:00Z",
  };
  const first = await orchestrator.queueArtifactBundle(input);
  const claimed = await queue.claim({
    consumerId: "runner:redrive-fixture",
    claimedAt: "2026-07-13T00:00:01Z",
    leaseDurationSeconds: 30,
  });
  await queue.deadLetter({
    runId: first.run.id,
    leaseId: claimed.lease.id,
    deadLetteredAt: "2026-07-13T00:00:02Z",
    errorCode: "runner_image_policy_error",
  });

  const retried = await orchestrator.queueArtifactBundle({
    ...input,
    runId: "run:must-not-replace-original",
    queuedAt: "2026-07-13T00:00:03Z",
  });
  assert.equal(retried.runCreated, false);
  assert.equal(retried.run.id, first.run.id);
  assert.equal(retried.delivery.redriven, true);
  assert.equal(retried.delivery.deliveryState, "queued");
  const redrivenClaim = await queue.claim({
    consumerId: "runner:redrive-fixture",
    claimedAt: "2026-07-13T00:00:03Z",
    leaseDurationSeconds: 30,
  });
  assert.equal(redrivenClaim.message.runId, first.run.id);
  assert.equal(redrivenClaim.lease.deliveryAttempt, 1);
});

class MemoryRunStore {
  constructor() {
    this.runs = [];
  }

  async queue(input) {
    const next = createQueuedRun(input);
    const existing = this.runs.find((run) => (
      run.attemptId === next.attemptId && run.idempotencyKey === next.idempotencyKey
    ));
    if (existing) {
      assert.equal(existing.requestHash, next.requestHash, "idempotency key must preserve request evidence");
      assert.equal(existing.artifactBundleHash, next.artifactBundleHash, "idempotency key must preserve bundle evidence");
      return { run: existing, created: false };
    }
    this.runs.push(next);
    return { run: next, created: true };
  }

  async findByAttemptIdempotency(attemptId, idempotencyKey) {
    return this.runs.find((run) => (
      run.attemptId === attemptId && run.idempotencyKey === idempotencyKey
    )) ?? null;
  }
}

function fixtureLimits() {
  return { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 };
}

async function fixtureBundle() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v2",
    id: "bundle:orchestrator-1",
    attemptId: "attempt:orchestrator-1",
    problemRevisionId: "problem-revision:orchestrator-1",
    target: { declaration: "Proofweave.Orchestrator.target", statementHash: sha("a") },
    workspace: {
      archive: {
        objectKey: `bundles/sha256/${"b".repeat(64)}/source.tar.zst`,
        contentHash: sha("b"),
        format: "tar.zst",
        maxExpandedBytes: 64 * 1024 * 1024,
        maxFileCount: 10_000,
        symlinkPolicy: "forbidden",
      },
      patch: {
        objectKey: `bundles/sha256/${"d".repeat(64)}/normalized.patch`,
        contentHash: sha("d"),
        format: "unified-diff",
        strip: 1,
        allowFuzz: false,
      },
      tree: {
        hash: sha("c"),
        algorithm: "pw-tree-v1",
        state: "after_patch_and_lake_manifest",
      },
      lakeManifest: {
        objectKey: `bundles/sha256/${"e".repeat(64)}/lake-manifest.json`,
        contentHash: sha("e"),
        destination: "lake-manifest.json",
      },
    },
    environment: {
      leanToolchain: "leanprover/lean4:v4.27.0",
      mathlibRevision: "a3a10db0e9d6",
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Orchestrator.lean"],
    dependencyReceipts: [],
    agentEvent: {
      eventId: "agent-event:orchestrator-1",
      occurredAt: "2026-07-13T00:00:00Z",
      payloadHash: sha("f"),
      agentPublicKey: base64Url(await crypto.subtle.exportKey("raw", pair.publicKey)),
      signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    },
    policy: { requireNoSorry: true, allowedAxioms: [] },
  };
  bundle.agentEvent.payloadHash = await artifactBundleSigningPayloadHash(bundle);
  bundle.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    pair.privateKey,
    new TextEncoder().encode(canonicalJson(artifactBundleSigningPayload(bundle))),
  ));
  return bundle;
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
