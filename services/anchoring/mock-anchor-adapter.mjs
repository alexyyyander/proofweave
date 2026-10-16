// services/anchoring/mock-anchor-adapter.mjs

export function createMockAnchorAdapter({ network = "local", operatorAddress = "mock:operator", confirmations = 12 } = {}) {
  const txs = new Map();
  let counter = 0;
  const adapter = {
    id: "mock",
    network,
    operatorAddress,
    async prepareRoot({ root, manifestHash, leafCount, prevRoot, batchId, sender }) {
      const txId = `tx-${(counter += 1)}`;
      // sender is mock-only and defaults to operator; used by witness independence tests (real adapters ignore it).
      return { txRef: `mock:${network}:${txId}`, signedTransaction: { root, manifestHash, leafCount, prevRoot, batchId: batchId ?? null, sender: sender ?? operatorAddress } };
    },
    async broadcastPreparedRoot(prepared) {
      txs.set(prepared.txRef.split(":").at(-1), prepared.signedTransaction);
      return { txRef: prepared.txRef };
    },
    async submitRoot(payload) {
      return adapter.broadcastPreparedRoot(await adapter.prepareRoot(payload), payload);
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
  return adapter;
}
