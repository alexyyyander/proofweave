import { canonicalJson, canonicalUtf8, sha256Canonical } from "./canonical-json.mjs";
import { workspaceTreeProtocolVersion } from "./workspace-tree.mjs";

export const artifactBundleProtocolVersion = "pw-artifact-bundle-v1";
export const artifactBundleV2ProtocolVersion = "pw-artifact-bundle-v2";
export const artifactBundleProtocolVersions = Object.freeze([
  artifactBundleProtocolVersion,
  artifactBundleV2ProtocolVersion,
]);

export const workspaceTreeAlgorithm = workspaceTreeProtocolVersion;
export const workspaceTreeState = "after_patch_and_lake_manifest";
export const workspaceArchiveFormat = "tar.zst";
export const workspacePatchFormat = "unified-diff";

export class ArtifactBundleProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactBundleProtocolError";
  }
}

/**
 * Normalize a complete reproducibility manifest. v1 remains readable for
 * historical evidence; v2 adds the strict workspace reconstruction rules that
 * an execution service needs before it can unpack submitted source.
 */
export function normalizeArtifactBundle(bundle) {
  requireRecord(bundle, "Artifact bundle");
  if (bundle.protocolVersion === artifactBundleProtocolVersion) {
    return normalizeArtifactBundleV1(bundle);
  }
  if (bundle.protocolVersion === artifactBundleV2ProtocolVersion) {
    return normalizeArtifactBundleV2(bundle);
  }
  throw new ArtifactBundleProtocolError("Unsupported artifact bundle protocol version.");
}

export function canonicalArtifactBundle(bundle) {
  return canonicalJson(normalizeArtifactBundle(bundle));
}

export async function artifactBundleHash(bundle) {
  return sha256Canonical(normalizeArtifactBundle(bundle));
}

/**
 * Return the exact immutable objects every bundle version needs. Storage and
 * runners use this rather than reaching into a version-specific manifest.
 */
export function artifactBundleObjectReferences(bundle) {
  const normalized = normalizeArtifactBundle(bundle);
  if (normalized.protocolVersion === artifactBundleProtocolVersion) {
    return Object.freeze([
      reference("sourceArchive", "source archive", normalized.source.archiveKey, normalized.source.archiveHash),
      reference("sourcePatch", "source patch", normalized.source.patchKey, normalized.source.patchHash),
      reference("lakeManifest", "Lake manifest", normalized.environment.lakeManifestKey, normalized.environment.lakeManifestHash),
    ]);
  }
  return Object.freeze([
    reference("sourceArchive", "source archive", normalized.workspace.archive.objectKey, normalized.workspace.archive.contentHash),
    reference("sourcePatch", "source patch", normalized.workspace.patch.objectKey, normalized.workspace.patch.contentHash),
    reference("lakeManifest", "Lake manifest", normalized.workspace.lakeManifest.objectKey, normalized.workspace.lakeManifest.contentHash),
  ]);
}

/**
 * The Agent signs this payload, not the full manifest: its signature and
 * payloadHash fields are deliberately excluded to avoid a circular hash.
 */
