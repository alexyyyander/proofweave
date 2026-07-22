import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";
import { canonicalJson } from "../../packages/protocol/canonical-json.mjs";
import { leanRunnerRequestHash } from "../../packages/protocol/lean-runner.mjs";
import { workspaceTreeHash } from "../../packages/protocol/workspace-tree.mjs";
import {
  RunnerWorkspaceIngress,
  normalizeRunnerWorkspaceIngressDeclaration,
} from "./container-workspace-ingress.mjs";

const maxIngressArtifactBytes = 32 * 1024 * 1024;
const maxDeclarationBytes = 256 * 1024;
const maxPatchOutputBytes = 64 * 1024;
const patchTimeoutMilliseconds = 30_000;
const artifactIds = Object.freeze(["sourceArchive", "sourcePatch", "lakeManifest"]);
const artifactEndpoints = Object.freeze({
  "source-archive": "sourceArchive",
  "source-patch": "sourcePatch",
  "lake-manifest": "lakeManifest",
});

export class ContainerWorkspaceRuntimeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ContainerWorkspaceRuntimeError";
  }
}

/**
 * Container-process implementation of the private workspace ingress contract.
 *
 * This is deliberately Node/container code, not Worker code. It owns a fresh
 * filesystem directory, re-hashes each streamed object, rejects unsafe tar
 * records and patch paths, and compares the reconstructed tree with the v2
 * Bundle's immutable post-patch tree hash. It does not invoke Lean or hold a
 * D1, R2, queue, or signing credential.
 */
export class ContainerWorkspaceRuntime {
  constructor({ stagingRoot, workspaceRoot, patchCommand = "patch" }) {
    requireAbsoluteDirectory(stagingRoot, "Container stagingRoot");
    requireAbsoluteDirectory(workspaceRoot, "Container workspaceRoot");
    if (typeof patchCommand !== "string" || patchCommand.length === 0 || patchCommand.length > 240 || /[\0\r\n]/.test(patchCommand)) {
      throw new TypeError("Container patchCommand must be a bounded executable name.");
    }
    this.stagingRoot = stagingRoot;
    this.workspaceRoot = workspaceRoot;
    this.patchCommand = patchCommand;
    this.declaration = null;
    this.declarationCanonical = null;
    this.ingress = null;
    this.stagingDirectory = null;
    this.workspaceDirectory = null;
    this.artifactPaths = null;
    this.finalized = null;
  }

