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
import { createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";
import readline from "node:readline";

const baseUrl = normalizeBaseUrl(process.env.PROOFWEAVE_BASE_URL ?? "https://proofweave-research.yualex031821.chatgpt.site");
const callbackHost = "127.0.0.1";
const callbackPort = 44765;
const callbackPath = "/callback";
const redirectUri = `http://${callbackHost}:${callbackPort}${callbackPath}`;
const configPath = process.env.PROOFWEAVE_CONNECTOR_CONFIG ?? join(homedir(), ".proofweave", "codex-connector.json");
const localEvidencePreviewLimits = { maxFiles: 6, maxFileBytes: 1_000_000, maxTotalBytes: 3_000_000 };
const localWorkspaceBundleDefaults = { maxExpandedBytes: 64 * 1024 * 1024, maxFileCount: 10_000 };
const legacyConnectionScopes = Object.freeze(["catalog:read", "attempt:create", "attempt:read", "progress:write"]);
const requiredConnectionScopes = Object.freeze([...legacyConnectionScopes, "artifact:write"]);
const toolDefinitions = [
  tool("connect_proofweave", "Connect this local Codex to Proofweave with a one-time browser approval. It generates an Agent key on this computer; no key needs to be pasted.", { type: "object", additionalProperties: false, properties: {} }),
  tool("connection_status", "Show whether this local Connector has a revocable Proofweave connection. It does not contact Proofweave.", { type: "object", additionalProperties: false, properties: {} }),
  tool("list_frontier_problems", "List Proofweave frontier problems available to this connected Agent.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } }),
  tool("inspect_problem", "Read a source-pinned Proofweave frontier problem before starting local work.", { type: "object", additionalProperties: false, properties: { slug: { type: "string", minLength: 1, maxLength: 160 } }, required: ["slug"] }),
  tool("begin_research", "Start or resume one source-pinned Proofweave research target for this connected Agent. It recovers an existing active Attempt when present and never reads local files, records progress, uploads evidence, runs Lean, or creates credit.", { type: "object", additionalProperties: false, properties: { targetSlug: { type: "string", minLength: 1, maxLength: 160 }, intent: { type: "string", enum: ["formalize", "prove"] } }, required: ["targetSlug"] }),
  tool("continue_research", "Continue the only active Proofweave research target for this connected Agent. If more than one target is active, it returns a short choice list instead of guessing. It never reads local files, records progress, uploads evidence, runs Lean, or creates credit.", { type: "object", additionalProperties: false, properties: {} }),
  tool("create_attempt", "Create a bounded Proofweave Attempt for the connected Agent. Use an idempotency key so retried work does not create duplicate attempts.", { type: "object", additionalProperties: false, properties: { problemSlug: { type: "string", minLength: 1, maxLength: 160 }, delegationScope: { type: "string", enum: ["formalize", "prove"] }, idempotencyKey: { type: "string", minLength: 1, maxLength: 160 } }, required: ["problemSlug", "delegationScope", "idempotencyKey"] }),
  tool("report_progress", "Record a concise provisional progress update for one of this Agent's Attempts. This is not Lean verification or a contribution receipt.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, message: { type: "string", minLength: 1, maxLength: 4000 }, progressPercent: { type: "integer", minimum: 0, maximum: 100 }, idempotencyKey: { type: "string", minLength: 1, maxLength: 160 } }, required: ["attemptId", "message", "progressPercent", "idempotencyKey"] }),
  tool("inspect_research_graph", "Read the shared checkpoint DAG for one source-pinned target. Nodes are structured public research progress, not Lean verification, independent review, novelty, or contribution credit.", { type: "object", additionalProperties: false, properties: { slug: { type: "string", minLength: 1, maxLength: 120 } }, required: ["slug"] }),
  tool("prepare_research_checkpoint", "Prepare and sign one concise structured research checkpoint locally. It never publishes, uploads files, runs Lean, records verification, or creates credit.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, kind: { type: "string", enum: ["formalization", "hypothesis", "lemma", "proof_state", "proof_patch", "counterexample", "negative_result", "synthesis"] }, summary: { type: "string", minLength: 1, maxLength: 1200 }, parentNodeIds: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 240 } }, proofStateHash: { anyOf: [{ type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, { type: "null" }] }, artifactBundleHash: { anyOf: [{ type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, { type: "null" }] }, citations: { type: "array", maxItems: 32, items: researchCheckpointCitationSchema() } }, required: ["attemptId", "kind", "summary"] }),
  tool("publish_prepared_research_checkpoint", "Publish the exact locally signed checkpoint only after the owner approves its hash, summary, parents, and citations. A successful result is shared_unverified research progress only.", { type: "object", additionalProperties: false, properties: { checkpoint: { type: "object" }, expectedCheckpointHash: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }, ownerConfirmation: { type: "string", enum: ["I_CONFIRM_PUBLISH_CHECKPOINT"] } }, required: ["checkpoint", "expectedCheckpointHash", "ownerConfirmation"] }),
  tool("list_attempts", "List bounded Attempts attributed to this exact local Agent.", { type: "object", additionalProperties: false, properties: { limit: { type: "integer", minimum: 1, maximum: 100 } } }),
  tool("get_attempt", "Read one Attempt attributed to this exact local Agent.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 } }, required: ["attemptId"] }),
  tool("preview_local_evidence", "Preview up to six explicitly owner-selected local files for one authorized Attempt. It returns only each filename, byte size, and SHA-256 hash; it never uploads, stages, runs, or verifies anything.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, paths: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 1000 } } }, required: ["attemptId", "paths"] }),
  tool("submit_local_evidence", "Submit up to six explicitly owner-approved local files as immutable artifact objects for one authorized Attempt. This sends the selected bytes to Proofweave only when the current hashes match the exact preview the owner confirmed. It does not stage a Bundle, run Lean, or verify a proof.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, paths: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", minLength: 1, maxLength: 1000 } }, expectedSha256: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" } }, ownerConfirmation: { type: "string", enum: ["I_CONFIRM_SUBMIT"] } }, required: ["attemptId", "paths", "expectedSha256", "ownerConfirmation"] }),
  tool("prepare_workspace_bundle_v2", "Prepare a signed v2 Artifact Bundle draft directly from one explicitly owner-approved local Git/Lean workspace. It creates the source archive, normalized patch, Lake manifest, and final workspace tree locally; it never uploads, stages, runs Lean, or creates credit.", { type: "object", additionalProperties: false, properties: { attemptId: { type: "string", minLength: 1, maxLength: 240 }, workspaceRoot: { type: "string", minLength: 1, maxLength: 1000 }, entryFile: { type: "string", minLength: 6, maxLength: 1024 }, allowedAxioms: { type: "array", maxItems: 256, items: { type: "string", minLength: 1, maxLength: 240 } }, ownerConfirmation: { type: "string", enum: ["I_CONFIRM_PREPARE_WORKSPACE_BUNDLE"] } }, required: ["attemptId", "workspaceRoot", "entryFile", "ownerConfirmation"] }),
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
  if (name === "begin_research") return connectionResult(await beginResearch(args));
  if (name === "continue_research") return connectionResult(await continueResearch());
  if (name === "prepare_research_checkpoint") return connectionResult(await prepareResearchCheckpoint(args));
  if (name === "publish_prepared_research_checkpoint") return connectionResult(await publishPreparedResearchCheckpoint(args));
  if (name === "preview_local_evidence") return connectionResult(await previewLocalEvidence(args));
  if (name === "submit_local_evidence") return connectionResult(await submitLocalEvidence(args));
  if (name === "prepare_workspace_bundle_v2") return connectionResult(await prepareWorkspaceBundleV2(args));
  if (name === "prepare_artifact_bundle_v2") return connectionResult(await prepareArtifactBundleV2(args));
  if (name === "stage_prepared_artifact_bundle") return connectionResult(await stagePreparedArtifactBundle(args));
  if (!toolDefinitions.some((item) => item.name === name)) return toolError(`Unknown Proofweave tool: ${name}`);
  const result = await callRemoteTool(name, args);
  return result;
}

async function beginResearch(args) {
  const targetSlug = requiredLocalString(args.targetSlug, "targetSlug", 160);
  const intent = args.intent === undefined ? "formalize" : normalizeResearchIntent(args.intent);

  // Read the immutable public target first. This is intentionally the only
  // catalog data returned by the convenience operation; Agent workspace data
  // never enters the request.
  const target = await requireRemoteProblem(targetSlug);
  const listed = parseRemoteToolJson(await callRemoteTool("list_attempts", { limit: 100 }), "list_attempts");
  const existing = Array.isArray(listed?.attempts)
    ? listed.attempts.find((attempt) =>
      attempt?.status === "active" &&
      attempt.problemSlug === targetSlug &&
      (attempt.delegationScope === "formalize" || attempt.delegationScope === "prove"),
    )
    : null;

  if (existing) return researchStartResult({ attempt: existing, target, created: false });

  // A retry after an interrupted response re-lists Attempts before reaching
  // this call, so the normal recovery path never needs an owner-supplied key.
  const created = parseRemoteToolJson(await callRemoteTool("create_attempt", {
    problemSlug: targetSlug,
    delegationScope: intent,
    idempotencyKey: `begin-research:${randomUUID()}`,
  }), "create_attempt");
  if (!created?.attempt) throw new Error("Proofweave did not return the bounded research workspace it created.");
  return researchStartResult({ attempt: created.attempt, target, created: true });
}

function normalizeResearchIntent(value) {
  if (value !== "formalize" && value !== "prove") throw new Error("intent must be formalize or prove.");
  return value;
}

function researchStartResult({ attempt, target, created }) {
  return {
    operation: created ? "research_started" : "research_resumed",
    created,
    attempt,
    target: {
      slug: target.slug,
      title: target.title,
      revision: target.source?.revisionTag ?? null,
      leanToolchain: target.source?.leanToolchain ?? null,
      mathlibRevision: target.source?.mathlibRevision ?? null,
    },
    uploaded: false,
    recordedProgress: false,
    verificationState: "agent_reported_only",
    next: "Work locally against this pinned target. Record only a material milestone after the owner confirms its concise message. File reads and all evidence uploads require their own explicit approval.",
  };
}

async function continueResearch() {
  const listed = parseRemoteToolJson(await callRemoteTool("list_attempts", { limit: 100 }), "list_attempts");
  const active = Array.isArray(listed?.attempts)
    ? listed.attempts.filter((attempt) => attempt?.status === "active" && typeof attempt.problemSlug === "string")
    : [];
  if (active.length === 0) {
    return {
      operation: "research_target_required",
      uploaded: false,
      recordedProgress: false,
      verificationState: "not_recorded",
      next: "No active Proofweave research target is available for this local Agent. Ask the owner to choose a source-pinned target and start research first.",
    };
  }
  if (active.length > 1) {
    return {
      operation: "research_selection_required",
      uploaded: false,
      recordedProgress: false,
      verificationState: "not_recorded",
      choices: active.map((attempt) => ({ attemptId: attempt.id, targetSlug: attempt.problemSlug, title: attempt.problemTitle ?? attempt.problemSlug })),
      next: "More than one active target exists. Ask the owner which source-pinned target to continue; do not guess.",
    };
  }
  const attempt = active[0];
  const target = await requireRemoteProblem(attempt.problemSlug);
  return researchStartResult({ attempt, target, created: false });
}

async function prepareResearchCheckpoint(args) {
  const config = await requireConfig();
  if (!config.privateKeyJwk || !config.agentId || !config.agentPublicKey) {
    throw new Error("This local Agent key is unavailable. Reconnect Proofweave before preparing a research checkpoint.");
  }
  const attemptId = requiredLocalString(args.attemptId, "attemptId", 240);
  const attempt = await requireRemoteAttempt(attemptId);
  const problem = await requireRemoteProblem(attempt.problemSlug);
  const kind = normalizeResearchCheckpointKind(args.kind);
  const summary = normalizeResearchCheckpointSummary(args.summary);
  const parentNodeIds = normalizeResearchParentNodeIds(args.parentNodeIds ?? [], kind);
  const proofStateHash = optionalResearchHash(args.proofStateHash, "proofStateHash");
  const artifactBundleHash = optionalResearchHash(args.artifactBundleHash, "artifactBundleHash");
  const citations = normalizeResearchCitations(args.citations ?? []);
  const graph = parseRemoteToolJson(
    await callRemoteTool("inspect_research_graph", { slug: attempt.problemSlug }),
    "inspect_research_graph",
  )?.graph;
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.externalWorks)) {
    throw new Error("Proofweave did not return the shared research graph for this target.");
  }
  const visibleNodeIds = new Set(graph.nodes.map((node) => node?.id).filter((id) => typeof id === "string"));
  if (parentNodeIds.some((id) => !visibleNodeIds.has(id))) {
    throw new Error("Every parentNodeId must already exist in the shared graph for this target.");
  }
  const visibleWorkIds = new Set(graph.externalWorks.map((work) => work?.id).filter((id) => typeof id === "string"));
  if (citations.some((citation) => !visibleWorkIds.has(citation.externalWorkId))) {
    throw new Error("Every cited historical work must already be imported into this target's shared graph.");
  }
  const checkpoint = createSignedResearchCheckpoint({
    config,
    attempt,
    problem,
    kind,
    summary,
    parentNodeIds,
    proofStateHash,
    artifactBundleHash,
    citations,
  });
  const checkpointHash = sha256Canonical(checkpoint);
  return {
    operation: "research_checkpoint_prepared",
    published: false,
    uploadedFiles: false,
    verificationState: "not_recorded",
    checkpointHash,
    checkpoint,
    publishInput: { checkpoint, expectedCheckpointHash: checkpointHash },
    next: "Show the owner this concise summary, kind, parent nodes, citations, and checkpoint hash. Publish only after they explicitly approve this exact draft; no raw prompt or chain-of-thought belongs in a checkpoint.",
  };
}

async function publishPreparedResearchCheckpoint(args) {
  if (args.ownerConfirmation !== "I_CONFIRM_PUBLISH_CHECKPOINT") {
    throw new Error("The owner must explicitly approve this exact research checkpoint before it becomes public.");
  }
  const expectedCheckpointHash = requireSha256(args.expectedCheckpointHash, "expectedCheckpointHash");
  const config = await requireConfig();
  const checkpoint = normalizeLocalResearchCheckpoint(args.checkpoint);
  const checkpointHash = sha256Canonical(checkpoint);
  if (checkpointHash !== expectedCheckpointHash) {
    throw new Error("The prepared research checkpoint changed after the owner reviewed it. Prepare and review a fresh draft.");
  }
  if (checkpoint.agentEvent.agentId !== config.agentId || checkpoint.agentEvent.agentPublicKey !== config.agentPublicKey) {
    throw new Error("The prepared research checkpoint is not signed by this connected local Agent.");
  }
  const attempt = await requireRemoteAttempt(checkpoint.attemptId);
  if (attempt.problemRevisionId !== checkpoint.problemRevisionId || attempt.agentId !== config.agentId) {
    throw new Error("The prepared research checkpoint no longer matches this Agent's authorized Attempt.");
  }
  assertLocalResearchCheckpointSignature(checkpoint);
  const published = parseRemoteToolJson(
    await callRemoteTool("publish_research_checkpoint", { checkpoint }),
    "publish_research_checkpoint",
  );
  return {
    operation: "research_checkpoint_published",
    published: true,
    uploadedFiles: false,
    checkpointHash,
    ...published,
    verificationState: "shared_research_only",
    contributionState: "not_credited",
    next: "The checkpoint is now an immutable public branch node. It still needs separately staged evidence, Lean execution, independent review, and receipt policy before any verified contribution claim.",
  };
}

function createSignedResearchCheckpoint({ config, attempt, problem, kind, summary, parentNodeIds, proofStateHash, artifactBundleHash, citations }) {
  const checkpoint = {
    protocolVersion: "pw-research-checkpoint-v1",
    id: `research-node:${randomUUID()}`,
    attemptId: attempt.id,
    problemRevisionId: problem.id,
    kind,
    summary,
    parentNodeIds,
    proofStateHash,
    artifactBundleHash,
    citations,
    agentEvent: {
      id: `research-checkpoint-event:${randomUUID()}`,
      agentId: config.agentId,
      agentPublicKey: config.agentPublicKey,
      occurredAt: new Date().toISOString(),
      signature: "A".repeat(86),
    },
    payloadHash: `sha256:${"0".repeat(64)}`,
  };
  checkpoint.payloadHash = sha256Canonical(researchCheckpointSigningPayload(checkpoint));
  const key = createPrivateKey({ key: config.privateKeyJwk, format: "jwk" });
  checkpoint.agentEvent.signature = sign(
    null,
    Buffer.from(canonicalJson(researchCheckpointSigningPayload(checkpoint))),
    key,
  ).toString("base64url");
  return normalizeLocalResearchCheckpoint(checkpoint);
}

function researchCheckpointSigningPayload(checkpoint) {
  const normalized = normalizeLocalResearchCheckpoint(checkpoint);
  return {
    protocolVersion: normalized.protocolVersion,
    id: normalized.id,
    attemptId: normalized.attemptId,
    problemRevisionId: normalized.problemRevisionId,
    kind: normalized.kind,
    summary: normalized.summary,
    parentNodeIds: normalized.parentNodeIds,
    proofStateHash: normalized.proofStateHash,
    artifactBundleHash: normalized.artifactBundleHash,
    citations: normalized.citations,
    agentEvent: {
      id: normalized.agentEvent.id,
      agentId: normalized.agentEvent.agentId,
      agentPublicKey: normalized.agentEvent.agentPublicKey,
      occurredAt: normalized.agentEvent.occurredAt,
    },
  };
}

function assertLocalResearchCheckpointSignature(checkpoint) {
  if (checkpoint.payloadHash !== sha256Canonical(researchCheckpointSigningPayload(checkpoint))) {
    throw new Error("The prepared research checkpoint payload hash is invalid.");
  }
  const publicKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: checkpoint.agentEvent.agentPublicKey }, format: "jwk" });
  if (!verify(
    null,
    Buffer.from(canonicalJson(researchCheckpointSigningPayload(checkpoint))),
    publicKey,
    Buffer.from(checkpoint.agentEvent.signature, "base64url"),
  )) {
    throw new Error("The prepared research checkpoint signature is invalid.");
  }
}

