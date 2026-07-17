import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as zlib from "node:zlib";
import { workspaceTreeHash } from "../packages/protocol/workspace-tree.mjs";
import {
  ContainerWorkspaceRuntime,
  ContainerWorkspaceRuntimeError,
  createContainerWorkspaceHttpHandler,
} from "../services/lean-runner/container-workspace-runtime.mjs";

const hasNativeZstd = typeof zlib.zstdCompressSync === "function";

test("Container workspace runtime reconstructs a verified v2 tree and tolerates identical upload retries", { skip: !hasNativeZstd }, async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-container-runtime-"));
  try {
    const fixture = await validWorkspaceFixture();
    const runtime = new ContainerWorkspaceRuntime({
      stagingRoot: join(root, "staging"),
      workspaceRoot: join(root, "workspaces"),
    });

    await runtime.declare(fixture.declaration);
    const archive = await runtime.receiveArtifact("sourceArchive", fixture.artifacts.sourceArchive, fixture.metadata.sourceArchive);
    const retriedArchive = await runtime.receiveArtifact("sourceArchive", fixture.artifacts.sourceArchive, fixture.metadata.sourceArchive);
    await runtime.receiveArtifact("sourcePatch", fixture.artifacts.sourcePatch, fixture.metadata.sourcePatch);
    await runtime.receiveArtifact("lakeManifest", fixture.artifacts.lakeManifest, fixture.metadata.lakeManifest);
    const finalized = await runtime.finalize();

    assert.equal(archive.duplicate, false);
    assert.equal(retriedArchive.duplicate, true);
    assert.equal(finalized.treeHash, fixture.declaration.workspace.tree.hash);
    assert.equal(finalized.entries.length, 2);
    assert.equal(
      await readFile(join(finalized.workspaceDirectory, "Proofweave", "Main.lean"), "utf8"),
      "theorem checked : True := by\n  trivial\n",
    );
    assert.equal(
      await readFile(join(finalized.workspaceDirectory, "lake-manifest.json"), "utf8"),
      fixture.lakeManifest.toString("utf8"),
    );
    assert.equal(await runtime.finalize(), finalized);
    await runtime.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Container workspace HTTP handler verifies private headers and reconstructs before finalization", { skip: !hasNativeZstd }, async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-container-http-"));
  try {
    const fixture = await validWorkspaceFixture();
    const handler = createContainerWorkspaceHttpHandler({
      stagingRoot: join(root, "staging"),
      workspaceRoot: join(root, "workspaces"),
    });
    const base = `https://proofweave-runner.internal/v1/runs/${encodeURIComponent(fixture.declaration.jobId)}`;

    assert.equal((await handler(new Request(`${base}/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture.declaration),
    }))).status, 204);
    for (const [endpoint, id] of Object.entries({
      "source-archive": "sourceArchive",
      "source-patch": "sourcePatch",
      "lake-manifest": "lakeManifest",
    })) {
      const metadata = fixture.metadata[id];
      assert.equal((await handler(new Request(`${base}/workspace/artifacts/${endpoint}`, {
        method: "PUT",
        headers: {
          "content-type": metadata.contentType,
          "content-length": String(metadata.byteLength),
          "x-proofweave-artifact-role": id,
          "x-proofweave-content-sha256": metadata.contentHash,
        },
        body: fixture.artifacts[id],
      }))).status, 204);
    }
    const finalized = await handler(new Request(`${base}/workspace/finalize`, { method: "POST" }));
    assert.equal(finalized.status, 200);
    assert.deepEqual(await finalized.json(), {
      jobId: fixture.declaration.jobId,
      requestHash: fixture.declaration.requestHash,
      treeHash: fixture.declaration.workspace.tree.hash,
      fileCount: 2,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Container workspace HTTP handler accepts an idempotent private cancellation after declaration", async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-container-cancel-"));
  try {
    const fixture = await validWorkspaceFixture();
    const handler = createContainerWorkspaceHttpHandler({
      stagingRoot: join(root, "staging"),
      workspaceRoot: join(root, "workspaces"),
    });
    const base = `https://proofweave-runner.internal/v1/runs/${encodeURIComponent(fixture.declaration.jobId)}`;
    assert.equal((await handler(new Request(`${base}/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fixture.declaration),
    }))).status, 204);
    assert.equal((await handler(new Request(`${base}/workspace/cancel`, { method: "POST" }))).status, 204);
    assert.equal((await handler(new Request(`${base}/workspace/cancel`, { method: "POST" }))).status, 204);
    assert.equal((await handler(new Request(`${base}/workspace/cancel`, { method: "GET" }))).status, 405);
    await handler.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Container workspace runtime rejects archive links and patch paths before Lean can see a workspace", { skip: !hasNativeZstd }, async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-container-reject-"));
  try {
    const linkedArchive = zlib.zstdCompressSync(makeTar([
      { path: "Proofweave/link", contents: Buffer.alloc(0), type: "2", linkName: "../outside" },
    ]));
    const fixture = await fixtureFor({
      archive: linkedArchive,
      patch: Buffer.from(validPatch(), "utf8"),
      treeHash: sha("f"),
    });
    const runtime = new ContainerWorkspaceRuntime({
      stagingRoot: join(root, "link-stage"),
      workspaceRoot: join(root, "link-workspace"),
    });
    await stageAll(runtime, fixture);
    await assert.rejects(runtime.finalize(), ContainerWorkspaceRuntimeError);
    await runtime.cleanup();

    const unsafeFixture = await validWorkspaceFixture({
      patch: Buffer.from([
        "diff --git a/Proofweave/Main.lean b/Proofweave/Main.lean",
        "--- a/Proofweave/Main.lean",
        "+++ b/../../outside.lean",
        "@@ -1,2 +1,2 @@",
        "-theorem initial : True := by",
        "+theorem checked : True := by",
        "   trivial",
        "",
      ].join("\n"), "utf8"),
      treeHash: sha("e"),
    });
    const unsafeRuntime = new ContainerWorkspaceRuntime({
      stagingRoot: join(root, "patch-stage"),
      workspaceRoot: join(root, "patch-workspace"),
    });
    await stageAll(unsafeRuntime, unsafeFixture);
    await assert.rejects(unsafeRuntime.finalize(), /unsafe path segment/);
    await unsafeRuntime.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function validWorkspaceFixture(overrides = {}) {
  const archive = overrides.archive ?? zlib.zstdCompressSync(makeTar([
    { path: "Proofweave/Main.lean", contents: Buffer.from("theorem initial : True := by\n  trivial\n", "utf8") },
    { path: "lake-manifest.json", contents: Buffer.from("{\"old\":true}\n", "utf8") },
  ]));
  const patch = overrides.patch ?? Buffer.from(validPatch(), "utf8");
  const lakeManifest = Buffer.from("{\"name\":\"Proofweave\",\"version\":\"1.0.0\"}\n", "utf8");
  const entries = [
    {
      path: "Proofweave/Main.lean",
      mode: 0o644,
      contentHash: hash("theorem checked : True := by\n  trivial\n"),
    },
    { path: "lake-manifest.json", mode: 0o644, contentHash: hash(lakeManifest) },
  ];
  return fixtureFor({
    archive,
    patch,
    lakeManifest,
    treeHash: overrides.treeHash ?? await workspaceTreeHash(entries),
  });
}

async function fixtureFor({ archive, patch, lakeManifest = Buffer.from("{}\n", "utf8"), treeHash }) {
  const artifacts = { sourceArchive: archive, sourcePatch: patch, lakeManifest };
  const metadata = {
    sourceArchive: artifactMetadata(archive, "application/zstd"),
    sourcePatch: artifactMetadata(patch, "text/x-diff; charset=utf-8"),
    lakeManifest: artifactMetadata(lakeManifest, "application/json"),
  };
  const declaration = {
    protocolVersion: "pw-runner-workspace-transfer-v1",
    jobId: "run:container-runtime",
    requestHash: sha("a"),
    target: { declaration: "Proofweave.Main", statementHash: sha("b") },
    policy: { requireNoSorry: true, allowedAxioms: [] },
    workspace: {
      archive: {
        objectKey: objectKey(metadata.sourceArchive.contentHash, "source.tar.zst"),
        contentHash: metadata.sourceArchive.contentHash,
        format: "tar.zst",
        maxExpandedBytes: 1024 * 1024,
        maxFileCount: 10,
        symlinkPolicy: "forbidden",
      },
      patch: {
        objectKey: objectKey(metadata.sourcePatch.contentHash, "normalized.patch"),
        contentHash: metadata.sourcePatch.contentHash,
        format: "unified-diff",
        strip: 1,
        allowFuzz: false,
      },
      tree: { hash: treeHash, algorithm: "pw-tree-v1", state: "after_patch_and_lake_manifest" },
      lakeManifest: {
        objectKey: objectKey(metadata.lakeManifest.contentHash, "lake-manifest.json"),
        contentHash: metadata.lakeManifest.contentHash,
        destination: "lake-manifest.json",
      },
    },
    entryCommand: ["lake", "env", "lean", "Proofweave/Main.lean"],
    artifacts: metadata,
  };
  return { declaration, artifacts, metadata, lakeManifest };
}

async function stageAll(runtime, fixture) {
  await runtime.declare(fixture.declaration);
  for (const id of ["sourceArchive", "sourcePatch", "lakeManifest"]) {
    await runtime.receiveArtifact(id, fixture.artifacts[id], fixture.metadata[id]);
  }
}

function validPatch() {
  return [
    "diff --git a/Proofweave/Main.lean b/Proofweave/Main.lean",
    "index 1111111..2222222 100644",
    "--- a/Proofweave/Main.lean",
    "+++ b/Proofweave/Main.lean",
    "@@ -1,2 +1,2 @@",
    "-theorem initial : True := by",
    "+theorem checked : True := by",
    "   trivial",
    "",
  ].join("\n");
}

function artifactMetadata(bytes, contentType) {
  return { contentHash: hash(bytes), byteLength: bytes.byteLength, contentType };
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sha(character) {
  return `sha256:${character.repeat(64)}`;
}

function objectKey(contentHash, filename) {
  return `bundles/sha256/${contentHash.slice("sha256:".length)}/${filename}`;
}

function makeTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const contents = Buffer.from(entry.contents);
    const header = Buffer.alloc(512);
    writeTarString(header, 0, 100, entry.path);
    writeTarOctal(header, 100, 8, entry.mode ?? 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, contents.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = (entry.type ?? "0").charCodeAt(0);
    writeTarString(header, 157, 100, entry.linkName ?? "");
    writeTarString(header, 257, 6, "ustar");
    writeTarString(header, 263, 2, "00");
    const checksum = header.reduce((total, byte) => total + byte, 0);
    writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    blocks.push(header, contents);
    const padding = (512 - (contents.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

function writeTarString(target, offset, length, value) {
  const bytes = Buffer.from(value, "ascii");
  if (bytes.length > length) throw new Error("Tar fixture field is too long.");
  bytes.copy(target, offset);
}

function writeTarOctal(target, offset, length, value) {
  writeTarString(target, offset, length, `${value.toString(8).padStart(length - 1, "0")}\0`);
}
