import assert from "node:assert/strict";
import test from "node:test";
import { TronWeb, Trx, providers, utils } from "tronweb";
import { createTronAnchorAdapter } from "../services/anchoring/tron-anchor-adapter.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
import { encodeAnchorCalldata } from "../services/anchoring/evm-anchor-adapter.mjs";

const privateKey = "1".padStart(64, "0");
const owner = TronWeb.address.fromPrivateKey(privateKey);
const sink = TronWeb.address.fromPrivateKey("2".padStart(64, "0"));
const config = { network: "nile", rpcUrl: "https://nile.trongrid.io", operatorAddress: owner, sinkAddress: sink };
const jwk = { kty: "EC", crv: "secp256k1", d: Buffer.from(privateKey, "hex").toString("base64url") };
const txId = "a".repeat(64);
const txRef = `tron:nile:${txId}`;
const payload = { root: `sha256:${"1".repeat(64)}`, manifestHash: `sha256:${"2".repeat(64)}`, leafCount: 2, prevRoot: null };
const transaction = () => ({ txID: txId, raw_data: { data: encodeAnchorCalldata(payload).slice(2), contract: [{ type: "TransferContract", parameter: { value: { owner_address: TronWeb.address.toHex(owner) } } }] }, ret: [{ contractRet: "SUCCESS" }] });
function rpc(t, overrides = {}) {
  const responses = { "wallet/gettransactionbyid": transaction(), "walletsolidity/gettransactionbyid": transaction(), "walletsolidity/gettransactioninfobyid": { id: txId, blockNumber: 100, receipt: {} }, "wallet/getnowblock": { block_header: { raw_data: { number: 111 } } }, ...overrides };
  return t.mock.method(providers.HttpProvider.prototype, "request", async (path) => {
    if (!(path in responses)) throw new Error(`Unexpected RPC ${path}`);
    if (responses[path] instanceof Error) throw responses[path];
    return responses[path];
  });
}

test("TRON reads canonical memo and solidified success without a private key", async (t) => {
  rpc(t);
  const adapter = await createTronAnchorAdapter(config);
  assert.deepEqual(await adapter.readAnchoredRoot({ txRef }), { ...payload, sender: owner });
  assert.deepEqual(await adapter.getConfirmation({ txRef }), { status: "confirmed", confirmations: 12, blockRef: 100 });
  await assert.rejects(() => adapter.submitRoot(payload), /read-only/);
});

test("full-node visibility alone cannot satisfy TRON solidification", async (t) => {
  rpc(t, { "walletsolidity/gettransactioninfobyid": {} });
  const adapter = await createTronAnchorAdapter(config);
  assert.ok(await adapter.readAnchoredRoot({ txRef }));
  assert.deepEqual(await adapter.getConfirmation({ txRef }), { status: "pending", confirmations: 0, blockRef: null });
});

test("TRON confirmed receipts still respect configured block depth", async (t) => {
  rpc(t);
  const adapter = await createTronAnchorAdapter({ ...config, confirmationThreshold: 13 });
  assert.equal((await adapter.getConfirmation({ txRef })).status, "pending");
});

test("TRON failed execution is never reported confirmed", async (t) => {
  rpc(t, { "walletsolidity/gettransactionbyid": { ...transaction(), ret: [{ contractRet: "REVERT" }] } });
  const adapter = await createTronAnchorAdapter(config);
  assert.equal((await adapter.getConfirmation({ txRef })).status, "failed");
});

test("TRON RPC failures propagate instead of becoming pending or verified", async (t) => {
  rpc(t, { "walletsolidity/gettransactioninfobyid": new Error("offline") });
  const adapter = await createTronAnchorAdapter(config);
  await assert.rejects(() => adapter.getConfirmation({ txRef }), /offline/);
});

test("TRON malformed memo and mismatched transaction IDs fail closed", async (t) => {
  rpc(t, { "wallet/gettransactionbyid": { ...transaction(), raw_data: { ...transaction().raw_data, data: "abcd" } }, "walletsolidity/gettransactioninfobyid": { id: "b".repeat(64), blockNumber: 100 } });
  const adapter = await createTronAnchorAdapter(config);
  assert.equal(await adapter.readAnchoredRoot({ txRef }), null);
  await assert.rejects(() => adapter.getConfirmation({ txRef }), /receipt/);
  await assert.rejects(() => adapter.readAnchoredRoot({ txRef: txRef.replace("nile", "shasta") }), /network/);
});

test("TRON builds and signs one-SUN memo locally and checks broadcast acceptance", async (t) => {
  t.mock.method(Trx.prototype, "getCurrentRefBlockParams", async () => ({ ref_block_bytes: "1234", ref_block_hash: "12".repeat(8), timestamp: Date.now(), expiration: Date.now() + 60000 }));
  let accepted = true;
  t.mock.method(providers.HttpProvider.prototype, "request", async (path, signed) => {
    if (path === "wallet/gettransactionbyid") return {};
    assert.equal(path, "wallet/broadcasttransaction");
    assert.equal(signed.raw_data.data, encodeAnchorCalldata(payload).slice(2));
    assert.equal(signed.raw_data.contract.length, 1);
    assert.deepEqual(signed.raw_data.contract[0].parameter.value, { owner_address: TronWeb.address.toHex(owner), to_address: TronWeb.address.toHex(sink), amount: 1 });
    assert.equal(TronWeb.address.fromHex(utils.crypto.ecRecover(signed.txID, signed.signature[0])), owner);
    return accepted ? { result: true, txid: signed.txID } : { result: false, code: "BANDWIDTH_ERROR" };
  });
  const adapter = await createTronAnchorAdapter({ ...config, operatorPrivateKeyJwk: jwk });
  assert.match((await adapter.submitRoot(payload)).txRef, /^tron:nile:[a-f0-9]{64}$/);
  accepted = false;
  await assert.rejects(() => adapter.submitRoot(payload), /not accepted.*BANDWIDTH_ERROR/);
});