export function artifactBundleSigningPayload(bundle) {
  const normalized = normalizeArtifactBundle(bundle);
  const workspaceEvidence = normalized.protocolVersion === artifactBundleProtocolVersion
    ? { source: normalized.source }
    : { workspace: normalized.workspace };
  return {
    protocolVersion: normalized.protocolVersion,
    id: normalized.id,
    attemptId: normalized.attemptId,
    problemRevisionId: normalized.problemRevisionId,
    target: normalized.target,
    ...workspaceEvidence,
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

function normalizeArtifactBundleV1(bundle) {
  rejectExtraKeys(bundle, [
    "protocolVersion", "id", "attemptId", "problemRevisionId", "target",
    "source", "environment", "entryCommand", "dependencyReceipts",
    "agentEvent", "policy",
  ], "Artifact bundle");
  const common = normalizeCommon(bundle, { version: artifactBundleProtocolVersion, environment: "v1" });

  requireRecord(bundle.source, "bundle source");
  rejectExtraKeys(bundle.source, ["archiveKey", "archiveHash", "treeHash", "patchKey", "patchHash"], "bundle source");
  requireSha256(bundle.source.archiveHash, "bundle source archiveHash");
  requireContentKey(bundle.source.archiveKey, bundle.source.archiveHash, "bundle source archiveKey");
  requireSha256(bundle.source.treeHash, "bundle source treeHash");
  requireSha256(bundle.source.patchHash, "bundle source patchHash");
  requireContentKey(bundle.source.patchKey, bundle.source.patchHash, "bundle source patchKey");

  return Object.freeze({
    protocolVersion: artifactBundleProtocolVersion,
    ...common,
    source: Object.freeze({ ...bundle.source }),
  });
}

function normalizeArtifactBundleV2(bundle) {
  rejectExtraKeys(bundle, [
    "protocolVersion", "id", "attemptId", "problemRevisionId", "target",
    "workspace", "environment", "entryCommand", "dependencyReceipts",
    "agentEvent", "policy",
  ], "Artifact bundle");
  const common = normalizeCommon(bundle, { version: artifactBundleV2ProtocolVersion, environment: "v2" });
  return Object.freeze({
    protocolVersion: artifactBundleV2ProtocolVersion,
    ...common,
    workspace: normalizeWorkspace(bundle.workspace),
  });
}

function normalizeCommon(bundle, { environment }) {
  requireIdentifier(bundle.id, "bundle id");
  requireIdentifier(bundle.attemptId, "bundle attemptId");
  requireIdentifier(bundle.problemRevisionId, "bundle problemRevisionId");

  const target = normalizeTarget(bundle.target);
  const normalizedEnvironment = environment === "v1"
    ? normalizeV1Environment(bundle.environment)
    : normalizeV2Environment(bundle.environment);
  const entryCommand = normalizeEntryCommand(bundle.entryCommand);
  const dependencyReceipts = normalizeDependencyReceipts(bundle.dependencyReceipts);
  const agentEvent = normalizeAgentEvent(bundle.agentEvent);
  const policy = normalizePolicy(bundle.policy);

  return {
    id: bundle.id,
    attemptId: bundle.attemptId,
    problemRevisionId: bundle.problemRevisionId,
    target,
    environment: normalizedEnvironment,
    entryCommand: Object.freeze(entryCommand),
    dependencyReceipts: Object.freeze(dependencyReceipts),
    agentEvent: Object.freeze(agentEvent),
    policy: Object.freeze(policy),
  };
}

function normalizeTarget(value) {
  requireRecord(value, "bundle target");
  rejectExtraKeys(value, ["declaration", "statementHash"], "bundle target");
  requireQualifiedName(value.declaration, "bundle target declaration");
  requireSha256(value.statementHash, "bundle target statementHash");
  return Object.freeze({ ...value });
}

function normalizeV1Environment(value) {
  requireRecord(value, "bundle environment");
  rejectExtraKeys(value, ["leanToolchain", "lakeManifestKey", "lakeManifestHash", "mathlibRevision"], "bundle environment");
  requireString(value.leanToolchain, "bundle environment leanToolchain", 240);
  requireSha256(value.lakeManifestHash, "bundle environment lakeManifestHash");
  requireContentKey(value.lakeManifestKey, value.lakeManifestHash, "bundle environment lakeManifestKey");
  requireString(value.mathlibRevision, "bundle environment mathlibRevision", 160);
  return Object.freeze({ ...value });
}

function normalizeV2Environment(value) {
  requireRecord(value, "bundle environment");
  rejectExtraKeys(value, ["leanToolchain", "mathlibRevision"], "bundle environment");
  requireString(value.leanToolchain, "bundle environment leanToolchain", 240);
  requireString(value.mathlibRevision, "bundle environment mathlibRevision", 160);
  return Object.freeze({ ...value });
}

function normalizeWorkspace(value) {
  requireRecord(value, "bundle workspace");
  rejectExtraKeys(value, ["archive", "patch", "tree", "lakeManifest"], "bundle workspace");
  return Object.freeze({
    archive: normalizeArchive(value.archive),
    patch: normalizePatch(value.patch),
    tree: normalizeWorkspaceTree(value.tree),
    lakeManifest: normalizeWorkspaceLakeManifest(value.lakeManifest),
  });
}

function normalizeArchive(value) {
  requireRecord(value, "bundle workspace archive");
  rejectExtraKeys(value, ["objectKey", "contentHash", "format", "maxExpandedBytes", "maxFileCount", "symlinkPolicy"], "bundle workspace archive");
  requireSha256(value.contentHash, "bundle workspace archive contentHash");
  requireNamedContentKey(value.objectKey, value.contentHash, "source.tar.zst", "bundle workspace archive objectKey");
  if (value.format !== workspaceArchiveFormat) {
    throw new ArtifactBundleProtocolError(`bundle workspace archive format must be ${workspaceArchiveFormat}.`);
  }
  requireBoundedInteger(value.maxExpandedBytes, "bundle workspace archive maxExpandedBytes", 1, 16 * 1024 * 1024 * 1024);
  requireBoundedInteger(value.maxFileCount, "bundle workspace archive maxFileCount", 1, 100_000);
  if (value.symlinkPolicy !== "forbidden") {
    throw new ArtifactBundleProtocolError("bundle workspace archive symlinkPolicy must be forbidden.");
  }
  return Object.freeze({ ...value });
}

function normalizePatch(value) {
  requireRecord(value, "bundle workspace patch");
  rejectExtraKeys(value, ["objectKey", "contentHash", "format", "strip", "allowFuzz"], "bundle workspace patch");
  requireSha256(value.contentHash, "bundle workspace patch contentHash");
  requireNamedContentKey(value.objectKey, value.contentHash, "normalized.patch", "bundle workspace patch objectKey");
  if (value.format !== workspacePatchFormat || value.strip !== 1 || value.allowFuzz !== false) {
    throw new ArtifactBundleProtocolError("bundle workspace patch must be a no-fuzz unified diff with strip level 1.");
  }
  return Object.freeze({ ...value });
}

function normalizeWorkspaceTree(value) {
  requireRecord(value, "bundle workspace tree");
  rejectExtraKeys(value, ["hash", "algorithm", "state"], "bundle workspace tree");
  requireSha256(value.hash, "bundle workspace tree hash");
  if (value.algorithm !== workspaceTreeAlgorithm || value.state !== workspaceTreeState) {
    throw new ArtifactBundleProtocolError("bundle workspace tree must use the fixed post-patch tree algorithm and state.");
  }
  return Object.freeze({ ...value });
}

function normalizeWorkspaceLakeManifest(value) {
  requireRecord(value, "bundle workspace lakeManifest");
  rejectExtraKeys(value, ["objectKey", "contentHash", "destination"], "bundle workspace lakeManifest");
  requireSha256(value.contentHash, "bundle workspace lakeManifest contentHash");
  requireNamedContentKey(value.objectKey, value.contentHash, "lake-manifest.json", "bundle workspace lakeManifest objectKey");
  if (value.destination !== "lake-manifest.json") {
    throw new ArtifactBundleProtocolError("bundle workspace lakeManifest destination must be lake-manifest.json.");
  }
  return Object.freeze({ ...value });
}

function reference(id, label, objectKey, contentHash) {
  return Object.freeze({ id, label, objectKey, contentHash });
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

function requireNamedContentKey(value, hash, filename, label) {
  requireContentKey(value, hash, label);
  if (!value.endsWith(`/${filename}`)) {
    throw new ArtifactBundleProtocolError(`${label} must name ${filename}.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ArtifactBundleProtocolError(`${label} must be sha256:<hex>.`);
  }
}

function requireBoundedInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ArtifactBundleProtocolError(`${label} must be an integer from ${min} to ${max}.`);
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
