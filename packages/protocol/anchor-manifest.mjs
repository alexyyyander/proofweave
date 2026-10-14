// packages/protocol/anchor-manifest.mjs
import { canonicalJson, sha256Canonical } from "./canonical-json.mjs";
import { anchorLeafHash, anchorLeafProtocolVersion } from "./anchor-leaf.mjs";
import { buildMerkleTree } from "./merkle-tree.mjs";

export const anchorManifestProtocolVersion = "pw-anchor-manifest-v1";

export class AnchorManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = "AnchorManifestError";
  }
}

export function normalizeAnchorManifest(manifest) {
  const allowed = ["protocolVersion", "batchId", "root", "leafCount", "prevBatchId", "prevRoot", "createdAt", "leaves"];
  for (const key of Object.keys(manifest)) {
    if (!allowed.includes(key)) throw new AnchorManifestError(`Anchor manifest has unsupported field ${key}.`);
  }
  if (manifest.protocolVersion !== anchorManifestProtocolVersion) {
    throw new AnchorManifestError(`Anchor manifest protocolVersion must be ${anchorManifestProtocolVersion}.`);
  }
  if (typeof manifest.batchId !== "string" || manifest.batchId.length === 0) {
    throw new AnchorManifestError("Anchor manifest batchId must be a non-empty string.");
  }
  if (!Array.isArray(manifest.leaves) || manifest.leaves.length !== manifest.leafCount) {
    throw new AnchorManifestError("Anchor manifest leafCount must match leaves length.");
  }
  // Normalize: sort leaves by (recordType, recordId, recordHash) so out-of-order input yields the same canonical form and hash.
  const leaves = [...manifest.leaves].sort(compareLeafEntries);
  return { ...manifest, leaves };
}

function compareLeafEntries(a, b) {
  return a.recordType.localeCompare(b.recordType)
    || a.recordId.localeCompare(b.recordId)
    || a.recordHash.localeCompare(b.recordHash);
}

export function canonicalAnchorManifest(manifest) {
  return canonicalJson(normalizeAnchorManifest(manifest));
}

export async function anchorManifestHash(manifest) {
  return sha256Canonical(normalizeAnchorManifest(manifest));
}

/** Recompute the tree from manifest leaves and compare with the declared root. Structural/format errors return false, never throw. */
export async function verifyAnchorManifest(manifest) {
  let normalized;
  try {
    normalized = normalizeAnchorManifest(manifest);
    const leafHashes = [];
    for (const entry of normalized.leaves) {
      leafHashes.push(await anchorLeafHash({ protocolVersion: anchorLeafProtocolVersion, ...entry }));
    }
    const tree = await buildMerkleTree(leafHashes);
    return tree.root === normalized.root && tree.leafCount === normalized.leafCount;
  } catch {
    return false;
  }
}