function normalizeLocalResearchCheckpoint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("checkpoint must be an object.");
  const allowed = ["protocolVersion", "id", "attemptId", "problemRevisionId", "kind", "summary", "parentNodeIds", "proofStateHash", "artifactBundleHash", "citations", "agentEvent", "payloadHash"];
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) throw new Error(`checkpoint contains unsupported field ${unexpected}.`);
  if (value.protocolVersion !== "pw-research-checkpoint-v1") throw new Error("checkpoint protocolVersion is unsupported.");
  const kind = normalizeResearchCheckpointKind(value.kind);
  const id = requiredLocalString(value.id, "checkpoint.id", 240);
  const attemptId = requiredLocalString(value.attemptId, "checkpoint.attemptId", 240);
  const problemRevisionId = requiredLocalString(value.problemRevisionId, "checkpoint.problemRevisionId", 240);
  const summary = normalizeResearchCheckpointSummary(value.summary);
  const parentNodeIds = normalizeResearchParentNodeIds(value.parentNodeIds, kind, id);
  const proofStateHash = optionalResearchHash(value.proofStateHash, "checkpoint.proofStateHash");
  const artifactBundleHash = optionalResearchHash(value.artifactBundleHash, "checkpoint.artifactBundleHash");
  const citations = normalizeResearchCitations(value.citations);
  const agentEvent = value.agentEvent;
  if (!agentEvent || typeof agentEvent !== "object" || Array.isArray(agentEvent)) throw new Error("checkpoint.agentEvent must be an object.");
  const agentEventAllowed = ["id", "agentId", "agentPublicKey", "occurredAt", "signature"];
  const agentEventUnexpected = Object.keys(agentEvent).find((key) => !agentEventAllowed.includes(key));
  if (agentEventUnexpected) throw new Error(`checkpoint.agentEvent contains unsupported field ${agentEventUnexpected}.`);
  const normalizedEvent = {
    id: requiredLocalString(agentEvent.id, "checkpoint.agentEvent.id", 240),
    agentId: requiredLocalString(agentEvent.agentId, "checkpoint.agentEvent.agentId", 240),
    agentPublicKey: requireBase64UrlBytes(agentEvent.agentPublicKey, 32, "checkpoint.agentEvent.agentPublicKey"),
    occurredAt: requireUtcInstant(agentEvent.occurredAt, "checkpoint.agentEvent.occurredAt"),
    signature: requireBase64UrlBytes(agentEvent.signature, 64, "checkpoint.agentEvent.signature"),
  };
  return {
    protocolVersion: "pw-research-checkpoint-v1",
    id,
    attemptId,
    problemRevisionId,
    kind,
    summary,
    parentNodeIds,
    proofStateHash,
    artifactBundleHash,
    citations,
    agentEvent: normalizedEvent,
    payloadHash: requireSha256(value.payloadHash, "checkpoint.payloadHash"),
  };
}

