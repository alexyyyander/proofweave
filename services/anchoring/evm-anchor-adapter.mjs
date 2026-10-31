// services/anchoring/evm-anchor-adapter.mjs

export class EvmAnchorAdapterError extends Error {
  constructor(message) { super(message); this.name = "EvmAnchorAdapterError"; }
}

/** Encoding: bytes32 root | bytes32 manifestHash | uint256 leafCount | bytes32 prevRoot (null → 32 zero bytes). */
export function encodeAnchorCalldata({ root, manifestHash, leafCount, prevRoot }) {
  return "0x" + [
    sha256ToBytes32(root), sha256ToBytes32(manifestHash),
    BigInt(leafCount).toString(16).padStart(64, "0"),
    prevRoot ? sha256ToBytes32(prevRoot) : "0".repeat(64),
  ].join("");
}

export function decodeAnchorCalldata(data) {
  const hex = String(data ?? "");
  if (!/^0x([0-9a-f]{256})$/.test(hex)) throw new EvmAnchorAdapterError("Anchor calldata must be exactly 256 hex chars (4 x 32 bytes).");
  const body = hex.slice(2);
  const word = (i) => body.slice(i * 64, (i + 1) * 64);
  const fromBytes32 = (wordHex) => `sha256:${wordHex}`;
  return {
    root: fromBytes32(word(0)),
    manifestHash: fromBytes32(word(1)),
    leafCount: Number(BigInt(`0x${word(2)}`)),
    prevRoot: /^0+$/.test(word(3)) ? null : fromBytes32(word(3)),
  };
}

function sha256ToBytes32(value) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new EvmAnchorAdapterError(`${value} must be sha256:<hex>.`);
  }
  return value.slice(7);
}

/** Network side (submitRoot/getConfirmation/readAnchoredRoot) dynamically imports ethers v6 to keep protocol layers/tests dependency-free. */
export async function createEvmAnchorAdapter({ network, rpcUrl, sinkAddress, operatorPrivateKeyJwk, operatorAddress: configuredOperatorAddress, confirmationThreshold = 12 }) {
  const { Wallet, JsonRpcProvider, getAddress, Transaction, keccak256 } = await import("ethers");
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = operatorPrivateKeyJwk ? new Wallet(privateKeyHexFromJwk(operatorPrivateKeyJwk), provider) : null;
  const publicOperator = configuredOperatorAddress ? getAddress(configuredOperatorAddress).toLowerCase() : null;
  const operatorAddress = wallet ? (await wallet.getAddress()).toLowerCase() : publicOperator;
  if (wallet && publicOperator && publicOperator !== operatorAddress) {
    throw new EvmAnchorAdapterError("Configured operatorAddress does not match the signing key.");
  }
  const adapter = {
    id: "evm",
    network,
    operatorAddress,
    async prepareRoot(payload) {
      if (!wallet) throw new EvmAnchorAdapterError("Submitting an anchor requires operatorPrivateKeyJwk; this adapter is read-only.");
      if (!sinkAddress) throw new EvmAnchorAdapterError("Submitting an anchor requires sinkAddress.");
      const transaction = await wallet.populateTransaction({ to: sinkAddress, value: 0n, data: encodeAnchorCalldata(payload) });
      const signedTransaction = await wallet.signTransaction(transaction);
      return { txRef: `evm:${network}:${keccak256(signedTransaction)}`, signedTransaction };
    },
    async broadcastPreparedRoot(prepared, payload) {
      const { txId } = splitTxRef(prepared.txRef, network);
      const tx = Transaction.from(prepared.signedTransaction);
      if (!tx.isSigned() || tx.hash !== txId || tx.from?.toLowerCase() !== operatorAddress
        || !sinkAddress || tx.to?.toLowerCase() !== sinkAddress.toLowerCase()
        || tx.value !== 0n || tx.data !== encodeAnchorCalldata(payload)
        || tx.chainId !== (await provider.getNetwork()).chainId) {
        throw new EvmAnchorAdapterError("Prepared EVM transaction does not match the anchor or operator configuration.");
      }
      async function alreadyBroadcast() {
        const found = await provider.getTransaction(txId);
        if (!found) return false;
        if (found.hash !== txId || found.data !== tx.data || found.from?.toLowerCase() !== operatorAddress
          || found.to?.toLowerCase() !== tx.to.toLowerCase() || found.nonce !== tx.nonce
          || found.chainId !== tx.chainId || found.value !== tx.value) {
          throw new EvmAnchorAdapterError("EVM lookup returned inconsistent transaction fields.");
        }
        return true;
      }
      // An accepted transaction may have lost its HTTP response or DB projection.
      if (await alreadyBroadcast()) return { txRef: prepared.txRef };
      try {
        const sent = await provider.broadcastTransaction(prepared.signedTransaction);
        if (sent.hash !== txId) throw new EvmAnchorAdapterError("EVM broadcast transaction hash mismatch.");
      } catch (error) {
        if (!await alreadyBroadcast()) throw error;
      }
      return { txRef: prepared.txRef };
    },
    // Convenience for callers that explicitly manage their own persistence/retries.
    async submitRoot(payload) {
      return adapter.broadcastPreparedRoot(await adapter.prepareRoot(payload), payload);
    },
    async getConfirmation({ txRef }) {
      const { txId } = splitTxRef(txRef, network);
      const receipt = await provider.getTransactionReceipt(txId);
      if (!receipt) return { status: "pending", confirmations: 0, blockRef: null };
      const head = await provider.getBlockNumber();
      const confirmations = head - receipt.blockNumber + 1;
      if (receipt.status === 0) return { status: "failed", confirmations, blockRef: receipt.blockNumber };
      return {
        status: confirmations >= confirmationThreshold ? "confirmed" : "pending",
        confirmations,
        blockRef: receipt.blockNumber,
      };
    },
    async readAnchoredRoot({ txRef }) {
      const { txId } = splitTxRef(txRef, network);
      const tx = await provider.getTransaction(txId);
      if (!tx) return null;
      try {
        return { ...decodeAnchorCalldata(tx.data), sender: (tx.from ?? "").toLowerCase() };
      } catch {
        return null; // tx exists but its calldata is not anchor format
      }
    },
  };
  return adapter;
}

function splitTxRef(txRef, expectedNetwork) {
  const parts = String(txRef ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "evm") throw new EvmAnchorAdapterError(`txRef ${txRef} is not an evm anchor txRef.`);
  if (parts[1] !== expectedNetwork) throw new EvmAnchorAdapterError("txRef network does not match this EVM adapter.");
  return { network: parts[1], txId: parts[2] };
}

function privateKeyHexFromJwk(jwk) {
  // secp256k1 JWK d (base64url 32 bytes) → 0x-hex for ethers Wallet.
  const der = atob(String(jwk?.d ?? "").replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(der, (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new EvmAnchorAdapterError("operatorPrivateKeyJwk.d must decode to 32 bytes.");
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
