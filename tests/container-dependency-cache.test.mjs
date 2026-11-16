import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { workspaceTreeHash } from "../packages/protocol/workspace-tree.mjs";
import { ContainerDependencyCache, runnerToolchainHash } from "../services/lean-runner/container-dependency-cache.mjs";

const hash = bytes => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const environment = { leanToolchain: "leanprover/lean4:v4.34.1", mathlibRevision: "none" };

async function fixture(t, modify = () => {}) {
  const root = await mkdtemp(join(tmpdir(), "pw-dependency-cache-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const workspaceDirectory = join(root, "workspace");
  const cacheRoot = join(root, "sealed");
  const toolchainRoot = join(root, "toolchain");
  await Promise.all(["workspace/.lake", "sealed/build/lib/lean", "toolchain/bin", "toolchain/lib/lean"]
    .map(path => mkdir(join(root, path), { recursive: true })));
  const entries = [{ path: "Main.lean", mode: 0o644, contentHash: hash("import Dependency\n") }];
  const manifest = {
    protocolVersion: "pw-runner-dependency-cache-v1",
    sourceHash: await workspaceTreeHash(entries),
    entryModule: "Main",
    entries: [{ path: "lib/lean/Dependency.olean", bytes: 4, sha256: hash("olea") }],
  };
  await Promise.all(["bin/lean", "bin/lake", "lib/lean/libleanshared.so"].map(path => writeFile(join(toolchainRoot, path), path)));
  manifest.toolchainHash = await runnerToolchainHash({ root: toolchainRoot, ...environment });
  modify(manifest);
  const body = JSON.stringify(manifest);
  const artifact = join(cacheRoot, "build/lib/lean/Dependency.olean");
  await Promise.all([writeFile(join(cacheRoot, "manifest.json"), body), writeFile(artifact, "olea")]);
  const cache = new ContainerDependencyCache({ root: cacheRoot, manifestHash: hash(body), toolchainRoot });
  const input = { workspace: { workspaceDirectory, entries }, request: { environment }, entryModule: "Main", deadline: Date.now() + 30_000 };
  return { cache, input, artifact, toolchainRoot, build: join(workspaceDirectory, ".lake/build") };
}

test("the cache publishes the verified dependency build atomically", async t => {
  const { cache, input, build } = await fixture(t);
  const restored = await cache.restore(input);
  assert.equal(restored.status, "hit");
  assert.equal(restored.modules, 1);
  assert.equal(await readFile(join(build, "lib/lean/Dependency.olean"), "utf8"), "olea");
  await assert.rejects(stat(join(build, "lib/lean/Main.olean")), { code: "ENOENT" });
});

test("source, toolchain, and artifact mismatches never leave a partial build", async t => {
  const { cache, input, artifact, toolchainRoot, build } = await fixture(t);
  const changedWorkspace = { ...input.workspace, entries: [{ ...input.workspace.entries[0], contentHash: hash("changed") }] };
  assert.equal((await cache.restore({ ...input, workspace: changedWorkspace })).reason, "source_mismatch");
  const toolchainBinary = join(toolchainRoot, "bin/lean");
  await writeFile(toolchainBinary, "wrong Lean");
  assert.equal((await cache.restore(input)).reason, "toolchain_mismatch");
  await writeFile(toolchainBinary, "bin/lean");
  await writeFile(artifact, "evil");
  assert.equal((await cache.restore(input)).reason, "artifact_hash_mismatch");
  await assert.rejects(stat(build), { code: "ENOENT" });
});

test("the selected entry cannot be supplied by a cache snapshot", async t => {
  const { cache, input, build } = await fixture(t, manifest => {
    manifest.entries[0].path = "lib/lean/Main.olean";
  });
  assert.equal((await cache.restore(input)).status, "miss");
  await assert.rejects(stat(build), { code: "ENOENT" });
});