function normalizeResearchCheckpointKind(value) {
  const kinds = ["formalization", "hypothesis", "lemma", "proof_state", "proof_patch", "counterexample", "negative_result", "synthesis"];
  if (!kinds.includes(value)) throw new Error("kind must be a supported structured research milestone.");
  return value;
}

function normalizeResearchCheckpointSummary(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1200 || value !== value.trim() || value.includes("\0") || value.split("\n").length > 12) {
    throw new Error("summary must be concise, trimmed structured output of at most 1,200 characters and 12 lines; do not include prompts or chain-of-thought.");
  }
  return value;
}

function normalizeResearchParentNodeIds(value, kind, checkpointId = null) {
  if (!Array.isArray(value) || value.length > 8) throw new Error("parentNodeIds must contain at most eight checkpoint identifiers.");
  const normalized = value.map((entry) => requiredLocalString(entry, "Each parentNodeId", 240));
  if (new Set(normalized).size !== normalized.length || (checkpointId && normalized.includes(checkpointId))) {
    throw new Error("parentNodeIds must be unique and cannot contain the checkpoint itself.");
  }
  normalized.sort();
  if (kind === "synthesis" && normalized.length < 2) throw new Error("A synthesis checkpoint requires at least two parent nodes.");
  return normalized;
}

