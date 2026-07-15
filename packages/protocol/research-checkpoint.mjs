import { canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";

export const researchCheckpointProtocolVersion = "pw-research-checkpoint-v1";
export const researchCheckpointKinds = Object.freeze([
  "formalization",
  "hypothesis",
  "lemma",
  "proof_state",
  "proof_patch",
  "counterexample",
  "negative_result",
  "synthesis",
]);
export const researchCitationRelations = Object.freeze([
  "builds_on",
  "formalizes",
  "refutes",
  "reproduces",
]);

export class ResearchCheckpointProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResearchCheckpointProtocolError";
  }
}

/**
 * Normalize one immutable, Agent-signed public research milestone. A
 * checkpoint records structured output only; it is never raw model reasoning,
 * Lean verification, independent review, novelty, or contribution credit.
 */
export function normalizeResearchCheckpoint(checkpoint) {
  requireRecord(checkpoint, "Research checkpoint");
  rejectExtraKeys(checkpoint, [
    "protocolVersion",
    "id",
    "attemptId",
    "problemRevisionId",
    "kind",
    "summary",
    "parentNodeIds",
    "proofStateHash",
    "artifactBundleHash",
    "citations",
    "agentEvent",
    "payloadHash",
  ]);
  if (checkpoint.protocolVersion !== researchCheckpointProtocolVersion) {
    throw new ResearchCheckpointProtocolError("Unsupported research checkpoint protocol version.");
  }
  requireIdentifier(checkpoint.id, "Research checkpoint id");
  requireIdentifier(checkpoint.attemptId, "Research checkpoint attemptId");
  requireIdentifier(checkpoint.problemRevisionId, "Research checkpoint problemRevisionId");
  if (!researchCheckpointKinds.includes(checkpoint.kind)) {
    throw new ResearchCheckpointProtocolError("Research checkpoint kind is invalid.");
  }
  const summary = requireSummary(checkpoint.summary);
  const parentNodeIds = normalizeParentNodeIds(checkpoint.parentNodeIds, checkpoint.id, checkpoint.kind);
  const proofStateHash = optionalSha256(checkpoint.proofStateHash, "Research checkpoint proofStateHash");
  const artifactBundleHash = optionalSha256(checkpoint.artifactBundleHash, "Research checkpoint artifactBundleHash");
  const citations = normalizeCitations(checkpoint.citations);
  const agentEvent = normalizeAgentEvent(checkpoint.agentEvent);
  requireSha256(checkpoint.payloadHash, "Research checkpoint payloadHash");

  return Object.freeze({
    protocolVersion: researchCheckpointProtocolVersion,
    id: checkpoint.id,
    attemptId: checkpoint.attemptId,
    problemRevisionId: checkpoint.problemRevisionId,
    kind: checkpoint.kind,
    summary,
    parentNodeIds: Object.freeze(parentNodeIds),
    proofStateHash,
    artifactBundleHash,
    citations: Object.freeze(citations),
    agentEvent,
    payloadHash: checkpoint.payloadHash,
  });
}

/** Exclude detached hash/signature fields to avoid a circular payload. */
export function researchCheckpointSigningPayload(checkpoint) {
  const normalized = normalizeResearchCheckpoint(checkpoint);
  return Object.freeze({
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
    agentEvent: Object.freeze({
      id: normalized.agentEvent.id,
      agentId: normalized.agentEvent.agentId,
      agentPublicKey: normalized.agentEvent.agentPublicKey,
      occurredAt: normalized.agentEvent.occurredAt,
    }),
  });
}

export function researchCheckpointPayloadHash(checkpoint) {
  return sha256Canonical(researchCheckpointSigningPayload(checkpoint));
}

export function researchCheckpointHash(checkpoint) {
  return sha256Canonical(normalizeResearchCheckpoint(checkpoint));
}

export async function verifyResearchCheckpointSignature(checkpoint) {
  const normalized = normalizeResearchCheckpoint(checkpoint);
  if (normalized.payloadHash !== await researchCheckpointPayloadHash(normalized)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase64Url(normalized.agentEvent.agentPublicKey),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "Ed25519",
    key,
    fromBase64Url(normalized.agentEvent.signature),
    canonicalUtf8(researchCheckpointSigningPayload(normalized)),
  );
}

