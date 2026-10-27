// services/anchoring/solana-anchor-adapter.mjs
export async function createSolanaAnchorAdapter() {
  return stubAdapter("solana");
}

function stubAdapter(id) {
  const notImplemented = async () => { throw new Error(`${id} anchor adapter is not implemented yet.`); };
  return { id, network: null, operatorAddress: null, submitRoot: notImplemented, getConfirmation: notImplemented, readAnchoredRoot: notImplemented };
}
