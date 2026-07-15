#!/usr/bin/env node
/**
 * A dependency-free, local STDIO MCP bridge for the closed Proofweave beta.
 *
 * It creates an Ed25519 Agent key on this computer, completes OAuth 2.1 PKCE
 * through the user's browser, and stores the resulting refresh token in a
 * mode-0600 local file. It never reads a Codex workspace or copies a ChatGPT
 * session, API key, or Proofweave token into a prompt.
 */
import { createServer } from "node:http";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import readline from "node:readline";

const baseUrl = normalizeBaseUrl(process.env.PROOFWEAVE_BASE_URL ?? "https://proofweave-research.yualex031821.chatgpt.site");
const callbackHost = "127.0.0.1";
const callbackPort = 44765;
const callbackPath = "/callback";
const redirectUri = `http://${callbackHost}:${callbackPort}${callbackPath}`;
const configPath = process.env.PROOFWEAVE_CONNECTOR_CONFIG ?? join(homedir(), ".proofweave", "codex-connector.json");
const localEvidencePreviewLimits = { maxFiles: 6, maxFileBytes: 1_000_000, maxTotalBytes: 3_000_000 };
const toolDefinitions = [
  tool("connect_proofweave", "Connect this local Codex to Proofweave with a one-time browser approval. It generates an Agent key on this computer; no key needs to be pasted.", { type: "object", additionalProperties: false, properties: {} }),
  tool("connection_status", "Show whether this local Connector has a revocable Proofweave connection. It does not contact Proofweave.", { type: "object", additionalProperties: false, properties: {} }),
  tool("list_frontier_problems", "List Proofweave frontier problems available to this connected Agent.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } }),
  tool("inspect_problem", "Read a source-pinned Proofweave frontier problem before starting local work.", { type: "object", additionalProperties: false, properties: { slug: { type: "string", minLength: 1, maxLength: 160 } }, required: ["slug"] }),
  tool("create_attempt", "Create a bounded Proofweave Attempt for the connected Agent. Use an idempotency key so retried work does not create duplicate attempts.", { type: "object", additionalProperties: false, properties: { problemSlug: { type: "string", minLength: 1, maxLength: 160 }, delegationScope: { type: "string", enum: ["formalize", "prove"] }, idempotencyKey: { type: "string", minLength: 1, maxLength: 160 } }, required: ["problemSlug", "delegationScope", "idempotencyKey"] }),
  tool("report_progress", "Record a concise provisional progress update for one of this Agent's Attempts. This is not Lean verification or a contribution receipt.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, message: { type: "string", minLength: 1, maxLength: 4000 }, progressPercent: { type: "integer", minimum: 0, maximum: 100 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 160 } }, required: ["attemptId", "message", "progressPercent", "idempotencyKey"] }),
  tool("list_attempts", "List bounded Attempts attributed to this exact local Agent.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } }),
  tool("get_attempt", "Read one Attempt attributed to this exact local Agent.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 } }, required: ["attemptId"] }),
  tool("preview_local_evidence", "Preview up to six explicitly owner-selected local files for one authorized Attempt. It returns only each filename, byte size, and SHA-256 hash; it never uploads, stages, runs, or verifies anything.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, paths: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 1000 } } }, required: ["attemptId", "paths"] }),
  tool("submit_local_evidence", "Submit up to six explicitly owner-approved local files as immutable artifact objects for one authorized Attempt. This sends the selected bytes to Proofweave only when the current hashes match the exact preview the owner confirmed. It does not stage a Bundle, run Lean, or verify a proof.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, paths: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 1000 } }, expectedSha256: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } }, ownerConfirmation: { type: "string", enum: ["I_CONFIRM_SUBMIT"] } }, required: ["attemptId", "paths", "expectedSha256", "ownerConfirmation"] }),
  tool("prepare_artifact_bundle_v2", "Prepare a locally signed, executable Proofweave v2 Artifact Bundle draft from three explicitly owner-selected artifacts: source.tar.zst, normalized.patch, and lake-manifest.json. It does not upload, stage, run Lean, or create credit.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, artifacts: bundleArtifactPathsSchema(), workspaceTree: { type: "array", minItems: 1, maxItems: 100000, items: workspaceTreeEntrySchema() }, maxExpandedBytes: { type: "integer", minimum: 1, maximum: 17179869184 }, maxFileCount: { type: "integer", minimum: 1, maximum: 100000 }, entryFile: { type: "string", minLength: 6, maxLength: 1024 }, allowedAxioms: { type: "array", maxItems: 256, items: { type: "string", minLength: 1, maxLength: 240 } } }, required: ["attemptId", "artifacts", "workspaceTree", "maxExpandedBytes", "maxFileCount", "entryFile"] }),
  tool("stage_prepared_artifact_bundle", "Upload the exact three owner-approved Artifact Bundle files and stage one locally signed v2 Bundle. Call only after the owner explicitly confirms the prepared manifest hash and exact file hashes. A successful result records bundle_staged evidence only; it does not run Lean, review, or issue a receipt.", { type: "object", additionalProperties: false, properties: { bundle: { type: "object" }, artifacts: bundleArtifactPathsSchema(), expectedArtifactSha256: expectedBundleArtifactHashesSchema(), expectedBundleHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, ownerConfirmation: { type: "string", enum: ["I_CONFIRM_STAGE_BUNDLE"] } }, required: ["bundle", "artifacts", "expectedArtifactSha256", "expectedBundleHash", "ownerConfirmation"] }),
];

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => { void handleLine(line); });

async function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    respond({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return;
  if (request.method.startsWith("notifications/")) return;
  try {
    const result = await handleRequest(request.method, request.params ?? {});
    respond({ jsonrpc: "2.0", id: request.id ?? null, result });
  } catch (error) {
    respond({ jsonrpc: "2.0", id: request.id ?? null, error: { code: -32000, message: messageFor(error) } });
  }
}

async function handleRequest(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion ?? "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "proofweave-local", version: "0.2.0" },
      instructions: "Use connect_proofweave before requesting Proofweave data. Local work remains on this computer unless a selected tool records a bounded event.",
    };
  }
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: toolDefinitions };
  if (method !== "tools/call") throw new Error(`Unsupported MCP method: ${method}`);
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
  if (name === "connect_proofweave") return connectionResult(await connect());
  if (name === "connection_status") return connectionResult(await connectionStatus());
  if (name === "preview_local_evidence") return connectionResult(await previewLocalEvidence(args));
  if (name === "submit_local_evidence") return connectionResult(await submitLocalEvidence(args));
  if (name === "prepare_artifact_bundle_v2") return connectionResult(await prepareArtifactBundleV2(args));
  if (name === "stage_prepared_artifact_bundle") return connectionResult(await stagePreparedArtifactBundle(args));
  if (!toolDefinitions.some((item) => item.name === name)) return toolError(`Unknown Proofweave tool: ${name}`);
  const result = await callRemoteTool(name, args);
  return result;
}

async function previewLocalEvidence(args) {
  const attemptId = requiredLocalString(args.attemptId, "attemptId", 240);
  const paths = normalizeEvidencePaths(args.paths);

  // This read establishes that the requested Attempt remains available to this
  // exact connected Agent before any user-selected local file is opened.
  await callRemoteTool("get_attempt", { attemptId });
  const files = await readSelectedEvidence(paths);

  return {
    attemptId,
    operation: "local_evidence_preview",
    uploaded: false,
    staged: false,
    verificationState: "not_recorded",
    files: files.map(localEvidenceSummary),
    next: "Review this minimal file list with the owner. A separate explicit artifact-staging action is required before any file can leave this computer.",
  };
}

async function submitLocalEvidence(args) {
  const attemptId = requiredLocalString(args.attemptId, "attemptId", 240);
  const paths = normalizeEvidencePaths(args.paths);
  const expectedSha256 = normalizeExpectedEvidenceHashes(args.expectedSha256, paths.length);
  if (args.ownerConfirmation !== "I_CONFIRM_SUBMIT") {
    throw new Error("The owner must explicitly confirm this exact submission before selected file bytes can leave this computer.");
  }

  // Check current authority before reading or sending local bytes.
  await callRemoteTool("get_attempt", { attemptId });
  const files = await readSelectedEvidence(paths);
  for (let index = 0; index < files.length; index += 1) {
    if (files[index].sha256 !== expectedSha256[index]) {
      throw new Error(`Selected evidence changed since the owner reviewed it: ${files[index].filename}. Preview the exact files again before submitting.`);
    }
  }
  const staged = [];
  for (const file of files) {
    const response = await callRemoteTool("put_artifact_object", {
      attemptId,
      filename: file.filename,
      contentType: evidenceContentType(file.filename),
      contentBase64Url: file.contents.toString("base64url"),
    });
    staged.push({ ...localEvidenceSummary(file), ...remoteObjectSummary(response) });
  }

  return {
    attemptId,
    operation: "local_evidence_submission",
    uploaded: true,
    storageState: "object_staged_only",
    verificationState: "not_verified",
    files: staged,
    next: "These immutable objects are stored, but no Artifact Bundle, Lean Run, review, or Contribution Receipt exists yet.",
  };
}

async function prepareArtifactBundleV2(args) {
  const attemptId = requiredLocalString(args.attemptId, "attemptId", 240);
  const artifactPaths = normalizeBundleArtifactPaths(args.artifacts);
  const attempt = await requireRemoteAttempt(attemptId);
  const problem = await requireRemoteProblem(attempt.problemSlug);
  const artifacts = await readBundleArtifacts(artifactPaths);
  const workspaceTree = normalizeWorkspaceTree(args.workspaceTree);
  const entryFile = normalizeBundleEntryFile(args.entryFile);
  const limits = normalizeWorkspaceLimits(args.maxExpandedBytes, args.maxFileCount);
  const allowedAxioms = normalizeAllowedAxioms(args.allowedAxioms ?? []);
  assertWorkspaceTreeMatchesInputs(workspaceTree, artifacts, entryFile);
  const config = await requireConfig();
  const bundle = createSignedArtifactBundleV2({
    config,
    attempt,
    problem,
    artifacts,
    workspaceTree,
    entryFile,
    limits,
    allowedAxioms,
  });
  const manifestHash = sha256Canonical(bundle);

  return {
    attemptId,
    operation: "local_bundle_preparation",
    uploaded: false,
    staged: false,
    verificationState: "not_recorded",
    manifestHash,
    artifacts: bundleArtifactSummary(artifacts),
    bundle,
    next: "Show the owner this manifest hash and exact three-file hash list. A separate explicit bundle-staging action is required before any file bytes leave this computer.",
  };
}

async function stagePreparedArtifactBundle(args) {
  if (args.ownerConfirmation !== "I_CONFIRM_STAGE_BUNDLE") {
    throw new Error("The owner must explicitly confirm the exact prepared Bundle before its files can be uploaded and staged.");
  }
  const expectedBundleHash = requireSha256(args.expectedBundleHash, "expectedBundleHash");
  const artifactPaths = normalizeBundleArtifactPaths(args.artifacts);
  const expectedArtifactHashes = normalizeExpectedBundleArtifactHashes(args.expectedArtifactSha256);
  const bundle = requireBundleRecord(args.bundle);
  const attempt = await requireRemoteAttempt(bundle.attemptId);
  const problem = await requireRemoteProblem(attempt.problemSlug);
  const config = await requireConfig();
  const artifacts = await readBundleArtifacts(artifactPaths);
  assertBundleMatchesCurrentEvidence({ bundle, expectedBundleHash, expectedArtifactHashes, artifacts, attempt, problem, config });

  const objectRecords = [];
  for (const artifact of [artifacts.sourceArchive, artifacts.patch, artifacts.lakeManifest]) {
    const response = await callRemoteTool("put_artifact_object", {
      attemptId: bundle.attemptId,
      filename: artifact.filename,
      contentType: artifact.contentType,
      contentBase64Url: artifact.contents.toString("base64url"),
    });
    const remote = remoteObjectSummary(response);
    const expectedKey = artifactObjectKey(artifact.sha256, artifact.filename);
    if (remote.contentHash !== artifact.sha256 || remote.objectKey !== expectedKey) {
      throw new Error(`Proofweave did not confirm the expected immutable object for ${artifact.filename}.`);
    }
    objectRecords.push({ ...localEvidenceSummary(artifact), objectKey: remote.objectKey });
  }

  const staged = parseRemoteToolJson(await callRemoteTool("stage_artifact_bundle", { bundle }), "stage_artifact_bundle");
  if (staged?.storageState !== "bundle_staged_only" || staged?.verificationState !== "not_verified" || !staged?.bundle?.manifestHash) {
    throw new Error("Proofweave did not return a valid staged Bundle record.");
  }
  if (staged.bundle.id !== bundle.id || staged.bundle.manifestHash !== expectedBundleHash) {
    throw new Error("Proofweave staged a Bundle different from the owner-approved manifest.");
  }
  return {
    attemptId: bundle.attemptId,
    operation: "local_bundle_staging",
    uploaded: true,
    storageState: "bundle_staged_only",
    verificationState: "not_verified",
    bundle: {
      id: staged.bundle.id,
      manifestHash: staged.bundle.manifestHash,
      manifestKey: staged.bundle.manifestKey,
      agentEventId: staged.bundle.agentEventId,
    },
    artifacts: objectRecords,
    next: "The signed Bundle is now immutable and attributable. It still needs a separately configured isolated Lean Run and independent review before any final contribution claim.",
  };
}

async function readSelectedEvidence(paths) {
  const files = [];
  let totalBytes = 0;
  for (const path of paths) {
    if (!isAbsolute(path)) throw new Error("Each evidence path must be an absolute path selected by the owner.");
    const filename = basename(path);
    assertSafeEvidenceFilename(filename);
    const metadata = await lstat(path).catch((error) => {
      if (error?.code === "ENOENT") throw new Error(`Selected evidence file was not found: ${filename}`);
      throw new Error(`Selected evidence file could not be inspected: ${filename}`);
    });
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`Selected evidence must be a regular file, not a directory or link: ${filename}`);
    }
    if (metadata.size > localEvidencePreviewLimits.maxFileBytes) {
      throw new Error(`Selected evidence exceeds the ${localEvidencePreviewLimits.maxFileBytes} byte alpha limit: ${filename}`);
    }
    const contents = await readFile(path);
    if (contents.byteLength > localEvidencePreviewLimits.maxFileBytes) {
      throw new Error(`Selected evidence changed and now exceeds the ${localEvidencePreviewLimits.maxFileBytes} byte alpha limit: ${filename}`);
    }
    totalBytes += contents.byteLength;
    if (totalBytes > localEvidencePreviewLimits.maxTotalBytes) {
      throw new Error(`Selected evidence exceeds the ${localEvidencePreviewLimits.maxTotalBytes} byte combined alpha limit.`);
    }
    files.push({
      filename,
      bytes: contents.byteLength,
      sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
      contents,
    });
  }
  return files;
}

async function requireRemoteAttempt(attemptId) {
  const value = parseRemoteToolJson(await callRemoteTool("get_attempt", { attemptId }), "get_attempt");
  if (!value?.attempt || value.attempt.id !== attemptId || typeof value.attempt.problemSlug !== "string" || typeof value.attempt.problemRevisionId !== "string") {
    throw new Error("Proofweave did not return an authorized Attempt for this local Bundle.");
  }
  return value.attempt;
}

async function requireRemoteProblem(slug) {
  const value = parseRemoteToolJson(await callRemoteTool("inspect_problem", { slug }), "inspect_problem");
  if (!value || typeof value !== "object" || value.slug !== slug) {
    throw new Error("Proofweave did not return the source-pinned target for this Attempt.");
  }
  if (!value.declaration?.qualifiedName || !isSha256(value.declaration?.sourceContentHash) || !value.source?.leanToolchain || !value.source?.mathlibRevision) {
    throw new Error("The selected target is missing the immutable declaration or Lean environment required for a Bundle.");
  }
  return value;
}

function parseRemoteToolJson(response, toolName) {
  const text = Array.isArray(response?.content)
    ? response.content.find((item) => item?.type === "text" && typeof item.text === "string")?.text
    : null;
  if (!text) throw new Error(`Proofweave returned no readable result for ${toolName}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Proofweave returned an invalid result for ${toolName}.`);
  }
}

function bundleArtifactPathsSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      sourceArchivePath: { type: "string", minLength: 1, maxLength: 1000 },
      patchPath: { type: "string", minLength: 1, maxLength: 1000 },
      lakeManifestPath: { type: "string", minLength: 1, maxLength: 1000 },
    },
    required: ["sourceArchivePath", "patchPath", "lakeManifestPath"],
  };
}

function expectedBundleArtifactHashesSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      sourceArchive: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      patch: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      lakeManifest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    },
    required: ["sourceArchive", "patch", "lakeManifest"],
  };
}

function workspaceTreeEntrySchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", minLength: 1, maxLength: 1024 },
      mode: { type: "integer", enum: [420, 493] },
      contentHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    },
    required: ["path", "mode", "contentHash"],
  };
}

function normalizeBundleArtifactPaths(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bundle artifact paths are required.");
  const paths = {
    sourceArchivePath: requiredLocalString(value.sourceArchivePath, "sourceArchivePath", 1000),
    patchPath: requiredLocalString(value.patchPath, "patchPath", 1000),
    lakeManifestPath: requiredLocalString(value.lakeManifestPath, "lakeManifestPath", 1000),
  };
  if (new Set(Object.values(paths)).size !== 3) throw new Error("Each Bundle artifact must use a different local file.");
  return paths;
}

async function readBundleArtifacts(paths) {
  const files = await readSelectedEvidence([paths.sourceArchivePath, paths.patchPath, paths.lakeManifestPath]);
  const [sourceArchive, patch, lakeManifest] = files;
  if (sourceArchive.filename !== "source.tar.zst" || patch.filename !== "normalized.patch" || lakeManifest.filename !== "lake-manifest.json") {
    throw new Error("A v2 Bundle requires files named source.tar.zst, normalized.patch, and lake-manifest.json.");
  }
  if (!sourceArchive.contents.subarray(0, 4).equals(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    throw new Error("source.tar.zst is not a Zstandard archive.");
  }
  if (!patch.contents.toString("utf8").startsWith("diff --git ")) {
    throw new Error("normalized.patch must begin with a Git-style unified diff.");
  }
  try { JSON.parse(lakeManifest.contents.toString("utf8")); } catch { throw new Error("lake-manifest.json must contain valid JSON."); }
  return {
    sourceArchive: { ...sourceArchive, contentType: "application/zstd" },
    patch: { ...patch, contentType: "text/x-diff; charset=utf-8" },
    lakeManifest: { ...lakeManifest, contentType: "application/json" },
  };
}

function normalizeWorkspaceTree(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100000) {
    throw new Error("workspaceTree must contain between 1 and 100000 final regular files.");
  }
  const entries = value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Each workspaceTree entry must be an object.");
    const path = requiredLocalString(entry.path, "workspaceTree path", 1024);
    if (path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some((part) => !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(part) || part === "." || part === "..")) {
      throw new Error("workspaceTree paths must be safe relative POSIX paths.");
    }
    if (entry.mode !== 0o644 && entry.mode !== 0o755) throw new Error("workspaceTree modes must be 0644 or 0755.");
    return { path, mode: entry.mode, contentHash: requireSha256(entry.contentHash, "workspaceTree contentHash") };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length) throw new Error("workspaceTree paths must be unique.");
  return entries;
}

