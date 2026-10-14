// services/anchoring/tron-anchor-adapter.mjs
export async function createTronAnchorAdapter() {
  return stubAdapter("tron");
}

function stubAdapter(id) {
  const notImplemented = async () => { throw new Error(`${id} anchor adapter is not implemented yet.`); };
  return { id, network: null, operatorAddress: null, submitRoot: notImplemented, getConfirmation: notImplemented, readAnchoredRoot: notImplemented };
}
