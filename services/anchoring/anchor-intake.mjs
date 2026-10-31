// services/anchoring/anchor-intake.mjs
import { anchorLeafHash, anchorLeafProtocolVersion, normalizeAnchorLeaf } from "../../packages/protocol/anchor-leaf.mjs";

export function createAnchorIntake(store) {
  return {
    async enqueueAnchorRecord({ recordType, recordId, recordHash, createdAt }) {
      const leaf = normalizeAnchorLeaf({ protocolVersion: anchorLeafProtocolVersion, recordType, recordId, recordHash });
      const leafHash = await anchorLeafHash(leaf);
      return store.insertRecord({ recordType, recordId, recordHash, leafHash, createdAt });
    },
  };
}