  /** Idempotently accept the fixed declaration for this one Container Run. */
  async declare(value) {
    const declaration = normalizeRunnerWorkspaceIngressDeclaration(value);
    const canonical = canonicalJson(declaration);
    if (this.declaration) {
      if (canonical !== this.declarationCanonical) {
        throw new ContainerWorkspaceRuntimeError("Container Run received a different workspace declaration on retry.");
      }
      return this.declaration;
    }

    await mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 });
    this.stagingDirectory = await mkdtemp(join(this.stagingRoot, "proofweave-stage-"));
    this.workspaceDirectory = await mkdtemp(join(this.workspaceRoot, "proofweave-workspace-"));
    this.declaration = declaration;
    this.declarationCanonical = canonical;
    this.ingress = new RunnerWorkspaceIngress(declaration);
    this.artifactPaths = Object.freeze(Object.fromEntries(
      artifactIds.map((id) => [id, join(this.stagingDirectory, `${id}.bin`)]),
    ));
    return declaration;
  }

  /**
   * Stream one private artifact to disk and independently bind it to the
   * immutable declaration. A retry may send an already-recorded role again,
   * but it must re-produce identical bytes before it is treated as a no-op.
   */
  async receiveArtifact(id, body, metadata = {}) {
    const declaration = this.requireDeclaration();
    if (!artifactIds.includes(id)) {
      throw new ContainerWorkspaceRuntimeError("Container workspace artifact role is unsupported.");
    }
    const expected = declaration.artifacts[id];
    assertArtifactMetadata(id, metadata, expected);
    const received = await streamBodyToFile(body, this.artifactPaths[id], {
      expectedByteLength: expected.byteLength,
      maximumByteLength: maxIngressArtifactBytes,
    });
    if (received.contentHash !== expected.contentHash || received.byteLength !== expected.byteLength) {
      throw new ContainerWorkspaceRuntimeError(`Container workspace ${id} bytes do not match the immutable declaration.`);
    }

    const prior = this.ingress.received.get(id);
    if (prior) return Object.freeze({ accepted: id, duplicate: true, remaining: artifactIds.length - this.ingress.received.size });
    const accepted = this.ingress.recordArtifact({ id, ...received });
    return Object.freeze({ ...accepted, duplicate: false });
  }

  /** Reconstruct the workspace exactly once after all private streams arrive. */
  async finalize() {
    this.requireDeclaration();
    if (this.finalized) return this.finalized;
    this.finalized = this.finalizeOnce();
    try {
      return await this.finalized;
    } catch (cause) {
      // A failed deterministic reconstruction cannot be repaired by changing
      // declared bytes. Keep its failure stable for duplicate HTTP retries.
      this.finalized = Promise.reject(cause);
      this.finalized.catch(() => {});
      throw cause;
    }
  }

  async cleanup() {
    const roots = [this.stagingDirectory, this.workspaceDirectory].filter(Boolean);
    await Promise.all(roots.map((directory) => rm(directory, { recursive: true, force: true })));
  }

  async finalizeOnce() {
    const finalization = this.ingress.finalize();
    const { workspace } = finalization;
    const extraction = await extractZstdTar(this.artifactPaths.sourceArchive, this.workspaceDirectory, {
      maxExpandedBytes: workspace.archive.maxExpandedBytes,
      maxFileCount: workspace.archive.maxFileCount,
    });
    await applyNormalizedPatch({
      patchPath: this.artifactPaths.sourcePatch,
      workspaceDirectory: this.workspaceDirectory,
      command: this.patchCommand,
    });
    await replaceLakeManifest({
      lakeManifestPath: this.artifactPaths.lakeManifest,
      workspaceDirectory: this.workspaceDirectory,
    });
    const entries = await readWorkspaceTree(this.workspaceDirectory, {
      maxExpandedBytes: workspace.archive.maxExpandedBytes,
      maxFileCount: workspace.archive.maxFileCount,
    });
    const treeHash = await workspaceTreeHash(entries);
    const verifiedTreeHash = treeHash === workspace.tree.hash
      ? treeHash
      : extraction.hasGitGlobalPaxHeader && legacyConnectorWorkspaceTreeHash(entries) === workspace.tree.hash
        ? workspace.tree.hash
        : null;
    if (verifiedTreeHash === null) {
      throw new ContainerWorkspaceRuntimeError("Reconstructed workspace tree does not match the immutable v2 Bundle tree hash.");
    }
    return Object.freeze({
      jobId: finalization.jobId,
      requestHash: finalization.requestHash,
      workspaceDirectory: this.workspaceDirectory,
      // Early one-click Connector builds hashed the same exact entries after
      // locale ordering instead of pw-tree-v1 byte ordering. The bounded Git
      // PAX marker gates that migration path; both hashes still bind every
      // normalized path, mode, and content digest in this workspace.
      treeHash: verifiedTreeHash,
      entries: Object.freeze(entries),
      target: finalization.target,
      policy: finalization.policy,
      entryCommand: finalization.entryCommand,
    });
  }

  requireDeclaration() {
    if (!this.declaration || !this.ingress || !this.artifactPaths) {
      throw new ContainerWorkspaceRuntimeError("Container workspace declaration must arrive before artifacts.");
    }
    return this.declaration;
  }
}

/**
 * Minimal private HTTP adapter for the RunnerWorkspaceTransfer protocol. A
 * pinned Container image can start this handler on its private port; until
 * then it remains source-only and receives no public route or credentials.
 */
