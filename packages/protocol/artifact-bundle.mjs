import { canonicalJson, canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";

export const artifactBundleProtocolVersion = "pw-artifact-bundle-v1";

export class ArtifactBundleProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactBundleProtocolError";
  }
}

/** Normalize the complete reproducibility manifest submitted for one Attempt. */
export function normalizeArtifactBundle(bundle) {
  requireRecord(bundle, "Artifact bundle");
  rejectExtraKeys(bundle, [
    "protocolVersion", "id", "attemptId", "problemRevisionId", "target",
    "source", "environment", "entryCommand", "dependencyReceipts",
    "agentEvent", "policy",
  ], "Artifact bundle");
  if (bundle.protocolVersion !== artifactBundleProtocolVersion) {
    throw new ArtifactBundleProtocolError("Unsupported artifact bundle protocol version.");
  }
  requireIdentifier(bundle.id, "bundle id");
  requireIdentifier(bundle.attemptId, "bundle attemptId");
  requireIdentifier(bundle.problemRevisionId, "bundle problemRevisionId");

  requireRecord(bundle.target, "bundle target");
  rejectExtraKeys(bundle.target, ["declaration", "statementHash"], "bundle target");
  requireQualifiedName(bundle.target.declaration, "bundle target declaration");
  requireSha256(bundle.target.statementHash, "bundle target statementHash");

  requireRecord(bundle.source, "bundle source");
  rejectExtraKeys(bundle.source, ["archiveKey", "archiveHash", "treeHash", "patchKey", "patchHash"], "bundle source");
  requireSha256(bundle.source.archiveHash, "bundle source archiveHash");
  requireContentKey(bundle.source.archiveKey, bundle.source.archiveHash, "bundle source archiveKey");
  requireSha256(bundle.source.treeHash, "bundle source treeHash");
  requireSha256(bundle.source.patchHash, "bundle source patchHash");
  requireContentKey(bundle.source.patchKey, bundle.source.patchHash, "bundle source patchKey");

  requireRecord(bundle.environment, "bundle environment");
  rejectExtraKeys(bundle.environment, ["leanToolchain", "lakeManifestKey", "lakeManifestHash", "mathlibRevision"], "bundle environment");
  requireString(bundle.environment.leanToolchain, "bundle environment leanToolchain", 240);
  requireSha256(bundle.environment.lakeManifestHash, "bundle environment lakeManifestHash");
  requireContentKey(bundle.environment.lakeManifestKey, bundle.environment.lakeManifestHash, "bundle environment lakeManifestKey");
  requireString(bundle.environment.mathlibRevision, "bundle environment mathlibRevision", 160);

  const entryCommand = normalizeEntryCommand(bundle.entryCommand);
  const dependencyReceipts = normalizeDependencyReceipts(bundle.dependencyReceipts);
  const agentEvent = normalizeAgentEvent(bundle.agentEvent);
  const policy = normalizePolicy(bundle.policy);

  return Object.freeze({
    protocolVersion: artifactBundleProtocolVersion,
    id: bundle.id,
    attemptId: bundle.attemptId,
    problemRevisionId: bundle.problemRevisionId,
    target: Object.freeze({ ...bundle.target }),
    source: Object.freeze({ ...bundle.source }),
    environment: Object.freeze({ ...bundle.environment }),
    entryCommand: Object.freeze(entryCommand),
    dependencyReceipts: Object.freeze(dependencyReceipts),
    agentEvent: Object.freeze(agentEvent),
    policy: Object.freeze(policy),
  });
}

export function canonicalArtifactBundle(bundle) {
  return canonicalJson(normalizeArtifactBundle(bundle));
}

export async function artifactBundleHash(bundle) {
  return sha256Canonical(normalizeArtifactBundle(bundle));
}

/**
 * The Agent signs this payload, not the full manifest: its signature and
 * payloadHash fields are deliberately excluded to avoid a circular hash.
 */
export function artifactBundleSigningPayload(bundle) {
  const normalized = normalizeArtifactBundle(bundle);
  return {
    protocolVersion: normalized.protocolVersion,
    id: normalized.id,
    attemptId: normalized.attemptId,
    problemRevisionId: normalized.problemRevisionId,
    target: normalized.target,
    source: normalized.source,
    environment: normalized.environment,
    entryCommand: normalized.entryCommand,
    dependencyReceipts: normalized.dependencyReceipts,
    agentEvent: {
      eventId: normalized.agentEvent.eventId,
      occurredAt: normalized.agentEvent.occurredAt,
      agentPublicKey: normalized.agentEvent.agentPublicKey,
    },
    policy: normalized.policy,
  };
}

export async function artifactBundleSigningPayloadHash(bundle) {
  return sha256Canonical(artifactBundleSigningPayload(bundle));
}