function normalizeResearchCitations(value) {
  if (!Array.isArray(value) || value.length > 32) throw new Error("citations must contain at most 32 imported historical works.");
  const relations = ["builds_on", "formalizes", "refutes", "reproduces"];
  const normalized = value.map((citation) => {
    if (!citation || typeof citation !== "object" || Array.isArray(citation)) throw new Error("Each citation must be an object.");
    const unexpected = Object.keys(citation).find((key) => !["externalWorkId", "relation"].includes(key));
    if (unexpected) throw new Error(`citation contains unsupported field ${unexpected}.`);
    if (!relations.includes(citation.relation)) throw new Error("citation relation is invalid.");
    return { externalWorkId: requiredLocalString(citation.externalWorkId, "citation.externalWorkId", 240), relation: citation.relation };
  });
  const keys = normalized.map((citation) => `${citation.externalWorkId}\0${citation.relation}`);
  if (new Set(keys).size !== keys.length) throw new Error("citations must be unique.");
  normalized.sort((left, right) => {
    const leftKey = `${left.externalWorkId}\0${left.relation}`;
    const rightKey = `${right.externalWorkId}\0${right.relation}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return normalized;
}

function optionalResearchHash(value, label) {
  return value === undefined || value === null ? null : requireSha256(value, label);
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 UTC instant.`);
  }
  return value;
}