export function createContainerWorkspaceHttpHandler({ executor = null, ...runtimeOptions }) {
  const sessions = new Map();
  const handleContainerWorkspaceRequest = async function handleContainerWorkspaceRequest(request) {
    let route = null;
    try {
      route = parseIngressRoute(request);
      if (!route) return new Response("Not found", { status: 404 });
      if (route.kind === "declare") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const value = JSON.parse(await readBoundedText(request.body, maxDeclarationBytes));
        if (!value || value.jobId !== route.runId) {
          throw new ContainerWorkspaceRuntimeError("Workspace declaration Run identity does not match its private URL.");
        }
        let session = sessions.get(route.runId);
        if (!session) {
          session = {
            runtime: new ContainerWorkspaceRuntime(runtimeOptions),
            execution: null,
            executionRequestHash: null,
            executionController: null,
            executionState: "idle",
            executionResult: null,
            executionFailure: null,
            cancellationRequested: false,
            cleaned: false,
          };
          sessions.set(route.runId, session);
        }
        await session.runtime.declare(value);
        return new Response(null, { status: 204 });
      }
      const session = sessions.get(route.runId);
      if (!session) {
        throw new ContainerWorkspaceRuntimeError("Container workspace declaration has not been accepted for this Run.");
      }
      if (route.kind === "artifact") {
        if (request.method !== "PUT") return methodNotAllowed("PUT");
        await session.runtime.receiveArtifact(route.artifactId, request.body, {
          role: request.headers.get("x-proofweave-artifact-role"),
          contentHash: request.headers.get("x-proofweave-content-sha256"),
          contentType: request.headers.get("content-type"),
          byteLength: parseContentLength(request.headers.get("content-length")),
        });
        return new Response(null, { status: 204 });
      }
      if (route.kind === "finalize") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        const finalized = await session.runtime.finalize();
        return jsonResponse({
          jobId: finalized.jobId,
          requestHash: finalized.requestHash,
          treeHash: finalized.treeHash,
          fileCount: finalized.entries.length,
        });
      }
      if (route.kind === "execute") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        if (!executor || typeof executor.execute !== "function") {
          throw new ContainerWorkspaceRuntimeError("Container image has no configured Lean executor.");
        }
        const runnerRequest = JSON.parse(await readBoundedText(request.body, maxDeclarationBytes));
        const requestHash = await leanRunnerRequestHash(runnerRequest);
        if (session.execution) {
          if (session.executionRequestHash !== requestHash) {
            throw new ContainerWorkspaceRuntimeError("Container Run cannot execute a different Runner request.");
          }
          if (session.executionState === "failed") throw session.executionFailure;
          if (session.executionState === "completed") return executionResponse(session.executionResult);
          return executionPendingResponse();
        }
        const workspace = await session.runtime.finalize();
        if (workspace.requestHash !== requestHash) {
          throw new ContainerWorkspaceRuntimeError("Container Run request does not match its finalized private workspace.");
        }
        const controller = new AbortController();
        if (session.cancellationRequested) controller.abort();
        session.executionController = controller;
        session.executionRequestHash = requestHash;
        session.executionState = "running";
        session.execution = Promise.resolve()
          .then(() => executor.execute({
            request: runnerRequest,
            workspace,
            signal: controller.signal,
          }))
          .then((result) => {
            session.executionState = "completed";
            session.executionResult = result;
            return result;
          }, (error) => {
            session.executionState = "failed";
            session.executionFailure = error;
            throw error;
          })
          .finally(() => { session.executionController = null; });
        // Execution may legitimately outlive a provider's single HTTP request
        // window. Start it once, then let the trusted client poll this private
        // route until the bounded Lean result is available.
        session.execution.catch(() => {});
        return executionPendingResponse();
      }
      if (route.kind === "cancel") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        // Cancellation is idempotent. If execution has not begun yet, the next
        // execute call receives an already-aborted signal and produces the
        // normal signed cancellation evidence without starting Lean.
        session.cancellationRequested = true;
        session.executionController?.abort();
        return new Response(null, { status: 204 });
      }
      if (route.kind === "complete") {
        if (request.method !== "POST") return methodNotAllowed("POST");
        if (!session.execution) {
          throw new ContainerWorkspaceRuntimeError("Container Run cannot complete before private execution evidence exists.");
        }
        await session.execution;
        if (!session.cleaned) {
          await session.runtime.cleanup();
          session.cleaned = true;
        }
        return new Response(null, { status: 204 });
      }
      if (request.method !== "GET") return methodNotAllowed("GET");
      if (!session.execution) {
        throw new ContainerWorkspaceRuntimeError("Container Run has no completed private execution result.");
      }
      const execution = await session.execution;
      const bytes = route.kind === "stdout" ? execution.stdout : execution.stderr;
      const contentHash = route.kind === "stdout"
        ? execution.result.artifacts.stdoutHash
        : execution.result.artifacts.stderrHash;
      return new Response(bytes, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-length": String(bytes.byteLength),
          "x-proofweave-content-sha256": contentHash,
        },
      });
    } catch (cause) {
      if (cause instanceof SyntaxError) return rejectionResponse("invalid_workspace_request");
      if (cause instanceof ContainerWorkspaceRuntimeError || cause instanceof Error) {
        return rejectionResponse("workspace_rejected", privateContainerFailureCode(cause, route));
      }
      return rejectionResponse("workspace_rejected");
    }
  };
  Object.defineProperty(handleContainerWorkspaceRequest, "cleanup", {
    value: async () => {
      await Promise.all([...sessions.values()].map(async (session) => {
        await session.runtime.cleanup();
        session.cleaned = true;
      }));
    },
  });
  return handleContainerWorkspaceRequest;
}

function executionResponse(execution) {
  return jsonResponse({
    result: execution.result,
    outputTruncated: execution.outputTruncated,
    workspaceTreeHash: execution.workspaceTreeHash,
  });
}

async function extractZstdTar(archivePath, destination, limits) {
  const extractor = new SafeTarExtractor(destination, limits);
  const sink = tarSink(extractor);
  if (typeof zlib.createZstdDecompress === "function") {
    await pipeline(createReadStream(archivePath), zlib.createZstdDecompress(), sink);
  } else {
    await extractWithZstdExecutable(archivePath, sink);
  }
  return Object.freeze({
    entries: extractor.entries,
    hasGitGlobalPaxHeader: extractor.sawGitGlobalPaxHeader,
  });
}

