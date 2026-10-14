// services/anchoring/anchor-batch-builder.mjs
import { anchorManifestHash, anchorManifestProtocolVersion } from "../../packages/protocol/anchor-manifest.mjs";
import { buildMerkleTree } from "../../packages/protocol/merkle-tree.mjs";

export function createAnchorBatchBuilder({ store, chain, network, now = () => new Date().toISOString() }) {
  return {
    async buildNextBatch({ prevBatchId = null, prevRoot = null, expectedHeadVersion } = {}) {
      const pending = await store.listPendingRecords(1000);
      if (pending.length === 0) return { created: false };
      const sorted = [...pending].sort(compareLeaves);
      const tree = await buildMerkleTree(sorted.map((row) => row.leaf_hash));
      const manifest = Object.freeze({
        protocolVersion: anchorManifestProtocolVersion,
        batchId: `anchor-batch:${crypto.randomUUID()}`,
        root: tree.root,
        leafCount: tree.leafCount,
        prevBatchId,
        prevRoot,
        createdAt: now(),
        leaves: sorted.map((row) => ({ recordType: row.record_type, recordId: row.record_id, recordHash: row.record_hash })),
      });
      const manifestHash = await anchorManifestHash(manifest);
      const manifestKey = `anchors/${manifestHash}`;
      const stored = await store.createBatch({
        id: manifest.batchId, root: tree.root, leafCount: tree.leafCount, manifestHash, manifestKey,
        prevBatchId, prevRoot, chain, network, createdAt: manifest.createdAt, leaves: sorted, expectedHeadVersion,
      });
      return { created: true, batch: stored.batch ?? stored, manifest, manifestHash, manifestKey, tree };
    },
  };
}

function compareLeaves(a, b) {
  return compareStrings(a.record_type, b.record_type)
    || compareStrings(a.record_id, b.record_id)
    || compareStrings(a.record_hash, b.record_hash);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
