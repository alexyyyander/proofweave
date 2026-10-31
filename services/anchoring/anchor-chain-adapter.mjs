// services/anchoring/anchor-chain-adapter.mjs

export class AnchorAdapterConfigurationError extends Error {
  constructor(message) { super(message); this.name = "AnchorAdapterConfigurationError"; }
}

export function parseChainSpecifier(specifier) {
  const parts = String(specifier ?? "").split(":");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AnchorAdapterConfigurationError("chain specifier must be <chain>:<network>.");
  }
  return { chain: parts[0], network: parts[1] };
}

export function parseTxRef(txRef) {
  const parts = String(txRef ?? "").split(":");
  if (parts.length !== 3 || !parts.every(Boolean)) {
    throw new AnchorAdapterConfigurationError("txRef must be <chain>:<network>:<txId>.");
  }
  return { chain: parts[0], network: parts[1], txId: parts[2] };
}

export function resolveAdapter({ registry, chain, network }) {
  const adapter = registry?.get(`${chain}:${network}`);
  if (!adapter) throw new AnchorAdapterConfigurationError(`No anchor adapter configured for ${chain}:${network}.`);
  return adapter;
}

/** Build a registry from hosted env JSON (each item {id, network, rpcUrl, sinkAddress, operatorPrivateKeyJwk, confirmationThreshold}). */
export function adapterRegistryFromConfig(configs, factories) {
  const registry = new Map();
  for (const config of configs ?? []) {
    const factory = factories?.[config.id];
    if (!factory) throw new AnchorAdapterConfigurationError(`Unknown anchor adapter id ${config.id}.`);
    registry.set(`${config.id}:${config.network}`, factory(config));
  }
  return registry;
}