async function extractWithZstdExecutable(archivePath, sink) {
  const child = spawn("zstd", ["--no-progress", "--decompress", "--stdout", "--", archivePath], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stderr = collectOutput(child.stderr, maxPatchOutputBytes);
  try {
    const [, result] = await Promise.all([pipeline(child.stdout, sink), waitForExit(child)]);
    if (result.code !== 0 || result.signal) {
      const detail = await stderr;
      throw new ContainerWorkspaceRuntimeError(`Unable to decompress zstd workspace archive${detail ? `: ${detail}` : "."}`);
    }
  } catch (cause) {
    child.kill("SIGKILL");
    if (cause instanceof ContainerWorkspaceRuntimeError) throw cause;
    const detail = await stderr;
    throw new ContainerWorkspaceRuntimeError(`Unable to decompress zstd workspace archive${detail ? `: ${detail}` : "."}`, { cause });
  }
}

function tarSink(extractor) {
  return new Writable({
    write(chunk, _encoding, callback) {
      extractor.push(Buffer.from(chunk)).then(() => callback(), callback);
    },
    final(callback) {
      extractor.finish().then(() => callback(), callback);
    },
  });
}

class SafeTarExtractor {
  constructor(destination, { maxExpandedBytes, maxFileCount }) {
    this.destination = resolve(destination);
    this.maxExpandedBytes = maxExpandedBytes;
    this.maxFileCount = maxFileCount;
    this.buffer = Buffer.alloc(0);
    this.state = "header";
    this.current = null;
    this.paddingRemaining = 0;
    this.sawEnd = false;
    this.expandedBytes = 0;
    this.entries = [];
    this.paths = new Set();
    this.sawGitGlobalPaxHeader = false;
  }

  async push(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    while (true) {
      if (this.state === "header") {
        if (this.buffer.length < 512) return;
        const header = this.take(512);
        if (isZeroBlock(header)) {
          this.sawEnd = true;
          continue;
        }
        if (this.sawEnd) {
          throw new ContainerWorkspaceRuntimeError("tar.zst contains bytes after the archive end marker.");
        }
        this.current = await this.openEntry(parseTarHeader(header, this));
        this.state = this.current.remaining === 0 ? "padding" : "file";
        if (this.current.remaining === 0) await this.closeCurrentEntry();
        continue;
      }
      if (this.state === "file") {
        if (this.buffer.length === 0) return;
        const length = Math.min(this.buffer.length, this.current.remaining);
        const content = this.take(length);
        if (this.current.kind === "file") {
          await writeAll(this.current.handle, content);
          this.current.hash.update(content);
        } else {
          this.current.chunks.push(content);
        }
        this.current.remaining -= length;
        if (this.current.remaining === 0) {
          await this.closeCurrentEntry();
          this.state = "padding";
        }
        continue;
      }
      if (this.state === "padding") {
        if (this.paddingRemaining === 0) {
          this.state = "header";
          continue;
        }
        if (this.buffer.length === 0) return;
        const length = Math.min(this.buffer.length, this.paddingRemaining);
        const padding = this.take(length);
        if (padding.some((byte) => byte !== 0)) {
          throw new ContainerWorkspaceRuntimeError("tar.zst contains non-zero file padding.");
        }
        this.paddingRemaining -= length;
      }
    }
  }

  async finish() {
    if (this.current || this.state !== "header" || this.buffer.length !== 0 || !this.sawEnd) {
      throw new ContainerWorkspaceRuntimeError("tar.zst ended before a complete valid archive was extracted.");
    }
  }

  take(length) {
    const value = this.buffer.subarray(0, length);
    this.buffer = this.buffer.subarray(length);
    return value;
  }

  async openEntry(entry) {
    if (entry.kind === "git-global-pax") {
      if (this.sawGitGlobalPaxHeader || this.paths.size > 0) {
        throw new ContainerWorkspaceRuntimeError("tar.zst Git provenance header must appear exactly once before workspace files.");
      }
      if (entry.size > 128 || entry.size > this.maxExpandedBytes - this.expandedBytes) {
        throw new ContainerWorkspaceRuntimeError("tar.zst Git provenance header exceeds its bounded size limit.");
      }
      this.sawGitGlobalPaxHeader = true;
      this.expandedBytes += entry.size;
      return {
        ...entry,
        remaining: entry.size,
        chunks: [],
      };
    }

    const { path, mode, size } = entry;
    if (this.paths.has(path)) {
      throw new ContainerWorkspaceRuntimeError("tar.zst contains duplicate workspace paths.");
    }
    if (this.paths.size >= this.maxFileCount) {
      throw new ContainerWorkspaceRuntimeError("tar.zst exceeds the declared workspace file-count limit.");
    }
    if (size > this.maxExpandedBytes - this.expandedBytes) {
      throw new ContainerWorkspaceRuntimeError("tar.zst exceeds the declared expanded-byte limit.");
    }
    this.paths.add(path);
    this.expandedBytes += size;
    const target = workspaceChild(this.destination, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o755 });
    if (entry.kind === "directory") {
      await mkdir(target, { mode: 0o755 });
      return {
        kind: "directory",
        path,
        target,
        mode: 0o755,
        size: 0,
        remaining: 0,
      };
    }
    const handle = await open(target, "wx", mode);
    return {
      kind: "file",
      path,
      target,
      mode,
      size,
      remaining: size,
      handle,
      hash: createHash("sha256"),
    };
  }

  async closeCurrentEntry() {
    const entry = this.current;
    if (entry.kind === "git-global-pax") {
      validateGitGlobalPaxHeader(Buffer.concat(entry.chunks, entry.size));
      this.paddingRemaining = (512 - (entry.size % 512)) % 512;
      this.current = null;
      return;
    }
    if (entry.kind === "directory") {
      await chmod(entry.target, entry.mode);
      this.paddingRemaining = 0;
      this.current = null;
      return;
    }
    await entry.handle.close();
    await chmod(entry.target, entry.mode);
    this.entries.push({
      path: entry.path,
      mode: entry.mode,
      contentHash: `sha256:${entry.hash.digest("hex")}`,
    });
    this.paddingRemaining = (512 - (entry.size % 512)) % 512;
    this.current = null;
  }
}