function normalizeBundleEntryFile(value) {
  const entryFile = requiredLocalString(value, "entryFile", 1024);
  if (!entryFile.endsWith(".lean") || entryFile.startsWith("/") || entryFile.includes("\\") || entryFile.includes("\0")) {
    throw new Error("entryFile must be a safe relative Lean source path.");
  }
  const segments = entryFile.slice(0, -".lean".length).split("/");
  if (segments.some((segment) => !/^[A-Za-z_][A-Za-z0-9_']*$/.test(segment))) {
    throw new Error("entryFile must be a safe relative Lean source path.");
  }
  return entryFile;
}

function normalizeWorkspaceLimits(maxExpandedBytes, maxFileCount) {
  if (!Number.isSafeInteger(maxExpandedBytes) || maxExpandedBytes < 1 || maxExpandedBytes > 16 * 1024 * 1024 * 1024) {
    throw new Error("maxExpandedBytes must be between 1 and 16 GiB.");
  }
  if (!Number.isSafeInteger(maxFileCount) || maxFileCount < 1 || maxFileCount > 100000) {
    throw new Error("maxFileCount must be between 1 and 100000.");
  }
  return { maxExpandedBytes, maxFileCount };
}

function normalizeAllowedAxioms(value) {
  if (!Array.isArray(value) || value.length > 256 || !value.every((item) => typeof item === "string" && /^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*$/.test(item))) {
    throw new Error("allowedAxioms must be a bounded list of qualified Lean names.");
  }
  return [...new Set(value)].sort();
}

function assertWorkspaceTreeMatchesInputs(entries, artifacts, entryFile) {
  if (!entries.some((entry) => entry.path === entryFile)) throw new Error("workspaceTree must include entryFile.");
  const lakeManifest = entries.find((entry) => entry.path === "lake-manifest.json");
  if (!lakeManifest || lakeManifest.contentHash !== artifacts.lakeManifest.sha256) {
    throw new Error("workspaceTree must contain the final lake-manifest.json with the selected file hash.");
  }
}

function createSignedArtifactBundleV2({ config, attempt, problem, artifacts, workspaceTree, entryFile, limits, allowedAxioms }) {
  if (!config?.privateKeyJwk || !config?.agentPublicKey) throw new Error("This local Agent key is unavailable. Reconnect Proofweave before preparing a Bundle.");
  const bundle = {
    protocolVersion: "pw-artifact-bundle-v2",
    id: `bundle:${randomUUID()}`,
    attemptId: attempt.id,
    problemRevisionId: attempt.problemRevisionId,
    target: { declaration: problem.declaration.qualifiedName, statementHash: problem.declaration.sourceContentHash },
    workspace: {
      archive: { objectKey: artifactObjectKey(artifacts.sourceArchive.sha256, "source.tar.zst"), contentHash: artifacts.sourceArchive.sha256, format: "tar.zst", maxExpandedBytes: limits.maxExpandedBytes, maxFileCount: limits.maxFileCount, symlinkPolicy: "forbidden" },
      patch: { objectKey: artifactObjectKey(artifacts.patch.sha256, "normalized.patch"), contentHash: artifacts.patch.sha256, format: "unified-diff", strip: 1, allowFuzz: false },
      tree: { hash: workspaceTreeHash(workspaceTree), algorithm: "pw-tree-v1", state: "after_patch_and_lake_manifest" },
      lakeManifest: { objectKey: artifactObjectKey(artifacts.lakeManifest.sha256, "lake-manifest.json"), contentHash: artifacts.lakeManifest.sha256, destination: "lake-manifest.json" },
    },
    environment: { leanToolchain: problem.source.leanToolchain, mathlibRevision: problem.source.mathlibRevision },
    entryCommand: ["lake", "env", "lean", entryFile],
    dependencyReceipts: [],
    agentEvent: { eventId: `agent-event:${randomUUID()}`, occurredAt: new Date().toISOString(), payloadHash: `sha256:${"0".repeat(64)}`, agentPublicKey: config.agentPublicKey, signature: "A".repeat(86) },
    policy: { requireNoSorry: true, allowedAxioms },
  };
  bundle.agentEvent.payloadHash = sha256Canonical(artifactBundleSigningPayload(bundle));
  const key = createPrivateKey({ key: config.privateKeyJwk, format: "jwk" });
  bundle.agentEvent.signature = sign(null, Buffer.from(canonicalJson(artifactBundleSigningPayload(bundle))), key).toString("base64url");
  return bundle;
}

function artifactBundleSigningPayload(bundle) {
  return {
    protocolVersion: bundle.protocolVersion,
    id: bundle.id,
    attemptId: bundle.attemptId,
    problemRevisionId: bundle.problemRevisionId,
    target: bundle.target,
    workspace: bundle.workspace,
    environment: bundle.environment,
    entryCommand: bundle.entryCommand,
    dependencyReceipts: bundle.dependencyReceipts,
    agentEvent: { eventId: bundle.agentEvent?.eventId, occurredAt: bundle.agentEvent?.occurredAt, agentPublicKey: bundle.agentEvent?.agentPublicKey },
    policy: bundle.policy,
  };
}

function workspaceTreeHash(entries) {
  return sha256Canonical({ protocolVersion: "pw-tree-v1", entries });
}

function artifactObjectKey(hash, filename) {
  return `bundles/sha256/${hash.slice("sha256:".length)}/${filename}`;
}

function bundleArtifactSummary(artifacts) {
  return [artifacts.sourceArchive, artifacts.patch, artifacts.lakeManifest].map(localEvidenceSummary);
}

function normalizeExpectedBundleArtifactHashes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Provide the exact three-file hash record from the owner-approved Bundle draft.");
  }
  const allowed = ["sourceArchive", "patch", "lakeManifest"];
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`expectedArtifactSha256 contains unsupported field ${unexpected}.`);
  return {
    sourceArchive: requireSha256(value.sourceArchive, "expectedArtifactSha256.sourceArchive"),
    patch: requireSha256(value.patch, "expectedArtifactSha256.patch"),
    lakeManifest: requireSha256(value.lakeManifest, "expectedArtifactSha256.lakeManifest"),
  };
}

function requireBundleRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A locally prepared Artifact Bundle is required.");
  }
  return value;
}

function assertBundleMatchesCurrentEvidence({ bundle, expectedBundleHash, expectedArtifactHashes, artifacts, attempt, problem, config }) {
  if (sha256Canonical(bundle) !== expectedBundleHash) {
    throw new Error("The prepared Bundle does not match the manifest hash the owner approved. Prepare it again before staging.");
  }
  if (artifacts.sourceArchive.sha256 !== expectedArtifactHashes.sourceArchive ||
      artifacts.patch.sha256 !== expectedArtifactHashes.patch ||
      artifacts.lakeManifest.sha256 !== expectedArtifactHashes.lakeManifest) {
    throw new Error("One or more selected Bundle files changed since the owner reviewed the exact hashes. Prepare the Bundle again.");
  }
  if (bundle.protocolVersion !== "pw-artifact-bundle-v2" || bundle.attemptId !== attempt.id ||
      bundle.problemRevisionId !== attempt.problemRevisionId || bundle.target?.declaration !== problem.declaration.qualifiedName ||
      bundle.target?.statementHash !== problem.declaration.sourceContentHash ||
      bundle.environment?.leanToolchain !== problem.source.leanToolchain || bundle.environment?.mathlibRevision !== problem.source.mathlibRevision) {
    throw new Error("The prepared Bundle no longer matches this authorized Attempt and source-pinned target.");
  }
  if (bundle.workspace?.archive?.objectKey !== artifactObjectKey(artifacts.sourceArchive.sha256, "source.tar.zst") ||
      bundle.workspace?.archive?.contentHash !== artifacts.sourceArchive.sha256 ||
      bundle.workspace?.patch?.objectKey !== artifactObjectKey(artifacts.patch.sha256, "normalized.patch") ||
      bundle.workspace?.patch?.contentHash !== artifacts.patch.sha256 ||
      bundle.workspace?.lakeManifest?.objectKey !== artifactObjectKey(artifacts.lakeManifest.sha256, "lake-manifest.json") ||
      bundle.workspace?.lakeManifest?.contentHash !== artifacts.lakeManifest.sha256) {
    throw new Error("The prepared Bundle no longer points to the owner-approved local files.");
  }
  if (bundle.agentEvent?.agentPublicKey !== config.agentPublicKey ||
      bundle.agentEvent?.payloadHash !== sha256Canonical(artifactBundleSigningPayload(bundle))) {
    throw new Error("The prepared Bundle is not bound to this local Agent key and payload.");
  }
  let signatureValid = false;
  try {
    const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: config.agentPublicKey }, format: "jwk" });
    signatureValid = verify(null, Buffer.from(canonicalJson(artifactBundleSigningPayload(bundle))), publicKey, Buffer.from(bundle.agentEvent.signature, "base64url"));
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) throw new Error("The prepared Bundle signature is invalid. Prepare it again from this local Agent.");
}

