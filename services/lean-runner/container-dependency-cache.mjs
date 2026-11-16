import { createHash } from "node:crypto";
import { createReadStream, constants } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, utimes } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import { workspaceTreeHash } from "../../packages/protocol/workspace-tree.mjs";

const hashPattern = /^sha256:[a-f0-9]{64}$/;
const artifactPattern = /^(?:lib\/lean|ir)\/(?:[A-Za-z0-9_+-]+\/)*[A-Za-z0-9_+-]+\.(?:olean(?:\.(?:private|server))?|ilean|ir(?:\.sig)?|c|trace)(?:\.hash)?$/;
const maxArtifactBytes = 64 * 1024 * 1024;
const maxCacheBytes = 512 * 1024 * 1024;
const maxArtifacts = 10_000;
const maxManifestBytes = 2 * 1024 * 1024;

/** Image-provisioned cache only. A workspace, request, or Run never supplies compiled artifacts. */
export class ContainerDependencyCache {
  constructor({ root, manifestHash, toolchainRoot }) {
    if (!hashPattern.test(manifestHash)) throw new TypeError("Runner dependency cache requires a pinned manifest hash.");
    this.root = root;
    this.manifestHash = manifestHash;
    this.toolchainRoot = toolchainRoot;
  }

  async restore({ workspace, request, entryModule, deadline, signal }) {
    const manifestPath = join(this.root, "manifest.json");
    let staging;
    try {
      const info = await lstat(manifestPath);
      if (!info.isFile() || info.size > maxManifestBytes) return miss("manifest_invalid");
      const bytes = await readFile(manifestPath);
      if (digest(bytes) !== this.manifestHash) return miss("manifest_hash_mismatch");
      const manifest = JSON.parse(bytes);
      // Use the canonical hash of the byte-verified entries, including Lake
      // configuration and audit data. Legacy signed workspace sort order
      // doesn't cause two identities for the same exact source bytes.
      const sourceHash = await workspaceTreeHash(workspace.entries);
      if (manifest.sourceHash !== sourceHash || manifest.entryModule !== entryModule) return miss("source_mismatch");
      const entries = validateManifest(manifest, entryModule);
      const toolchainHash = await runnerToolchainHash({
        root: this.toolchainRoot,
        leanToolchain: request.environment.leanToolchain,
        mathlibRevision: request.environment.mathlibRevision,
      });
      if (manifest.toolchainHash !== toolchainHash) return miss("toolchain_mismatch");

      const lake = join(workspace.workspaceDirectory, ".lake");
      staging = await mkdtemp(join(lake, ".verified-cache-"));
      for (const entry of entries) {
        if (signal?.aborted || Date.now() >= deadline) return miss("interrupted");
        const source = join(this.root, "build", entry.path);
        const stat = await lstat(source);
        if (!stat.isFile() || stat.size !== entry.bytes) return miss("artifact_invalid");
        const destination = join(staging, entry.path);
        await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        if (await fileHash(destination) !== entry.sha256) return miss("artifact_hash_mismatch");
        await utimes(destination, stat.atime, stat.mtime);
      }
      await rename(staging, join(lake, "build"));
      staging = null;
      return Object.freeze({ status: "hit", manifestHash: this.manifestHash, sourceHash, toolchainHash,
        modules: entries.filter(entry => entry.path.endsWith(".olean")).length });
    } catch {
      // Optional acceleration fails back to fresh compilation. A partially
      // verified snapshot is never visible to Lake.
      return miss("cache_unavailable");
    } finally {
      if (staging) await rm(staging, { recursive: true, force: true });
    }
  }
}

export async function runnerToolchainHash({ root, leanToolchain, mathlibRevision }) {
  // The immutable image pins the remaining package closure; these runtime
  // bytes also bind the ABI for deserializing Lake and Lean artifacts.
  const files = ["bin/lean", "bin/lake", "lib/lean/libleanshared.so"];
  const hashes = await Promise.all(files.map(async path => [path, await fileHash(join(root, path))]));
  return sha256Canonical({ protocolVersion: "pw-runner-toolchain-v1", leanToolchain, mathlibRevision,
    platform: process.platform, architecture: process.arch, files: Object.fromEntries(hashes) });
}

function validateManifest(manifest, entryModule) {
  if (manifest.protocolVersion !== "pw-runner-dependency-cache-v1" || !hashPattern.test(manifest.toolchainHash)
      || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries.length > maxArtifacts) {
    throw new Error("Invalid Runner dependency cache manifest.");
  }
  const entryPath = entryModule.replaceAll(".", "/");
  const seen = new Set();
  let total = 0;
  for (const entry of manifest.entries) {
    const { path, bytes, sha256 } = entry;
    if (typeof path !== "string" || path.length > 512 || !artifactPattern.test(path)
        || path.split("/").some(segment => segment === "." || segment === "..")
        || path.startsWith("lib/lean/" + entryPath + ".") || path.startsWith("ir/" + entryPath + ".")
        || seen.has(path) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > maxArtifactBytes || !hashPattern.test(sha256)) {
      throw new Error("Unsafe Runner dependency cache entry.");
    }
    seen.add(path);
    total += bytes;
    if (total > maxCacheBytes) throw new Error("Runner dependency cache exceeds its size limit.");
  }
  return manifest.entries;
}

function digest(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return "sha256:" + hash.digest("hex");
}

function miss(reason) {
  return Object.freeze({ status: "miss", reason });
}