function parseTarHeader(header) {
  verifyTarChecksum(header);
  const type = header[156];
  if (type === 103) {
    const name = readTarString(header.subarray(0, 100), "tar metadata name");
    const prefix = readTarString(header.subarray(345, 500), "tar metadata prefix");
    const linkName = readTarString(header.subarray(157, 257), "tar metadata link target");
    if (name !== "pax_global_header" || prefix || linkName) {
      throw new ContainerWorkspaceRuntimeError("tar.zst contains an unsupported global PAX header.");
    }
    return {
      kind: "git-global-pax",
      size: parseTarOctal(header.subarray(124, 136), "tar metadata size"),
    };
  }
  const linkName = readTarString(header.subarray(157, 257), "tar link target");
  if (linkName) {
    throw new ContainerWorkspaceRuntimeError("tar.zst entries may not contain a link target.");
  }
  const isDirectory = type === 53;
  if (!isDirectory && type !== 0 && type !== 48) {
    throw new ContainerWorkspaceRuntimeError("tar.zst may contain only regular files and directories; links and other entry types are forbidden.");
  }
  const name = readTarString(header.subarray(0, 100), "tar path");
  const prefix = readTarString(header.subarray(345, 500), "tar path prefix");
  const archivedPath = prefix ? `${prefix}/${name}` : name;
  const path = isDirectory && archivedPath.endsWith("/") ? archivedPath.slice(0, -1) : archivedPath;
  requireWorkspacePath(path, "tar path");
  const archivedMode = parseTarOctal(header.subarray(100, 108), "tar mode");
  const size = parseTarOctal(header.subarray(124, 136), "tar file size");
  if (isDirectory) {
    if (size !== 0) {
      throw new ContainerWorkspaceRuntimeError("tar.zst directory entries must be empty.");
    }
    if (archivedMode !== 0o755 && archivedMode !== 0o775) {
      throw new ContainerWorkspaceRuntimeError("tar.zst directory mode must normalize exactly to 0755.");
    }
    return { kind: "directory", path, mode: 0o755, size: 0 };
  }
  const mode = archivedMode === 0o644 || archivedMode === 0o664
    ? 0o644
    : archivedMode === 0o755 || archivedMode === 0o775
      ? 0o755
      : null;
  if (mode === null) {
    throw new ContainerWorkspaceRuntimeError("tar.zst file mode must normalize exactly to 0644 or 0755.");
  }
  return { kind: "file", path, mode, size };
}

function validateGitGlobalPaxHeader(bytes) {
  const text = Buffer.from(bytes).toString("ascii");
  const match = /^(\d+) comment=([0-9a-f]{40}|[0-9a-f]{64})\n$/.exec(text);
  if (!match || Number.parseInt(match[1], 10) !== bytes.byteLength) {
    throw new ContainerWorkspaceRuntimeError("tar.zst global PAX header is not a bounded Git commit provenance record.");
  }
}

function legacyConnectorWorkspaceTreeHash(entries) {
  const legacyEntries = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  return `sha256:${createHash("sha256").update(canonicalJson({
    protocolVersion: "pw-tree-v1",
    entries: legacyEntries,
  })).digest("hex")}`;
}