function isSha256(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

function requireSha256(value, label) {
  if (!isSha256(value)) throw new Error(`${label} must be sha256:<lowercase hex>.`);
  return value;
}

function sha256Canonical(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

// Keep this byte-for-byte compatible with packages/protocol/canonical-json.mjs.
// The local Connector is intentionally dependency-free, so it cannot import
// Proofweave's workspace package from an installed plugin directory.
function canonicalJson(value) {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("Canonical JSON does not allow non-finite numbers.");
      return JSON.stringify(value);
    case "string":
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
        throw new TypeError("Canonical JSON accepts only plain objects.");
      }
      return `{${Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
        .join(",")}}`;
    default:
      throw new TypeError(`Canonical JSON does not allow ${typeof value} values.`);
  }
}

async function connect() {
  const existing = await readConfig();
  if (existing?.refreshToken && existing.baseUrl === baseUrl) {
    return { connected: true, message: `Already connected as ${existing.agentLabel}. Revoke this connection in Proofweave Settings before reconnecting.` };
  }
  const identity = existing?.privateKeyJwk && existing?.agentId && existing?.agentPublicKey
    ? existing
    : createLocalIdentity();
  const state = randomToken(24);
  const verifier = randomToken(48);
  const codeChallenge = base64url(createHash("sha256").update(verifier).digest());
  const session = await startPairing({
    agentId: identity.agentId,
    agentLabel: identity.agentLabel,
    agentPublicKey: identity.agentPublicKey,
    oauthState: state,
    codeChallenge,
  });
  const tokens = await waitForCallback({ connectionUrl: session.connectionUrl, state, verifier, clientId: session.clientId });
  const next = {
    version: 1,
    baseUrl,
    agentId: identity.agentId,
    agentLabel: identity.agentLabel,
    agentPublicKey: identity.agentPublicKey,
    privateKeyJwk: identity.privateKeyJwk,
    clientId: session.clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString(),
  };
  await writeConfig(next);
  return { connected: true, message: `Connected as ${next.agentLabel}. You can revoke this installation in Proofweave Settings.` };
}

