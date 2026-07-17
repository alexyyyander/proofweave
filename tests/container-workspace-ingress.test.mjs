import assert from "node:assert/strict";
import test from "node:test";
import {
  RunnerWorkspaceIngress,
  RunnerWorkspaceIngressError,
} from "../services/lean-runner/container-workspace-ingress.mjs";

test("Container ingress accepts only verified workspace artifacts in fixed order", () => {
  const ingress = new RunnerWorkspaceIngress(fixtureDeclaration());
  assert.deepEqual(ingress.recordArtifact({ id: "sourceArchive", contentHash: sha("a"), byteLength: 12 }), {
    accepted: "sourceArchive", remaining: 2,
  });
  assert.deepEqual(ingress.recordArtifact({ id: "sourcePatch", contentHash: sha("b"), byteLength: 8 }), {
    accepted: "sourcePatch", remaining: 1,
  });
  ingress.recordArtifact({ id: "lakeManifest", contentHash: sha("c"), byteLength: 16 });
  const finalized = ingress.finalize();
  assert.equal(finalized.workspace.tree.state, "after_patch_and_lake_manifest");
  assert.equal(finalized.target.declaration, "Proofweave.Main");
  assert.deepEqual(finalized.policy, { requireNoSorry: true, allowedAxioms: [] });
  assert.deepEqual(Object.keys(finalized.artifacts), ["sourceArchive", "sourcePatch", "lakeManifest"]);
});

test("Container ingress rejects out-of-order, substituted, and incomplete workspace streams", () => {
  const ingress = new RunnerWorkspaceIngress(fixtureDeclaration());
  assert.throws(
    () => ingress.recordArtifact({ id: "sourcePatch", contentHash: sha("b"), byteLength: 8 }),
    /required order/,
  );
  assert.throws(() => ingress.finalize(), RunnerWorkspaceIngressError);
  assert.throws(
    () => new RunnerWorkspaceIngress({
      ...fixtureDeclaration(),
      artifacts: { ...fixtureDeclaration().artifacts, lakeManifest: { ...fixtureDeclaration().artifacts.lakeManifest, contentHash: sha("f") } },
    }),
    /does not match the v2 Bundle/,
  );
});

function fixtureDeclaration() {
  return {
    protocolVersion: "pw-runner-workspace-transfer-v1",
    jobId: "run:container-ingress",
    requestHash: sha("0"),
    target: { declaration: "Proofweave.Main", statementHash: sha("e") },
    policy: { requireNoSorry: true, allowedAxioms: [] },
    workspace: {
      archive: {
        objectKey: `bundles/sha256/${"a".repeat(64)}/source.tar.zst`, contentHash: sha("a"),
        format: "tar.zst", maxExpandedBytes: 64 * 1024 * 1024, maxFileCount: 10_000, symlinkPolicy: "forbidden",
      },
      patch: {
        objectKey: `bundles/sha256/${"b".repeat(64)}/normalized.patch`, contentHash: sha("b"),
        format: "unified-diff", strip: 1, allowFuzz: false,
      },
      tree: { hash: sha("d"), algorithm: "pw-tree-v1", state: "after_patch_and_lake_manifest" },
      lakeManifest: {
        objectKey: `bundles/sha256/${"c".repeat(64)}/lake-manifest.json`, contentHash: sha("c"),
        destination: "lake-manifest.json",
      },
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Main.lean"],
    artifacts: {
      sourceArchive: { contentHash: sha("a"), byteLength: 12, contentType: "application/zstd" },
      sourcePatch: { contentHash: sha("b"), byteLength: 8, contentType: "text/plain" },
      lakeManifest: { contentHash: sha("c"), byteLength: 16, contentType: "application/json" },
    },
  };
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}