function verifyTarChecksum(header) {
  const expected = parseTarOctal(header.subarray(148, 156), "tar checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (expected !== actual) throw new ContainerWorkspaceRuntimeError("tar.zst header checksum is invalid.");
}

function parseTarOctal(bytes, label) {
  const text = readTarAscii(bytes, label).replace(/\0.*$/s, "").trim();
  if (text.length === 0) return 0;
  if (!/^[0-7]+$/.test(text)) {
    throw new ContainerWorkspaceRuntimeError(`${label} must be an octal number.`);
  }
  const value = Number.parseInt(text, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContainerWorkspaceRuntimeError(`${label} is outside the supported range.`);
  }
  return value;
}

function readTarString(bytes, label) {
  return readTarAscii(bytes, label).replace(/\0.*$/s, "");
}

function readTarAscii(bytes, label) {
  if (bytes.some((byte) => byte !== 0 && (byte < 32 || byte > 126))) {
    throw new ContainerWorkspaceRuntimeError(`${label} contains unsupported bytes.`);
  }
  return Buffer.from(bytes).toString("ascii");
}

function isZeroBlock(block) {
  return block.every((byte) => byte === 0);
}

async function applyNormalizedPatch({ patchPath, workspaceDirectory, command }) {
  const patch = await readFile(patchPath);
  if (patch.length > maxIngressArtifactBytes) {
    throw new ContainerWorkspaceRuntimeError("normalized.patch exceeds the private artifact byte limit.");
  }
  const source = decodeUtf8(patch, "normalized.patch");
  validateNormalizedPatch(source);
  await runPatch(command, patchPath, workspaceDirectory);
}

function validateNormalizedPatch(source) {
  if (source.length === 0 || source.includes("\0") || source.includes("\r")) {
    throw new ContainerWorkspaceRuntimeError("normalized.patch must be a non-empty LF-only UTF-8 unified diff.");
  }
  const lines = source.split("\n");
  let expected = null;
  let activeFile = null;
  let inHunk = false;
  let fileCount = 0;
  let hunkCount = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (expected) throw new ContainerWorkspaceRuntimeError("normalized.patch has an incomplete file header.");
      if (activeFile && !activeFile.sawHunk) {
        throw new ContainerWorkspaceRuntimeError("normalized.patch file header has no unified hunk.");
      }
      const fields = line.split(" ");
      if (fields.length !== 4) throw new ContainerWorkspaceRuntimeError("normalized.patch diff header is invalid.");
      const oldPath = normalizePatchPath(fields[2], "a", false);
      const newPath = normalizePatchPath(fields[3], "b", false);
      expected = { oldPath, newPath, sawOld: false };
      activeFile = null;
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith("--- ")) {
      if (!expected || expected.sawOld) throw new ContainerWorkspaceRuntimeError("normalized.patch has an unexpected old-file header.");
      const oldPath = normalizePatchPath(firstPatchToken(line.slice(4)), "a", true);
      if (oldPath !== null && oldPath !== expected.oldPath) {
        throw new ContainerWorkspaceRuntimeError("normalized.patch old-file path disagrees with its diff header.");
      }
      expected.sawOld = true;
      continue;
    }
    if (!inHunk && line.startsWith("+++ ")) {
      if (!expected || !expected.sawOld) throw new ContainerWorkspaceRuntimeError("normalized.patch has an unexpected new-file header.");
      const newPath = normalizePatchPath(firstPatchToken(line.slice(4)), "b", true);
      if (newPath !== null && newPath !== expected.newPath) {
        throw new ContainerWorkspaceRuntimeError("normalized.patch new-file path disagrees with its diff header.");
      }
      if (expected.oldPath === null && expected.newPath === null) {
        throw new ContainerWorkspaceRuntimeError("normalized.patch cannot map /dev/null to /dev/null.");
      }
      activeFile = { sawHunk: false };
      expected = null;
      fileCount += 1;
      continue;
    }
    if (line.startsWith("@@")) {
      if (!activeFile) throw new ContainerWorkspaceRuntimeError("normalized.patch hunk has no file header.");
      activeFile.sawHunk = true;
      inHunk = true;
      hunkCount += 1;
      continue;
    }
    if (!inHunk && /^(?:rename |copy |similarity index|dissimilarity index|old mode |new mode |deleted file mode |new file mode |Binary files )/.test(line)) {
      throw new ContainerWorkspaceRuntimeError("normalized.patch contains an unsupported non-content operation.");
    }
  }
  if (expected || !activeFile?.sawHunk || fileCount === 0 || hunkCount === 0) {
    throw new ContainerWorkspaceRuntimeError("normalized.patch must contain complete Git-style unified diff headers.");
  }
}