/** Verify that the declared Agent key actually signed the complete evidence payload. */
export async function verifyArtifactBundleAgentSignature(bundle) {
  const normalized = normalizeArtifactBundle(bundle);
  if (normalized.agentEvent.payloadHash !== await artifactBundleSigningPayloadHash(normalized)) {
    return false;
  }
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
    canonicalUtf8(artifactBundleSigningPayload(normalized)),
  );
}

function normalizeDependencyReceipts(value) {
  if (!Array.isArray(value)) {
    throw new ArtifactBundleProtocolError("bundle dependencyReceipts must be an array.");
  }
  const receipts = value.map((receipt) => {
    requireRecord(receipt, "dependency receipt");
    rejectExtraKeys(receipt, ["receiptId", "receiptHash"], "dependency receipt");
    requireIdentifier(receipt.receiptId, "dependency receipt id");
    requireSha256(receipt.receiptHash, "dependency receipt hash");
    return { receiptId: receipt.receiptId, receiptHash: receipt.receiptHash };
  }).sort((left, right) => left.receiptId.localeCompare(right.receiptId));
  if (new Set(receipts.map((receipt) => receipt.receiptId)).size !== receipts.length) {
    throw new ArtifactBundleProtocolError("bundle dependency receipt ids must be unique.");
  }
  return receipts;
}

function normalizeAgentEvent(value) {
  requireRecord(value, "bundle agentEvent");
  rejectExtraKeys(value, ["eventId", "occurredAt", "payloadHash", "agentPublicKey", "signature"], "bundle agentEvent");
  requireIdentifier(value.eventId, "bundle agentEvent id");
  requireUtcInstant(value.occurredAt, "bundle agentEvent occurredAt");
  requireSha256(value.payloadHash, "bundle agentEvent payloadHash");
  requireBase64Url(value.agentPublicKey, 32, "bundle agentEvent public key");
  requireBase64Url(value.signature, 64, "bundle agentEvent signature");
  return { ...value };
}

function normalizePolicy(value) {
  requireRecord(value, "bundle policy");
  rejectExtraKeys(value, ["requireNoSorry", "allowedAxioms"], "bundle policy");
  if (value.requireNoSorry !== true || !Array.isArray(value.allowedAxioms) || !value.allowedAxioms.every(isQualifiedName)) {
    throw new ArtifactBundleProtocolError("bundle policy requires a sorry audit and qualified axiom allowlist.");
  }
  return {
    requireNoSorry: true,
    allowedAxioms: [...new Set(value.allowedAxioms)].sort(),
  };
}

function normalizeEntryCommand(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 32 || value.some((part) => typeof part !== "string" || part.length === 0 || part.length > 512)) {
    throw new ArtifactBundleProtocolError("bundle entryCommand must be a bounded argument array.");
  }
  if (value[0] !== "lake" || value[1] !== "env" || value[2] !== "lean" || value.some((part) => /[;|&><`$\n\r]/.test(part))) {
    throw new ArtifactBundleProtocolError("bundle entryCommand must be a shell-free lake env lean command.");
  }
  return [...value];
}

function rejectExtraKeys(value, allowed, label) {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) {
    throw new ArtifactBundleProtocolError(`${label} contains unsupported field ${extras[0]}.`);
  }
}

function requireContentKey(value, hash, label) {
  requireString(value, label, 1_024);
  const match = /^bundles\/sha256\/([a-f0-9]{64})\/(?:[A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.exec(value);
  if (!match || match[1] !== hash.slice("sha256:".length)) {
    throw new ArtifactBundleProtocolError(`${label} must embed its matching SHA-256 hash.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ArtifactBundleProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireBase64Url(value, length, label) {
  requireString(value, label, 256);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ArtifactBundleProtocolError(`${label} must be unpadded base64url.`);
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  if (atob(padded).length !== length) {
    throw new ArtifactBundleProtocolError(`${label} has an invalid length.`);
  }
}

function requireUtcInstant(value, label) {
  requireString(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ArtifactBundleProtocolError(`${label} must be an ISO-8601 UTC instant.`);
  }
}

function requireQualifiedName(value, label) {
  if (!isQualifiedName(value)) throw new ArtifactBundleProtocolError(`${label} must be a Lean qualified name.`);
}

function isQualifiedName(value) {
  return typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_'.]*(?:\.[A-Za-z_][A-Za-z0-9_'.]*)*$/.test(value);
}

function requireIdentifier(value, label) {
  requireString(value, label, 240);
}

function requireString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new ArtifactBundleProtocolError(`${label} must be a non-empty string.`);
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ArtifactBundleProtocolError(`${label} must be an object.`);
  }
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
