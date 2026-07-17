import assert from "node:assert/strict";
import test from "node:test";
import { leanRunnerRequestHash } from "../packages/protocol/lean-runner.mjs";
import {
  RunnerWorkspaceTransfer,
  RunnerWorkspaceTransferError,
} from "../services/lean-runner/runner-workspace-transfer.mjs";

test("trusted Worker stages v2 workspace objects in a fixed private Container sequence", async () => {
  const objects = fixtureObjects();
  const bucket = new MemoryBucket(objects);
  const container = new MemoryContainer();
  const transfer = new RunnerWorkspaceTransfer({ bucket });
  const resolvedBundle = fixtureResolvedBundle(objects);

  const result = await transfer.stage({
    run: await fixtureRun(resolvedBundle),
    resolvedBundle,
    container,
  });

  assert.deepEqual(result.uploaded, ["sourceArchive", "sourcePatch", "lakeManifest"]);
  assert.deepEqual(container.requests.map((request) => request.pathname), [
    "/v1/runs/run%3Aworkspace-transfer/workspace",
    "/v1/runs/run%3Aworkspace-transfer/workspace/artifacts/source-archive",
    "/v1/runs/run%3Aworkspace-transfer/workspace/artifacts/source-patch",
    "/v1/runs/run%3Aworkspace-transfer/workspace/artifacts/lake-manifest",
    "/v1/runs/run%3Aworkspace-transfer/workspace/finalize",
  ]);
  assert.equal(container.requests[1].headers.get("x-proofweave-content-sha256"), objects.sourceArchive.contentHash);
  assert.equal(container.requests[3].body, "lake manifest");
  const declaration = JSON.parse(container.requests[0].body);
  assert.equal(declaration.workspace.tree.state, "after_patch_and_lake_manifest");
  assert.deepEqual(declaration.target, resolvedBundle.bundle.target);
  assert.deepEqual(declaration.policy, resolvedBundle.request.policy);
});

test("transfer fails closed when R2 metadata changes after Bundle resolution", async () => {
  const objects = fixtureObjects();
  const bucket = new MemoryBucket({
    ...objects,
    sourcePatch: { ...objects.sourcePatch, metadataHash: sha("f") },
  });
  const container = new MemoryContainer();
  const transfer = new RunnerWorkspaceTransfer({ bucket });
  const resolvedBundle = fixtureResolvedBundle(objects);

  await assert.rejects(
    transfer.stage({ run: await fixtureRun(resolvedBundle), resolvedBundle, container }),
    RunnerWorkspaceTransferError,
  );
  assert.equal(container.requests.some((request) => request.pathname.endsWith("/source-patch")), false);
});

class MemoryBucket {
  constructor(objects) {
    this.objects = new Map(Object.values(objects).map((object) => [object.objectKey, object]));
  }

  async get(objectKey) {
    const object = this.objects.get(objectKey);
    if (!object) return null;
    return {
      size: object.byteLength,
      customMetadata: { sha256: object.metadataHash ?? object.contentHash },
      body: new Blob([object.body]).stream(),
    };
  }
}

class MemoryContainer {
  constructor() {
    this.requests = [];
  }

  async fetch(request) {
    this.requests.push({
      pathname: new URL(request.url).pathname,
      headers: request.headers,
      body: request.body ? await request.text() : "",
    });
    return new Response(null, { status: 204 });
  }
}

async function fixtureRun(resolvedBundle) {
  return {
    id: "run:workspace-transfer",
    attemptId: "attempt:workspace-transfer",
    artifactBundleHash: sha("b"),
    requestHash: await leanRunnerRequestHash(resolvedBundle.request),
    state: "preparing",
  };
}

function fixtureResolvedBundle(objects) {
  return {
    request: {
      protocolVersion: "pw-lean-runner-v1",
      jobId: "run:workspace-transfer",
      idempotencyKey: "workspace-transfer-idempotency",
      attemptId: "attempt:workspace-transfer",
      bundle: {
        objectKey: `bundles/sha256/${"b".repeat(64)}/bundle.json`,
        contentHash: sha("b"),
        manifestHash: sha("b"),
        entryCommand: ["lake", "env", "lean", "Proofweave/Main.lean"],
      },
      environment: {
        imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"c".repeat(64)}`,
        leanToolchain: "leanprover/lean4:v4.30.0",
        mathlibRevision: "fixture-mathlib",
        network: "disabled",
      },
      limits: { cpuSeconds: 60, wallSeconds: 120, memoryMiB: 2_048, diskMiB: 2_048, outputBytes: 1_000_000 },
      policy: { requireNoSorry: true, allowedAxioms: [] },
    },
    bundle: {
      protocolVersion: "pw-artifact-bundle-v2",
      target: { declaration: "Proofweave.Main", statementHash: sha("a") },
      workspace: {
        archive: { maxExpandedBytes: 64 * 1024 * 1024 },
        patch: { strip: 1, allowFuzz: false },
        tree: { hash: sha("b"), algorithm: "pw-tree-v1", state: "after_patch_and_lake_manifest" },
        lakeManifest: { destination: "lake-manifest.json" },
      },
    },
    manifest: { contentHash: sha("b") },
    objects,
  };
}

function fixtureObjects() {
  return {
    sourceArchive: fixtureObject("sourceArchive", "source archive", "application/zstd", sha("c")),
    sourcePatch: fixtureObject("sourcePatch", "source patch", "text/plain", sha("d")),
    lakeManifest: fixtureObject("lakeManifest", "lake manifest", "application/json", sha("e")),
  };
}

function fixtureObject(id, body, contentType, contentHash) {
  return {
    objectKey: `bundles/sha256/${contentHash.slice("sha256:".length)}/${id}`,
    contentHash,
    byteLength: new TextEncoder().encode(body).byteLength,
    contentType,
    body,
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