function normalizePatchPath(value, prefix, allowDevNull) {
  if (allowDevNull && value === "/dev/null") return null;
  if (!value.startsWith(`${prefix}/`)) {
    throw new ContainerWorkspaceRuntimeError("normalized.patch path has an invalid prefix.");
  }
  const path = value.slice(prefix.length + 1);
  requireWorkspacePath(path, "normalized.patch path");
  return path;
}

function firstPatchToken(value) {
  return value.split("\t", 1)[0].split(" ", 1)[0];
}

async function runPatch(command, patchPath, workspaceDirectory) {
  const child = spawn(command, [
    "--batch",
    "--forward",
    "--fuzz=0",
    "--posix",
    "--strip=1",
    "--reject-file=-",
    "--input", patchPath,
  ], {
    cwd: workspaceDirectory,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stdout = collectOutput(child.stdout, maxPatchOutputBytes);
  const stderr = collectOutput(child.stderr, maxPatchOutputBytes);
  const timeout = setTimeout(() => child.kill("SIGKILL"), patchTimeoutMilliseconds);
  let result;
  try {
    result = await waitForExit(child);
  } catch (cause) {
    throw new ContainerWorkspaceRuntimeError("Unable to start the fixed patch executable.", { cause });
  } finally {
    clearTimeout(timeout);
  }
  const output = [await stdout, await stderr].filter(Boolean).join("\n");
  if (result.code !== 0 || result.signal) {
    throw new ContainerWorkspaceRuntimeError(`normalized.patch could not be applied without fuzz${output ? `: ${output}` : "."}`);
  }
}

async function replaceLakeManifest({ lakeManifestPath, workspaceDirectory }) {
  const destination = workspaceChild(workspaceDirectory, "lake-manifest.json");
  const existing = await lstat(destination).catch((cause) => cause?.code === "ENOENT" ? null : Promise.reject(cause));
  if (existing && !existing.isFile()) {
    throw new ContainerWorkspaceRuntimeError("lake-manifest.json destination is not a regular file.");
  }
  await copyFile(lakeManifestPath, destination);
  await chmod(destination, 0o644);
}

async function readWorkspaceTree(workspaceDirectory, { maxExpandedBytes, maxFileCount }) {
  const entries = [];
  let expandedBytes = 0;
  await visit(workspaceDirectory, "");
  return entries;

  async function visit(directory, prefix) {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const child of children) {
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      requireWorkspacePath(path, "workspace path");
      const absolute = workspaceChild(workspaceDirectory, path);
      const stats = await lstat(absolute);
      if (stats.isDirectory()) {
        await visit(absolute, path);
        continue;
      }
      if (!stats.isFile()) {
        throw new ContainerWorkspaceRuntimeError("Reconstructed workspace may contain only regular files and directories.");
      }
      const mode = stats.mode & 0o777;
      if (![0o644, 0o755].includes(mode)) {
        throw new ContainerWorkspaceRuntimeError("Reconstructed workspace file mode must be 0644 or 0755.");
      }
      if (entries.length >= maxFileCount || stats.size > maxExpandedBytes - expandedBytes) {
        throw new ContainerWorkspaceRuntimeError("Reconstructed workspace exceeds the declared archive limits.");
      }
      expandedBytes += stats.size;
      entries.push({ path, mode, contentHash: await sha256File(absolute) });
    }
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return `sha256:${hash.digest("hex")}`;
}

async function streamBodyToFile(body, destination, { expectedByteLength, maximumByteLength }) {
  const temporary = `${destination}.${crypto.randomUUID()}.partial`;
  const handle = await open(temporary, "wx", 0o600);
  const hash = createHash("sha256");
  let byteLength = 0;
  try {
    for await (const chunk of bodyChunks(body)) {
      const bytes = Buffer.from(chunk);
      byteLength += bytes.byteLength;
      if (byteLength > expectedByteLength || byteLength > maximumByteLength) {
        throw new ContainerWorkspaceRuntimeError("Private artifact body exceeds its declared byte limit.");
      }
      hash.update(bytes);
      await writeAll(handle, bytes);
    }
    if (byteLength !== expectedByteLength) {
      throw new ContainerWorkspaceRuntimeError("Private artifact body length does not match its immutable declaration.");
    }
    await handle.close();
    await rename(temporary, destination);
  } catch (cause) {
    await handle.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw cause;
  }
  return Object.freeze({ contentHash: `sha256:${hash.digest("hex")}`, byteLength });
}

async function* bodyChunks(body) {
  if (!body) throw new ContainerWorkspaceRuntimeError("Private artifact upload has no body.");
  if (body instanceof Uint8Array || Buffer.isBuffer(body)) {
    yield body;
    return;
  }
  if (typeof body[Symbol.asyncIterator] === "function") {
    for await (const chunk of body) yield chunk;
    return;
  }
  if (typeof body.getReader === "function") {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  throw new ContainerWorkspaceRuntimeError("Private artifact body is not a readable byte stream.");
}

async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset);
    offset += result.bytesWritten;
  }
}