function normalizeParentNodeIds(value, checkpointId, kind) {
  if (!Array.isArray(value) || value.length > 8) {
    throw new ResearchCheckpointProtocolError("Research checkpoint parentNodeIds must contain at most eight identifiers.");
  }
  const normalized = value.map((entry) => {
    requireIdentifier(entry, "Research checkpoint parent node id");
    if (entry === checkpointId) {
      throw new ResearchCheckpointProtocolError("A research checkpoint cannot name itself as a parent.");
    }
    return entry;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new ResearchCheckpointProtocolError("Research checkpoint parentNodeIds must be unique.");
  }
  normalized.sort(bytewiseCompare);
  if (kind === "synthesis" && normalized.length < 2) {
    throw new ResearchCheckpointProtocolError("A synthesis checkpoint must name at least two parent nodes.");
  }
  return normalized;
}

function normalizeCitations(value) {
  if (!Array.isArray(value) || value.length > 32) {
    throw new ResearchCheckpointProtocolError("Research checkpoint citations must contain at most 32 entries.");
  }
  const citations = value.map((citation) => {
    requireRecord(citation, "Research checkpoint citation");
    rejectExtraKeys(citation, ["externalWorkId", "relation"]);
    requireIdentifier(citation.externalWorkId, "Research checkpoint citation externalWorkId");
    if (!researchCitationRelations.includes(citation.relation)) {
      throw new ResearchCheckpointProtocolError("Research checkpoint citation relation is invalid.");
    }
    return Object.freeze({ externalWorkId: citation.externalWorkId, relation: citation.relation });
  });
  const keys = citations.map((citation) => `${citation.externalWorkId}\u0000${citation.relation}`);
  if (new Set(keys).size !== keys.length) {
    throw new ResearchCheckpointProtocolError("Research checkpoint citations must be unique.");
  }
  citations.sort((left, right) => bytewiseCompare(
    `${left.externalWorkId}\u0000${left.relation}`,
    `${right.externalWorkId}\u0000${right.relation}`,
  ));
  return citations;
}

function normalizeAgentEvent(value) {
  requireRecord(value, "Research checkpoint agentEvent");
  rejectExtraKeys(value, ["id", "agentId", "agentPublicKey", "occurredAt", "signature"]);
  requireIdentifier(value.id, "Research checkpoint agent event id");
  requireIdentifier(value.agentId, "Research checkpoint agent id");
  requireBase64Url(value.agentPublicKey, 32, "Research checkpoint agent public key");
  requireUtcInstant(value.occurredAt, "Research checkpoint occurredAt");
  requireBase64Url(value.signature, 64, "Research checkpoint signature");
  return Object.freeze({
    id: value.id,
    agentId: value.agentId,
    agentPublicKey: value.agentPublicKey,
    occurredAt: value.occurredAt,
    signature: value.signature,
  });
}

function requireSummary(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 1_200 ||
    value !== value.trim() ||
    value.includes("\u0000") ||
    value.split("\n").length > 12
  ) {
    throw new ResearchCheckpointProtocolError("Research checkpoint summary must be concise, trimmed structured output of at most 1,200 characters and 12 lines.");
  }
  return value;
}

function optionalSha256(value, label) {
  if (value === null) return null;
  requireSha256(value, label);
  return value;
}

function rejectExtraKeys(value, allowed) {
  const extra = Object.keys(value).find((key) => !allowed.includes(key));
  if (extra) throw new ResearchCheckpointProtocolError(`Research checkpoint contains unsupported field ${extra}.`);
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ResearchCheckpointProtocolError(`${label} must be an object.`);
  }
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || value.length > 240) {
    throw new ResearchCheckpointProtocolError(`${label} must be a trimmed, non-empty identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ResearchCheckpointProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ResearchCheckpointProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireBase64Url(value, length, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value) || fromBase64Url(value).byteLength !== length) {
    throw new ResearchCheckpointProtocolError(`${label} must be ${length}-byte unpadded base64url.`);
  }
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function bytewiseCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
