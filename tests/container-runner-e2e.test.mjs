import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { leanRunnerRequestHash, verifyLeanRunnerResultSignature } from "../packages/protocol/lean-runner.mjs";
import * as zlib from "node:zlib";
import { workspaceTreeHash } from "../packages/protocol/workspace-tree.mjs";
import { ContainerLeanExecutor } from "../services/lean-runner/container-lean-executor.mjs";
import { createContainerWorkspaceHttpHandler } from "../services/lean-runner/container-workspace-runtime.mjs";
import { RunnerContainerExecutionClient } from "../services/lean-runner/runner-container-execution-client.mjs";
import { RunnerExecutionResultSigner } from "../services/lean-runner/runner-execution-result-signer.mjs";

test("a real v2 archive reconstructs into a Lean-checked unsigned execution result", { skip: typeof zlib.zstdCompressSync !== "function" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "proofweave-runner-e2e-"));
  try {
    const fixtureRoot = new URL("./fixtures/lean/core-success/", import.meta.url);
    const finalSource = await readFile(new URL("ProofweaveFixture.lean", fixtureRoot));
    const initialSource = Buffer.from(finalSource.toString("utf8").replace(
      "theorem true_is_inhabited : True := True.intro",
      "theorem true_is_inhabited : True := by\n  trivial",
    ));
    const lakefile = await readFile(new URL("lakefile.toml", fixtureRoot));
    const leanToolchain = await readFile(new URL("lean-toolchain", fixtureRoot));
    const lakeManifest = await readFile(new URL("lake-manifest.json", fixtureRoot));
    const archive = zlib.zstdCompressSync(makeTar([
      { path: "ProofweaveFixture.lean", contents: initialSource },
      { path: "lakefile.toml", contents: lakefile },
      { path: "lean-toolchain", contents: leanToolchain },
      { path: "lake-manifest.json", contents: Buffer.from("{\"placeholder\":true}\n") },
    ]));
    const patch = Buffer.from([
      "diff --git a/ProofweaveFixture.lean b/ProofweaveFixture.lean",
      "index 1111111..2222222 100644",
      "--- a/ProofweaveFixture.lean",
      "+++ b/ProofweaveFixture.lean",
      "@@ -1,6 +1,5 @@",
      " namespace ProofweaveFixture",
      " ",
      "-theorem true_is_inhabited : True := by",
      "-  trivial",
      "+theorem true_is_inhabited : True := True.intro",
      " ",
      " theorem natural_addition_commutes (left right : Nat) : left + right = right + left :=",
      "",
    ].join("\n"));
    const artifacts = {
      sourceArchive: artifactMetadata(archive, "application/zstd"),
      sourcePatch: artifactMetadata(patch, "text/x-diff; charset=utf-8"),
      lakeManifest: artifactMetadata(lakeManifest, "application/json"),
    };
    const treeHash = await workspaceTreeHash([
      { path: "ProofweaveFixture.lean", mode: 0o644, contentHash: hash(finalSource) },
      { path: "lake-manifest.json", mode: 0o644, contentHash: hash(lakeManifest) },
      { path: "lakefile.toml", mode: 0o644, contentHash: hash(lakefile) },
      { path: "lean-toolchain", mode: 0o644, contentHash: hash(leanToolchain) },
    ]);
    const policy = { requireNoSorry: true, allowedAxioms: [] };
    const request = fixtureRequest(policy);
    const declaration = {
      protocolVersion: "pw-runner-workspace-transfer-v1",
      jobId: request.jobId,
      requestHash: await leanRunnerRequestHash(request),
      target: { declaration: "ProofweaveFixture.true_is_inhabited", statementHash: sha("e") },
      policy,
      workspace: {
        archive: {
          objectKey: objectKey(artifacts.sourceArchive.contentHash, "source.tar.zst"),
          contentHash: artifacts.sourceArchive.contentHash,
          format: "tar.zst",
          maxExpandedBytes: 1024 * 1024,
          maxFileCount: 10,
          symlinkPolicy: "forbidden",
        },
        patch: {
          objectKey: objectKey(artifacts.sourcePatch.contentHash, "normalized.patch"),
          contentHash: artifacts.sourcePatch.contentHash,
          format: "unified-diff",
          strip: 1,
          allowFuzz: false,
        },
        tree: { hash: treeHash, algorithm: "pw-tree-v1", state: "after_patch_and_lake_manifest" },
        lakeManifest: {
          objectKey: objectKey(artifacts.lakeManifest.contentHash, "lake-manifest.json"),
          contentHash: artifacts.lakeManifest.contentHash,
          destination: "lake-manifest.json",
        },
      },
      entryCommand: request.bundle.entryCommand,
      artifacts,
    };
    const handler = createContainerWorkspaceHttpHandler({
      stagingRoot: join(root, "staging"),
      workspaceRoot: join(root, "workspaces"),
      executor: new ContainerLeanExecutor({ networkIsolated: true, resourceLimitsEnforced: true }),
    });
    const base = `https://proofweave-runner.internal/v1/runs/${encodeURIComponent(request.jobId)}`;
    assert.equal((await handler(new Request(`${base}/workspace`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(declaration),
    }))).status, 204);
    for (const [endpoint, id, body] of [
      ["source-archive", "sourceArchive", archive],
      ["source-patch", "sourcePatch", patch],
      ["lake-manifest", "lakeManifest", lakeManifest],
    ]) {
      assert.equal((await handler(new Request(`${base}/workspace/artifacts/${endpoint}`, {
        method: "PUT",
        headers: {
          "content-type": artifacts[id].contentType,
          "content-length": String(artifacts[id].byteLength),
          "x-proofweave-artifact-role": id,
          "x-proofweave-content-sha256": artifacts[id].contentHash,
        },
        body,
      }))).status, 204);
    }
    assert.equal((await handler(new Request(`${base}/workspace/finalize`, { method: "POST" }))).status, 200);
    const run = {
      id: request.jobId,
      attemptId: request.attemptId,
      requestHash: declaration.requestHash,
      artifactBundleHash: request.bundle.manifestHash,
      state: "running",
    };
    const execution = await new RunnerContainerExecutionClient().execute({
      container: { fetch: handler },
      run,
      request,
    });
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const signed = await new RunnerExecutionResultSigner({
      runnerKeyId: "runner-key:e2e",
      runnerPrivateKey: keyPair.privateKey,
    }).sign({ execution, run });

    assert.equal(execution.result.status, "succeeded");
    assert.equal(execution.result.kernelStatus, "accepted");
    assert.deepEqual(execution.result.checks, {
      network: "passed",
      noSorry: "passed",
      allowedAxioms: "passed",
      leanBuild: "passed",
    });
    assert.deepEqual(await readdir(join(root, "staging")), []);
    assert.deepEqual(await readdir(join(root, "workspaces")), []);
    assert.equal(Object.hasOwn(execution.result, "runnerSignature"), false);
    assert.equal(
      await verifyLeanRunnerResultSignature({
        result: signed,
        runnerPublicKey: base64Url(await crypto.subtle.exportKey("raw", keyPair.publicKey)),
      }),
      true,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function fixtureRequest(policy) {
  return {
    protocolVersion: "pw-lean-runner-v1",
    jobId: "run:container-e2e",
    idempotencyKey: "container-e2e",
    attemptId: "attempt:container-e2e",
    bundle: {
      objectKey: `bundles/sha256/${"a".repeat(64)}/bundle.json`,
      contentHash: sha("a"),
      manifestHash: sha("a"),
      entryCommand: ["lake", "env", "lean", "ProofweaveFixture.lean"],
    },
    environment: {
      imageDigest: `registry.cloudflare.com/proofweave/lean-runner@sha256:${"b".repeat(64)}`,
      leanToolchain: "leanprover/lean4:v4.30.0",
      mathlibRevision: "fixture-mathlib",
      network: "disabled",
    },
    limits: { cpuSeconds: 10, wallSeconds: 30, memoryMiB: 512, diskMiB: 512, outputBytes: 1_000_000 },
    policy,
  };
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
    writeTarOctal(header, 100, 8, 0o644);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, contents.length);
    writeTarOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = "0".charCodeAt(0);
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

function base64Url(buffer) {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
