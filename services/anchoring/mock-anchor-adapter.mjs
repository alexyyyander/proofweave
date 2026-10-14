// services/anchoring/mock-anchor-adapter.mjs

export function createMockAnchorAdapter({ network = "local", operatorAddress = "mock:operator", confirmations = 12 } = {}) {
  const txs = new Map();
  let counter = 0;
  return {
    id: "mock",
    network,
    operatorAddress,
    async submitRoot({ root, manifestHash, leafCount, prevRoot, batchId, sender }) {
      const txId = `tx-${(counter += 1)}`;
      // sender is mock-only and defaults to operator; used by witness independence tests (real adapters ignore it).
      txs.set(txId, { root, manifestHash, leafCount, prevRoot, batchId, sender: sender ?? operatorAddress });
      return { txRef: `mock:${network}:${txId}` };
    },
    async getConfirmation() {
      return { status: "confirmed", confirmations, blockRef: `mock-block-${confirmations}` };
    },
    async readAnchoredRoot({ txRef }) {
      const txId = String(txRef ?? "").split(":").at(-1);
      const tx = txs.get(txId);
      return tx ? { root: tx.root, manifestHash: tx.manifestHash, leafCount: tx.leafCount, prevRoot: tx.prevRoot, sender: tx.sender } : null;
    },
  };
}
