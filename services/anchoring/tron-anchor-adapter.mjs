import { encodeAnchorCalldata, decodeAnchorCalldata } from "./evm-anchor-adapter.mjs";

export class TronAnchorAdapterError extends Error {
  constructor(message) { super(message); this.name = "TronAnchorAdapterError"; }
}

/** A 1 SUN transfer carries the same 128-byte payload as EVM in raw_data.data.
 * Signing is local. Confirmation requires a solidified receipt AND successful
 * solidified transaction, independently of the configured block depth.
 */
export async function createTronAnchorAdapter({ network, rpcUrl, sinkAddress, operatorPrivateKeyJwk, operatorAddress: configuredAddress, confirmationThreshold = 12 } = {}) {
  if (!["nile", "shasta", "mainnet"].includes(network) || !rpcUrl) {
    throw new TronAnchorAdapterError("TRON requires network (nile, shasta, mainnet) and rpcUrl.");
  }
  if (!Number.isSafeInteger(confirmationThreshold) || confirmationThreshold < 1) {
    throw new TronAnchorAdapterError("confirmationThreshold must be a positive integer.");
  }
  const { TronWeb, utils } = await import("tronweb");
  const tron = new TronWeb({ fullHost: rpcUrl });
  const normalizeAddress = (value) => {
    if (!TronWeb.isAddress(value)) throw new TronAnchorAdapterError("Invalid TRON address.");
    return TronWeb.address.fromHex(TronWeb.address.toHex(value));
  };
  let privateKey;
  if (operatorPrivateKeyJwk) {
    const jwk = operatorPrivateKeyJwk;
    if (jwk.kty !== "EC" || jwk.crv !== "secp256k1" || !/^[A-Za-z0-9_-]{43}$/.test(jwk.d ?? "")) {
      throw new TronAnchorAdapterError("TRON signing requires a secp256k1 private JWK.");
    }
    privateKey = Buffer.from(jwk.d, "base64url").toString("hex");
    if (privateKey.length !== 64 || !TronWeb.address.fromPrivateKey(privateKey)) {
      throw new TronAnchorAdapterError("Invalid TRON signing key.");
    }
  }
  const operatorAddress = privateKey ? TronWeb.address.fromPrivateKey(privateKey) : configuredAddress ? normalizeAddress(configuredAddress) : null;
  if (privateKey && configuredAddress && normalizeAddress(configuredAddress) !== operatorAddress) {
    throw new TronAnchorAdapterError("Configured operatorAddress does not match the signing key.");
  }
  const sink = sinkAddress ? normalizeAddress(sinkAddress) : null;
  async function request(node, path, args = {}) {
    const result = await node.request(path, args, "post");
    if (!result || typeof result !== "object" || result.Error || result.error) {
      throw new TronAnchorAdapterError(`TRON RPC rejected ${path}.`);
    }
    return result;
  }
  function txIdOf(txRef) {
    const parts = String(txRef ?? "").split(":");
    if (parts.length !== 3 || parts[0] !== "tron" || parts[1] !== network || !/^[a-f0-9]{64}$/.test(parts[2])) {
      throw new TronAnchorAdapterError("txRef must match this TRON network and contain a 32-byte hex transaction ID.");
    }
    return parts[2];
  }
  function validatePrepared(prepared, payload) {
    const txId = txIdOf(prepared.txRef);
    const signed = prepared.signedTransaction;
    const contracts = signed?.raw_data?.contract;
    const value = contracts?.[0]?.parameter?.value;
    if (signed?.txID !== txId || !utils.transaction.txCheck(signed)
      || contracts?.length !== 1 || contracts[0].type !== "TransferContract"
      || contracts[0].Permission_id || value?.amount !== 1
      || normalizeAddress(value.owner_address) !== operatorAddress
      || !sink || normalizeAddress(value.to_address) !== sink
      || signed.raw_data.data !== encodeAnchorCalldata(payload).slice(2)
      || signed.signature?.length !== 1
      || normalizeAddress(utils.crypto.ecRecover(txId, signed.signature[0])) !== operatorAddress) {
      throw new TronAnchorAdapterError("Prepared TRON transaction does not match the anchor or operator configuration.");
    }
    return signed;
  }
  async function alreadyBroadcast(signed) {
    const tx = await request(tron.fullNode, "wallet/gettransactionbyid", { value: signed.txID });
    if (!tx.txID) return false;
    if (tx.txID !== signed.txID || !utils.transaction.txCheck(tx) || tx.raw_data_hex !== signed.raw_data_hex) {
      throw new TronAnchorAdapterError("TRON lookup returned inconsistent transaction bytes.");
    }
    return true;
  }
  const adapter = {
    id: "tron", network, operatorAddress,
    async prepareRoot(payload) {
      if (!privateKey) throw new TronAnchorAdapterError("Submitting an anchor requires operatorPrivateKeyJwk; this adapter is read-only.");
      if (!sink) throw new TronAnchorAdapterError("Submitting an anchor requires sinkAddress.");
      const data = encodeAnchorCalldata(payload).slice(2);
      const transfer = await tron.transactionBuilder.sendTrx(sink, 1, operatorAddress);
      const unsigned = await tron.transactionBuilder.addUpdateData(transfer, data, "hex", { txLocal: true });
      // TronWeb leaves optional undefined fields; persist precisely its JSON wire form.
      const signed = JSON.parse(JSON.stringify(await tron.trx.sign(unsigned, privateKey)));
      const prepared = { txRef: `tron:${network}:${signed.txID}`, signedTransaction: signed };
      validatePrepared(prepared, payload);
      return prepared;
    },
    async broadcastPreparedRoot(prepared, payload) {
      const signed = validatePrepared(prepared, payload);
      if (await alreadyBroadcast(signed)) return { txRef: prepared.txRef };
      if (!Number.isSafeInteger(signed.raw_data.expiration) || signed.raw_data.expiration <= Date.now()) {
        throw new TronAnchorAdapterError(`Prepared TRON transaction ${signed.txID} expired; manual reconciliation required, no replacement was signed.`);
      }
      try {
        const result = await tron.trx.sendRawTransaction(signed);
        if (result.result !== true || (result.txid && result.txid !== signed.txID)) {
          throw new TronAnchorAdapterError(`TRON broadcast was not accepted (${result.code ?? "unknown"}); inspect transaction ${signed.txID} before retrying.`);
        }
      } catch (error) {
        // DUP_TRANSACTION_ERROR alone is not proof of acceptance: look up the bytes.
        if (!await alreadyBroadcast(signed)) throw error;
      }
      return { txRef: prepared.txRef };
    },
    async submitRoot(payload) {
      return adapter.broadcastPreparedRoot(await adapter.prepareRoot(payload), payload);
    },
    async readAnchoredRoot({ txRef }) {
      const txId = txIdOf(txRef);
      const tx = await request(tron.fullNode, "wallet/gettransactionbyid", { value: txId });
      const contracts = tx.raw_data?.contract;
      if (tx.txID !== txId || contracts?.length !== 1 || contracts[0].type !== "TransferContract") return null;
      try {
        return { ...decodeAnchorCalldata(`0x${tx.raw_data.data}`), sender: normalizeAddress(contracts[0].parameter.value.owner_address) };
      } catch { return null; }
    },
    async getConfirmation({ txRef }) {
      const txId = txIdOf(txRef);
      const pending = { status: "pending", confirmations: 0, blockRef: null };
      const info = await request(tron.solidityNode, "walletsolidity/gettransactioninfobyid", { value: txId });
      if (!info.id) return pending;
      if (info.id !== txId || !Number.isSafeInteger(info.blockNumber) || info.blockNumber < 0) {
        throw new TronAnchorAdapterError("Invalid solidified TRON receipt.");
      }
      const tx = await request(tron.solidityNode, "walletsolidity/gettransactionbyid", { value: txId });
      if (!tx.txID) return pending;
      if (tx.txID !== txId) throw new TronAnchorAdapterError("Solidified transaction ID mismatch.");
      const block = await request(tron.fullNode, "wallet/getnowblock");
      const height = block.block_header?.raw_data?.number;
      if (!Number.isSafeInteger(height) || height < info.blockNumber) throw new TronAnchorAdapterError("Invalid TRON block height.");
      const confirmations = height - info.blockNumber + 1;
      const failed = (info.result !== undefined && info.result !== "SUCCESS")
        || (info.receipt?.result !== undefined && info.receipt.result !== "SUCCESS")
        || tx.ret?.some((entry) => entry.contractRet && entry.contractRet !== "SUCCESS");
      const successful = tx.ret?.length === 1 && tx.ret[0].contractRet === "SUCCESS";
      return { status: failed ? "failed" : successful && confirmations >= confirmationThreshold ? "confirmed" : "pending", confirmations, blockRef: info.blockNumber };
    },
  };
  return adapter;
}