function assertArtifactMetadata(id, metadata, expected) {
  if (metadata.role !== undefined && metadata.role !== id) {
    throw new ContainerWorkspaceRuntimeError("Private artifact role does not match its upload endpoint.");
  }
  if (metadata.contentHash !== undefined && metadata.contentHash !== expected.contentHash) {
    throw new ContainerWorkspaceRuntimeError("Private artifact hash header does not match its immutable declaration.");
  }
  if (metadata.contentType !== undefined && metadata.contentType !== expected.contentType) {
    throw new ContainerWorkspaceRuntimeError("Private artifact content type does not match its immutable declaration.");
  }
  if (metadata.byteLength !== undefined && metadata.byteLength !== expected.byteLength) {
    throw new ContainerWorkspaceRuntimeError("Private artifact content length does not match its immutable declaration.");
  }
}

function parseIngressRoute(request) {
  const pathname = new URL(request.url).pathname;
  const match = /^\/v1\/runs\/([^/]+)\/workspace(?:\/artifacts\/(source-archive|source-patch|lake-manifest)|\/(finalize|execute|cancel|complete)|\/result\/(stdout|stderr))?$/.exec(pathname);
  if (!match) return null;
  let runId;
  try {
    runId = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  if (!runId || runId.includes("/")) return null;
  if (match[2]) return { kind: "artifact", runId, artifactId: artifactEndpoints[match[2]] };
  if (match[3]) return { kind: match[3], runId };
  if (match[4]) return { kind: match[4], runId };
  return { kind: "declare", runId };
}

async function readBoundedText(body, maximumBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of bodyChunks(body)) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maximumBytes) throw new ContainerWorkspaceRuntimeError("Workspace declaration exceeds the private size limit.");
    chunks.push(bytes);
  }
  return decodeUtf8(Buffer.concat(chunks), "workspace declaration");
}

function decodeUtf8(value, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch (cause) {
    throw new ContainerWorkspaceRuntimeError(`${label} must be valid UTF-8.`, { cause });
  }
}

function parseContentLength(value) {
  if (value === null || !/^\d+$/.test(value)) {
    throw new ContainerWorkspaceRuntimeError("Private artifact upload requires an exact Content-Length.");
  }
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new ContainerWorkspaceRuntimeError("Private artifact Content-Length is invalid.");
  }
  return length;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function executionPendingResponse() {
  return new Response(null, {
    status: 202,
    headers: { "retry-after": "1" },
  });
}

function rejectionResponse(error, diagnosticCode = null) {
  const headers = { "content-type": "application/json; charset=utf-8" };
  if (diagnosticCode) headers["x-proofweave-error-code"] = diagnosticCode;
  return new Response(JSON.stringify({ error }), { status: 400, headers });
}

function privateContainerFailureCode(cause, route) {
  if (route?.kind !== "execute") return null;
  if (typeof cause?.diagnosticCode === "string" && /^lean_[a-z0-9_]{3,48}$/.test(cause.diagnosticCode)) {
    return cause.diagnosticCode;
  }
  return "lean_execution_internal_failed";
}

function methodNotAllowed(allow) {
  return new Response(null, { status: 405, headers: { allow } });
}

function workspaceChild(root, path) {
  const absolute = resolve(root, path);
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`)) {
    throw new ContainerWorkspaceRuntimeError("Workspace path escapes its private directory.");
  }
  return absolute;
}

function requireWorkspacePath(path, label) {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new ContainerWorkspaceRuntimeError(`${label} must be a bounded relative POSIX path.`);
  }
  const segments = path.split("/");
  if (segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(segment) || segment === "." || segment === "..")) {
    throw new ContainerWorkspaceRuntimeError(`${label} contains an unsafe path segment.`);
  }
}

function requireAbsoluteDirectory(value, label) {
  if (typeof value !== "string" || value.length === 0 || !value.startsWith("/") || relative(resolve(value), value).startsWith("..")) {
    throw new TypeError(`${label} must be an absolute directory path.`);
  }
}

function collectOutput(stream, maximumBytes) {
  if (!stream) return Promise.resolve("");
  return new Promise((resolveOutput, rejectOutput) => {
    const chunks = [];
    let length = 0;
    stream.on("data", (chunk) => {
      if (length >= maximumBytes) return;
      const bytes = Buffer.from(chunk);
      const allowed = bytes.subarray(0, maximumBytes - length);
      chunks.push(allowed);
      length += allowed.length;
    });
    stream.on("error", rejectOutput);
    stream.on("end", () => resolveOutput(Buffer.concat(chunks).toString("utf8").trim()));
  });
}

function waitForExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    child.once("error", rejectExit);
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
}
