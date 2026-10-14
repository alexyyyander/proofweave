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
export async function createEvmAnchorAdapter({ network, rpcUrl, sinkAddress, operatorPrivateKeyJwk, confirmationThreshold = 12 }) {
  const { Wallet, JsonRpcProvider } = await import("ethers");
  const operatorPrivateKey = privateKeyHexFromJwk(operatorPrivateKeyJwk);
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(operatorPrivateKey, provider);
  const operatorAddress = (await wallet.getAddress()).toLowerCase();
  return {
    id: "evm",
    network,
    operatorAddress,
    async submitRoot({ root, manifestHash, leafCount, prevRoot, batchId }) {
      const tx = await wallet.sendTransaction({ to: sinkAddress, data: encodeAnchorCalldata({ root, manifestHash, leafCount, prevRoot }) });
      void batchId; // not anchored on-chain; log correlation only
      return { txRef: `evm:${network}:${tx.hash}` };
    },
    async getConfirmation({ txRef }) {
      const { txId } = splitTxRef(txRef);
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
      const { txId } = splitTxRef(txRef);
      const tx = await provider.getTransaction(txId);
      if (!tx) return null;
      try {
        return { ...decodeAnchorCalldata(tx.data), sender: (tx.from ?? "").toLowerCase() };
      } catch {
        return null; // tx exists but its calldata is not anchor format
      }
    },
  };
}

function splitTxRef(txRef) {
  const parts = String(txRef ?? "").split(":");
  if (parts.length !== 3 || parts[0] !== "evm") throw new EvmAnchorAdapterError(`txRef ${txRef} is not an evm anchor txRef.`);
  return { network: parts[1], txId: parts[2] };
}

function privateKeyHexFromJwk(jwk) {
  // secp256k1 JWK d (base64url 32 bytes) → 0x-hex for ethers Wallet.
  const der = atob(String(jwk?.d ?? "").replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(der, (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new EvmAnchorAdapterError("operatorPrivateKeyJwk.d must decode to 32 bytes.");
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