async function connectionStatus() {
  const config = await readConfig();
  if (!config?.refreshToken) return { connected: false, message: "Not connected. Use connect_proofweave to approve this local Codex." };
  return {
    connected: true,
    agentId: config.agentId,
    agentLabel: config.agentLabel,
    baseUrl: config.baseUrl,
    message: "Connected locally. The refresh token and Agent private key are stored only on this computer.",
  };
}

async function startPairing(payload) {
  const response = await fetch(`${baseUrl}/api/connect/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.connectionUrl || !result?.clientId) {
    throw new Error(result?.error?.message ?? "Proofweave could not start the local connection.");
  }
  return result;
}

async function waitForCallback({ connectionUrl, state, verifier, clientId }) {
  const server = createServer();
  const callback = new Promise((resolve, reject) => {
    let settled = false;
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      handler(value);
    };
    const timeout = setTimeout(() => finish(reject, new Error("Browser approval timed out after 10 minutes. Run connect_proofweave again.")), 10 * 60 * 1_000);
    server.once("error", (error) => finish(reject, error.code === "EADDRINUSE"
      ? new Error(`Local callback port ${callbackPort} is already in use. Close the other Proofweave Connector and try again.`)
      : error));
    server.on("request", (request, response) => {
      void (async () => {
        try {
          const url = new URL(request.url ?? "/", redirectUri);
          if (url.pathname !== callbackPath) {
            response.writeHead(404).end("Not found");
            return;
          }
          const error = url.searchParams.get("error");
          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");
          if (error || !code || returnedState !== state) {
            response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end("<h1>Proofweave connection was not approved.</h1><p>You can close this tab and return to Codex.</p>");
            finish(reject, new Error(error ? `Proofweave authorization failed: ${error}` : "The browser approval did not match this local connection."));
            return;
          }
          const tokens = await exchangeCode({ code, verifier, clientId });
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<h1>Proofweave is connected.</h1><p>You can close this tab and return to Codex.</p>");
          finish(resolve, tokens);
        } catch (cause) {
          response.writeHead(500, { "content-type": "text/html; charset=utf-8" }).end("<h1>Proofweave connection could not finish.</h1><p>Return to Codex and try again.</p>");
          finish(reject, cause);
        }
      })();
    });
  });
  await new Promise((resolve, reject) => server.listen(callbackPort, callbackHost, (error) => error ? reject(error) : resolve()));
  const opened = openBrowser(connectionUrl);
  if (!opened) process.stderr.write(`Open this Proofweave approval link in your browser: ${connectionUrl}\n`);
  return callback;
}

async function exchangeCode({ code, verifier, clientId }) {
  return postForm(`${baseUrl}/token`, {
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
}

async function callRemoteTool(name, args) {
  let config = await requireConfig();
  config = await refreshIfNeeded(config);
  let response = await postMcp(config.accessToken, name, args);
  if (response.status === 401) {
    config = await refreshAccessToken(config);
    response = await postMcp(config.accessToken, name, args);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? payload?.error_description ?? `Proofweave MCP returned ${response.status}.`);
  }
  if (payload?.error) throw new Error(payload.error.message ?? "Proofweave MCP rejected this request.");
  if (!payload?.result) throw new Error("Proofweave MCP returned an invalid response.");
  return payload.result;
}

async function postMcp(accessToken, name, args) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      "authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method: "tools/call", params: { name, arguments: args } }),
  });
}

async function refreshIfNeeded(config) {
  const expires = Date.parse(config.accessTokenExpiresAt ?? "");
  if (config.accessToken && Number.isFinite(expires) && expires > Date.now() + 60_000) return config;
  return refreshAccessToken(config);
}

async function refreshAccessToken(config) {
  const tokens = await postForm(`${baseUrl}/token`, {
    grant_type: "refresh_token",
    refresh_token: config.refreshToken,
    client_id: config.clientId,
  });
  const next = {
    ...config,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString(),
  };
  await writeConfig(next);
  return next;
}

async function postForm(url, data) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "accept": "application/json" },
    body: new URLSearchParams(data),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result?.access_token || !result?.refresh_token) {
    throw new Error(result?.error_description ?? "Proofweave could not exchange the browser approval.");
  }
  return result;
}

function createLocalIdentity() {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyJwk = pair.publicKey.export({ format: "jwk" });
  const privateKeyJwk = pair.privateKey.export({ format: "jwk" });
  if (!publicKeyJwk.x || publicKeyJwk.kty !== "OKP" || publicKeyJwk.crv !== "Ed25519") {
    throw new Error("Node could not generate an Ed25519 Agent key.");
  }
  return {
    agentId: `urn:pw:agent:codex-${randomUUID()}`,
    agentLabel: "Codex on this computer",
    agentPublicKey: publicKeyJwk.x,
    privateKeyJwk,
  };
}

async function requireConfig() {
  const config = await readConfig();
  if (!config?.refreshToken || !config?.clientId || !config?.agentId) {
    throw new Error("This local Codex is not connected. Use connect_proofweave first.");
  }
  if (config.baseUrl !== baseUrl) throw new Error("This local connection belongs to a different Proofweave site. Reconnect before continuing.");
  return config;
}

async function readConfig() {
  try {
    const raw = await readFile(configPath, "utf8");
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("The local Proofweave Connector configuration could not be read.");
  }
}

async function writeConfig(value) {
  const folder = dirname(configPath);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  try { await chmod(folder, 0o700); } catch { /* Windows does not expose POSIX modes. */ }
  const temporary = `${configPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try { await chmod(temporary, 0o600); } catch { /* Windows does not expose POSIX modes. */ }
  await rename(temporary, configPath);
}

function openBrowser(url) {
  const target = platform() === "darwin" ? ["open", [url]] : platform() === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(target[0], target[1], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("PROOFWEAVE_BASE_URL must be an absolute URL."); }
  if (!/^https:$/.test(url.protocol) && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("PROOFWEAVE_BASE_URL must use HTTPS outside local development.");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function requiredLocalString(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function normalizeEvidencePaths(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > localEvidencePreviewLimits.maxFiles) {
    throw new Error(`Choose between 1 and ${localEvidencePreviewLimits.maxFiles} local evidence files.`);
  }
  const paths = value.map((path) => requiredLocalString(path, "Each evidence path", 1000));
  if (new Set(paths).size !== paths.length) throw new Error("Choose each local evidence file only once.");
  return paths;
}

function normalizeExpectedEvidenceHashes(value, expectedLength) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error("Provide the exact SHA-256 list from the owner-approved preview.");
  }
  return value.map((hash) => {
    if (typeof hash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(hash)) {
      throw new Error("Each expected evidence hash must be sha256:<lowercase hex>.");
    }
    return hash;
  });
}

function assertSafeEvidenceFilename(filename) {
  const normalized = filename.toLowerCase();
  const blockedNames = new Set([".env", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519", "credentials.json"]);
  const blockedExtensions = [".pem", ".key", ".p12", ".pfx", ".kdbx"];
  if (blockedNames.has(normalized) || blockedExtensions.some((extension) => normalized.endsWith(extension))) {
    throw new Error(`Proofweave will not stage a likely credential or private key: ${filename}`);
  }
}

function evidenceContentType(filename) {
  const normalized = filename.toLowerCase();
  if (normalized.endsWith(".tar.zst")) return "application/zstd";
  if (normalized.endsWith(".json")) return "application/json";
  if (normalized.endsWith(".patch") || normalized.endsWith(".diff")) return "text/x-diff; charset=utf-8";
  if (normalized.endsWith(".lean") || normalized.endsWith(".md") || normalized.endsWith(".txt") || normalized.endsWith(".log")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

function localEvidenceSummary(file) {
  return { filename: file.filename, bytes: file.bytes, sha256: file.sha256 };
}

function remoteObjectSummary(response) {
  const text = Array.isArray(response?.content)
    ? response.content.find((item) => item?.type === "text" && typeof item.text === "string")?.text
    : null;
  try {
    const parsed = text ? JSON.parse(text) : null;
    return {
      contentHash: parsed?.object?.contentHash ?? null,
      objectKey: parsed?.object?.objectKey ?? null,
      storageState: parsed?.storageState ?? "object_staged_only",
      verificationState: parsed?.verificationState ?? "not_verified",
    };
  } catch {
    return { contentHash: null, objectKey: null, storageState: "object_staged_only", verificationState: "not_verified" };
  }
}

function randomToken(bytes) { return base64url(randomBytes(bytes)); }
function base64url(value) { return Buffer.from(value).toString("base64url"); }
function tool(name, description, inputSchema) { return { name, description, inputSchema }; }
function connectionResult(value) { return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }; }
function toolError(message) { return { content: [{ type: "text", text: message }], isError: true }; }
function respond(value) { process.stdout.write(`${JSON.stringify(value)}\n`); }
function messageFor(error) {
  if (!(error instanceof Error)) return "Proofweave local Connector failed.";
  const cause = error.cause;
  if (error.message === "fetch failed") {
    const cannotReach = !cause || typeof cause !== "object" || cause.code !== "ENOTFOUND";
    const action = cannotReach ? "cannot reach" : "cannot resolve";
    return `Proofweave Connector ${action} ${new URL(baseUrl).hostname}. This Codex task has no permitted network route to Proofweave. Allow outbound HTTPS only to that host in the task's Codex permission profile, start a fresh task, then retry.`;
  }
  return error.message;
}