test("TRON rejects mismatched operator identity and invalid configuration", async () => {
  await assert.rejects(() => createTronAnchorAdapter({ ...config, operatorPrivateKeyJwk: jwk, operatorAddress: sink }), /does not match/);
  await assert.rejects(() => createTronAnchorAdapter({ ...config, operatorPrivateKeyJwk: { ...jwk, d: "bad" } }), /JWK/);
  await assert.rejects(() => createTronAnchorAdapter({ ...config, confirmationThreshold: 0 }), /positive integer/);
  await assert.rejects(() => createTronAnchorAdapter({ ...config, network: "unknown" }), /network/);
});

function preparedRpc(t) {
  t.mock.method(Trx.prototype, "getCurrentRefBlockParams", async () => ({
    ref_block_bytes: "1234", ref_block_hash: "12".repeat(8), timestamp: Date.now(), expiration: Date.now() + 60000,
  }));
  const chain = new Map();
  const attempts = [];
  const state = { loseResponse: false, reject: false };
  t.mock.method(providers.HttpProvider.prototype, "request", async (path, args) => {
    if (path === "wallet/gettransactionbyid") return chain.get(args.value) ?? {};
    assert.equal(path, "wallet/broadcasttransaction");
    attempts.push(structuredClone(args));
    if (state.reject) return { result: false, code: "BANDWIDTH_ERROR" };
    chain.set(args.txID, structuredClone(args));
    if (state.loseResponse) throw new Error("response lost");
    return { result: true, txid: args.txID };
  });
  return { chain, attempts, state };
}

test("TRON reconciles lost broadcast response and restarts without re-signing", async t => {
  const f = preparedRpc(t);
  const writer = await createTronAnchorAdapter({ ...config, operatorPrivateKeyJwk: jwk });
  const prepared = JSON.parse(canonicalJson(await writer.prepareRoot(payload)));
  assert.equal(f.attempts.length, 0);
  f.state.loseResponse = true;
  assert.deepEqual(await writer.broadcastPreparedRoot(prepared, payload), { txRef: prepared.txRef });
  const reader = await createTronAnchorAdapter(config);
  assert.deepEqual(await reader.broadcastPreparedRoot(prepared, payload), { txRef: prepared.txRef });
  assert.equal(f.attempts.length, 1);
});

test("TRON retries rejected broadcasts using identical signed bytes", async t => {
  const f = preparedRpc(t);
  const adapter = await createTronAnchorAdapter({ ...config, operatorPrivateKeyJwk: jwk });
  const prepared = await adapter.prepareRoot(payload);
  f.state.reject = true;
  await assert.rejects(() => adapter.broadcastPreparedRoot(prepared, payload), /BANDWIDTH_ERROR/);
  f.state.reject = false;
  await adapter.broadcastPreparedRoot(JSON.parse(JSON.stringify(prepared)), payload);
  assert.equal(f.attempts.length, 2);
  assert.deepEqual(f.attempts[0], f.attempts[1]);
});

test("expired unknown TRON transaction stops; an already accepted expired transaction reconciles", async t => {
  const f = preparedRpc(t);
  const adapter = await createTronAnchorAdapter({ ...config, operatorPrivateKeyJwk: jwk });
  const prepared = await adapter.prepareRoot(payload);
  t.mock.method(Date, "now", () => prepared.signedTransaction.raw_data.expiration + 1);
  await assert.rejects(() => adapter.broadcastPreparedRoot(prepared, payload), /expired.*manual reconciliation/);
  assert.equal(f.attempts.length, 0);
  f.chain.set(prepared.signedTransaction.txID, prepared.signedTransaction);
  assert.equal((await adapter.broadcastPreparedRoot(prepared, payload)).txRef, prepared.txRef);
  assert.equal(f.attempts.length, 0);
});

test("TRON rejects corrupted outbox bytes, wrong payload and mismatched destination before broadcast", async t => {
  const f = preparedRpc(t);
  const adapter = await createTronAnchorAdapter({ ...config, operatorPrivateKeyJwk: jwk });
  const prepared = await adapter.prepareRoot(payload);
  const corrupt = structuredClone(prepared);
  corrupt.signedTransaction.raw_data.contract[0].parameter.value.amount = 2;
  await assert.rejects(() => adapter.broadcastPreparedRoot(corrupt, payload), /does not match/);
  await assert.rejects(() => adapter.broadcastPreparedRoot(prepared, { ...payload, leafCount: 3 }), /does not match/);
  const moved = await createTronAnchorAdapter({ ...config, sinkAddress: owner });
  await assert.rejects(() => moved.broadcastPreparedRoot(prepared, payload), /does not match/);
  assert.equal(f.attempts.length, 0);
});