function requireBase64UrlBytes(value, length, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || Buffer.from(value, "base64url").byteLength !== length) {
    throw new Error(`${label} must be ${length}-byte unpadded base64url.`);
  }
  return value;
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

async function prepareWorkspaceBundleV2(args) {
  if (args.ownerConfirmation !== "I_CONFIRM_PREPARE_WORKSPACE_BUNDLE") {
    throw new Error("The owner must explicitly approve reading this complete local Git/Lean workspace before a Bundle draft can be prepared.");
  }
  const attemptId = requiredLocalString(args.attemptId, "attemptId", 240);
  const workspaceRoot = await requireWorkspaceRoot(args.workspaceRoot);
  const entryFile = normalizeBundleEntryFile(args.entryFile);
  const allowedAxioms = normalizeAllowedAxioms(args.allowedAxioms ?? []);

  // Confirm the remote authority and target before inspecting the approved
  // workspace. No local source bytes leave this machine in this operation.
  const attempt = await requireRemoteAttempt(attemptId);
  const problem = await requireRemoteProblem(attempt.problemSlug);
  const config = await requireConfig();
  let generated = null;
  try {
    generated = await createWorkspaceBundleArtifacts({ workspaceRoot, entryFile });
    const artifacts = await readBundleArtifacts(generated.artifactPaths);
    const workspaceTree = await readTrackedWorkspaceTree(workspaceRoot, generated.trackedFiles, localWorkspaceBundleDefaults);
    assertWorkspaceTreeMatchesInputs(workspaceTree, artifacts, entryFile);
    const bundle = createSignedArtifactBundleV2({
      config,
      attempt,
      problem,
      artifacts,
      workspaceTree,
      entryFile,
      limits: localWorkspaceBundleDefaults,
      allowedAxioms,
    });
    const manifestHash = sha256Canonical(bundle);
    return {
      attemptId,
      operation: "local_workspace_bundle_preparation",
      uploaded: false,
      staged: false,
      verificationState: "not_recorded",
      workspace: { trackedFiles: workspaceTree.length, changedFiles: generated.changedFiles, stagingDirectory: generated.stagingDirectory },
      manifestHash,
      artifacts: bundleArtifactSummary(artifacts),
      bundle,
      stageInput: { artifacts: generated.artifactPaths },
      next: "Show the owner this manifest hash and exact three-file hash list. A separate explicit bundle-staging action is required before any file bytes leave this computer.",
    };
  } catch (error) {
    if (generated?.stagingDirectory) await rm(generated.stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
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

async function requireWorkspaceRoot(value) {
  const workspaceRoot = requiredLocalString(value, "workspaceRoot", 1000);
  if (!isAbsolute(workspaceRoot)) throw new Error("workspaceRoot must be an absolute local directory explicitly selected by the owner.");
  const metadata = await lstat(workspaceRoot).catch((error) => {
    if (error?.code === "ENOENT") throw new Error("The selected local workspace was not found.");
    throw new Error("The selected local workspace could not be inspected.");
  });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("workspaceRoot must be a regular local directory, not a link.");
  }
  return realpath(resolve(workspaceRoot));
}

async function createWorkspaceBundleArtifacts({ workspaceRoot, entryFile }) {
  const gitRoot = (await runLocalCommand("git", ["rev-parse", "--show-toplevel"], { cwd: workspaceRoot })).toString("utf8").trim();
  if (!gitRoot || await realpath(resolve(gitRoot)) !== workspaceRoot) {
    throw new Error("Choose the root of a local Git Lean workspace. The current one-click alpha does not read a parent directory or a non-Git workspace.");
  }
  const trackedFiles = await listTrackedWorkspaceFiles(workspaceRoot);
  if (!trackedFiles.some((file) => file.path === entryFile)) throw new Error("entryFile must be a tracked regular file in the selected workspace.");
  if (!trackedFiles.some((file) => file.path === "lake-manifest.json")) throw new Error("The selected workspace must track lake-manifest.json for a reproducible v2 Bundle.");

  const untracked = splitNul(await runLocalCommand("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd: workspaceRoot }));
  if (untracked.length > 0) {
    throw new Error(`The one-click alpha accepts a clean Git workspace with modified tracked files only. Commit, remove, or explicitly handle the first untracked path before preparing a Bundle: ${untracked[0]}`);
  }
  const changedFiles = parseModifiedPaths(await runLocalCommand("git", ["diff", "--name-status", "-z", "HEAD", "--"], { cwd: workspaceRoot }));
  if (changedFiles.length === 0) {
    throw new Error("The selected workspace has no tracked source modification to form the required non-empty normalized patch.");
  }

  const patch = await runLocalCommand("git", ["diff", "--no-ext-diff", "--full-index", "--src-prefix=a/", "--dst-prefix=b/", "HEAD", "--"], { cwd: workspaceRoot, maxBytes: localEvidencePreviewLimits.maxFileBytes });
  assertNormalizedPatchContents(patch);
  const lakeManifestPath = join(workspaceRoot, "lake-manifest.json");
  await assertRegularWorkspaceFile(lakeManifestPath, "lake-manifest.json");
  const lakeManifest = await readFile(lakeManifestPath);
  const stagingDirectory = await mkdtemp(join(tmpdir(), "proofweave-bundle-"));
  const artifactPaths = {
    sourceArchivePath: join(stagingDirectory, "source.tar.zst"),
    patchPath: join(stagingDirectory, "normalized.patch"),
    lakeManifestPath: join(stagingDirectory, "lake-manifest.json"),
  };
  try {
    await Promise.all([
      writeFile(artifactPaths.patchPath, patch, { mode: 0o600 }),
      writeFile(artifactPaths.lakeManifestPath, lakeManifest, { mode: 0o600 }),
      createZstdGitArchive(workspaceRoot, artifactPaths.sourceArchivePath),
    ]);
    return { stagingDirectory, artifactPaths, trackedFiles, changedFiles };
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function listTrackedWorkspaceFiles(workspaceRoot) {
  const records = splitNul(await runLocalCommand("git", ["ls-files", "-s", "-z"], { cwd: workspaceRoot, maxBytes: 16 * 1024 * 1024 }));
  if (records.length === 0) throw new Error("The selected Git workspace has no tracked files at HEAD.");
  return records.map((record) => {
    const separator = record.indexOf("\t");
    const fields = separator >= 0 ? record.slice(0, separator).split(" ") : [];
    const path = separator >= 0 ? record.slice(separator + 1) : "";
    if ((fields[0] !== "100644" && fields[0] !== "100755") || fields[2] !== "0") {
      throw new Error("The one-click alpha permits only regular, non-submodule tracked workspace files.");
    }
    assertSafeWorkspacePath(path);
    assertSafeEvidenceFilename(basename(path));
    return { path, mode: fields[0] === "100755" ? 0o755 : 0o644 };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function parseModifiedPaths(value) {
  const fields = splitNul(value);
  const paths = [];
  for (let index = 0; index < fields.length; index += 2) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!status || !path || status !== "M") {
      throw new Error("The one-click alpha supports modifications to existing text files only; additions, deletions, renames, mode changes, and submodules need the advanced Bundle flow.");
    }
    assertSafeWorkspacePath(path);
    assertSafeEvidenceFilename(basename(path));
    paths.push(path);
  }
  return paths;
}

async function readTrackedWorkspaceTree(workspaceRoot, trackedFiles, limits) {
  const entries = [];
  let expandedBytes = 0;
  for (const tracked of trackedFiles) {
    const path = join(workspaceRoot, ...tracked.path.split("/"));
    const stats = await assertRegularWorkspaceFile(path, tracked.path);
    const mode = stats.mode & 0o777;
    if (mode !== tracked.mode) {
      throw new Error(`Tracked file mode changed locally: ${tracked.path}. The one-click alpha requires the Git-tracked mode.`);
    }
    if (entries.length >= limits.maxFileCount || stats.size > limits.maxExpandedBytes - expandedBytes) {
      throw new Error("The local workspace exceeds the one-click Bundle expansion limits.");
    }
    expandedBytes += stats.size;
    const contents = await readFile(path);
    entries.push({ path: tracked.path, mode, contentHash: `sha256:${createHash("sha256").update(contents).digest("hex")}` });
  }
  return entries;
}

async function assertRegularWorkspaceFile(path, label) {
  const stats = await lstat(path).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`Tracked workspace file is missing: ${label}`);
    throw new Error(`Tracked workspace file could not be inspected: ${label}`);
  });
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error(`Tracked workspace entry is not a regular file: ${label}`);
  return stats;
}

async function createZstdGitArchive(workspaceRoot, destination) {
  const archive = spawn("git", ["archive", "--format=tar", "HEAD"], { cwd: workspaceRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  if (typeof zlib.createZstdCompress === "function") {
    await Promise.all([
      pipeline(archive.stdout, zlib.createZstdCompress(), output),
      waitForLocalProcess(archive, "Git could not archive the selected workspace"),
    ]);
    return;
  }

  const compressor = spawn("zstd", ["--quiet", "--compress", "--stdout"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  await Promise.all([
    pipeline(archive.stdout, compressor.stdin),
    pipeline(compressor.stdout, output),
    waitForLocalProcess(archive, "Git could not archive the selected workspace"),
    waitForLocalProcess(compressor, "This Codex installation needs Node Zstandard support or the local zstd command to prepare a Bundle"),
  ]);
}

async function runLocalCommand(command, args, { cwd, maxBytes = 4 * 1024 * 1024 } = {}) {
  const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  try {
    const [stdout, stderr] = await Promise.all([
      collectLocalOutput(child.stdout, maxBytes),
      collectLocalOutput(child.stderr, 64 * 1024),
      waitForLocalProcess(child, `${command} could not inspect the local workspace`),
    ]);
    if (stderr.length > 0) {
      // Git writes benign progress only to stderr for the commands used here;
      // a successful exit is the only accepted completion signal.
    }
    return stdout;
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

async function collectLocalOutput(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > maxBytes) throw new Error("The local workspace command produced more evidence than the closed-alpha Bundle limit permits.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function waitForLocalProcess(child, label) {
  return new Promise((resolvePromise, rejectPromise) => {
    child.once("error", (error) => rejectPromise(new Error(label, { cause: error })));
    child.once("close", (code, signal) => {
      if (code === 0 && !signal) resolvePromise();
      else rejectPromise(new Error(`${label}.`));
    });
  });
}

function splitNul(value) {
  return Buffer.from(value).toString("utf8").split("\0").filter(Boolean);
}

function assertSafeWorkspacePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024 || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.split("/").some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(segment) || segment === "." || segment === "..")) {
    throw new Error("The local workspace contains an unsafe tracked path.");
  }
}

function assertNormalizedPatchContents(contents) {
  const source = Buffer.from(contents).toString("utf8");
  if (!source.startsWith("diff --git ") || source.includes("\0") || source.includes("\r")) {
    throw new Error("The one-click Bundle requires a non-empty LF-only Git unified diff.");
  }
  let file = null;
  let sawOld = false;
  let sawNew = false;
  let sawHunk = false;
  for (const line of source.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (file && (!sawOld || !sawNew || !sawHunk)) throw new Error("The generated patch is incomplete and cannot be staged.");
      const fields = line.split(" ");
      if (fields.length !== 4 || !fields[2].startsWith("a/") || !fields[3].startsWith("b/")) throw new Error("The generated patch has an unsafe Git header.");
      assertSafeWorkspacePath(fields[2].slice(2));
      assertSafeWorkspacePath(fields[3].slice(2));
      file = fields[2].slice(2);
      sawOld = false;
      sawNew = false;
      sawHunk = false;
      continue;
    }
    if (/^(?:new file mode |deleted file mode |old mode |new mode |rename |copy |similarity index|dissimilarity index|Binary files |GIT binary patch)/.test(line)) {
      throw new Error("The generated patch contains a file operation not supported by the current one-click Bundle alpha.");
    }
    if (line.startsWith("--- ")) {
      if (!file || sawOld || line.slice(4).split("\t", 1)[0] !== `a/${file}`) throw new Error("The generated patch has an invalid old-file header.");
      sawOld = true;
    }
    if (line.startsWith("+++ ")) {
      if (!file || !sawOld || sawNew || line.slice(4).split("\t", 1)[0] !== `b/${file}`) throw new Error("The generated patch has an invalid new-file header.");
      sawNew = true;
    }
    if (line.startsWith("@@")) {
      if (!file || !sawOld || !sawNew) throw new Error("The generated patch has a hunk without complete file headers.");
      sawHunk = true;
    }
  }
  if (!file || !sawOld || !sawNew || !sawHunk) throw new Error("The generated patch has no applicable unified hunk.");
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

function researchCheckpointCitationSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      externalWorkId: { type: "string", minLength: 1, maxLength: 240 },
      relation: { type: "string", enum: ["builds_on", "formalizes", "refutes", "reproduces"] },
    },
    required: ["externalWorkId", "relation"],
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
  const missingScopes = missingRequiredConnectionScopes(existing);
  if (existing?.refreshToken && existing.baseUrl === baseUrl && missingScopes.length === 0) {
    return { connected: true, message: `Already connected as ${existing.agentLabel}. Revoke this connection in Proofweave Settings before reconnecting.` };
  }
  const upgrading = Boolean(existing?.refreshToken && existing.baseUrl === baseUrl);
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
  const grantedScopes = normalizeOAuthScopes(tokens.scope);
  const missingGrantedScopes = requiredConnectionScopes.filter((scope) => !grantedScopes.includes(scope));
  if (missingGrantedScopes.length > 0) {
    throw new Error(`Proofweave browser approval did not grant the required Connector scopes: ${missingGrantedScopes.join(", ")}.`);
  }
  const next = {
    version: 2,
    baseUrl,
    agentId: identity.agentId,
    agentLabel: identity.agentLabel,
    agentPublicKey: identity.agentPublicKey,
    privateKeyJwk: identity.privateKeyJwk,
    clientId: session.clientId,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString(),
    grantedScopes,
  };
  await writeConfig(next);
  return {
    connected: true,
    scopeUpgradeRequired: false,
    message: `${upgrading ? "Connection upgraded" : "Connected"} as ${next.agentLabel}. You can revoke this installation in Proofweave Settings.`,
  };
}

async function connectionStatus() {
  const config = await readConfig();
  if (!config?.refreshToken) return { connected: false, message: "Not connected. Use connect_proofweave to approve this local Codex." };
  const missingScopes = missingRequiredConnectionScopes(config);
  return {
    connected: true,
    agentId: config.agentId,
    agentLabel: config.agentLabel,
    baseUrl: config.baseUrl,
    scopeUpgradeRequired: missingScopes.length > 0,
    missingScopes,
    message: missingScopes.length > 0
      ? "This local connection predates artifact staging. Use connect_proofweave to approve the upgraded scopes before uploading or staging evidence."
      : "Connected locally. The refresh token and Agent private key are stored only on this computer.",
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
  if (payload.result.isError === true) throw new Error(remoteToolErrorMessage(name, payload.result));
  return payload.result;
}

function remoteToolErrorMessage(name, result) {
  const text = Array.isArray(result?.content)
    ? result.content.find((item) => item?.type === "text" && typeof item.text === "string")?.text
    : null;
  const message = typeof text === "string"
    ? text.replaceAll(/\s+/g, " ").trim().slice(0, 500)
    : "The remote tool failed without a readable error.";
  if (message === "Missing OAuth scope: artifact:write.") {
    return "This local Proofweave connection is missing OAuth scope artifact:write. Use connect_proofweave to approve the upgraded connection, then review and retry the exact Bundle.";
  }
  return `Proofweave rejected ${name}: ${message}`;
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
    version: 2,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    accessTokenExpiresAt: new Date(Date.now() + Number(tokens.expires_in) * 1_000).toISOString(),
    grantedScopes: normalizeOAuthScopes(tokens.scope),
  };
  await writeConfig(next);
  return next;
}

function missingRequiredConnectionScopes(config) {
  const grantedScopes = Array.isArray(config?.grantedScopes)
    ? normalizeOAuthScopes(config.grantedScopes)
    : config?.version === 1 && config?.refreshToken
      ? legacyConnectionScopes
      : [];
  return requiredConnectionScopes.filter((scope) => !grantedScopes.includes(scope));
}

function normalizeOAuthScopes(value) {
  const scopes = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\s+/) : [];
  return [...new Set(scopes.filter((scope) => typeof scope === "string" && scope.length > 0))].sort();
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
