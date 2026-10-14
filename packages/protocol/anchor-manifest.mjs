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
  if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
    throw new AnchorManifestError("Anchor manifest must be a plain object.");
  }
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
  for (const entry of manifest.leaves) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new AnchorManifestError("Anchor manifest leaf entry must be a plain object.");
    }
    if (typeof entry.recordType !== "string" || entry.recordType.length === 0
      || typeof entry.recordId !== "string" || entry.recordId.length === 0) {
      throw new AnchorManifestError("Anchor manifest leaf entry requires string recordType and recordId.");
    }
    if (typeof entry.recordHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(entry.recordHash)) {
      throw new AnchorManifestError("Anchor manifest leaf entry recordHash must be sha256:<hex>.");
    }
  }
  // Normalize: sort leaves by (recordType, recordId, recordHash) so out-of-order input yields the same canonical form and hash.
  const leaves = [...manifest.leaves].sort(compareLeafEntries);
  return { ...manifest, leaves };
}

function compareLeafEntries(a, b) {
  return compareStrings(a.recordType, b.recordType)
    || compareStrings(a.recordId, b.recordId)
    || compareStrings(a.recordHash, b.recordHash);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function canonicalAnchorManifest(manifest) {
  return canonicalJson(normalizeAnchorManifest(manifest));
}

export async function anchorManifestHash(manifest) {
  return sha256Canonical(normalizeAnchorManifest(manifest));
}

/** Recompute the tree from manifest leaves and compare with the declared root. Structural/format errors return false, never throw. */
export async function verifyAnchorManifest(manifest) {
  try {
    const normalized = normalizeAnchorManifest(manifest);
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
