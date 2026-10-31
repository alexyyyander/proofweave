// tests/evm-anchor-adapter.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createEvmAnchorAdapter, decodeAnchorCalldata, encodeAnchorCalldata } from "../services/anchoring/evm-anchor-adapter.mjs";
import { JsonRpcProvider, Wallet, Transaction } from "ethers";
import { createSolanaAnchorAdapter } from "../services/anchoring/solana-anchor-adapter.mjs";

const root = `sha256:${"1".repeat(64)}`;
const manifestHash = `sha256:${"2".repeat(64)}`;

test("anchor calldata round-trips four fields deterministically", () => {
  const data = encodeAnchorCalldata({ root, manifestHash, leafCount: 7, prevRoot: null });
  const decoded = decodeAnchorCalldata(data);
  assert.deepEqual(decoded, { root, manifestHash, leafCount: 7, prevRoot: null });
  const withPrev = decodeAnchorCalldata(encodeAnchorCalldata({ root, manifestHash, leafCount: 7, prevRoot: `sha256:${"3".repeat(64)}` }));
  assert.equal(withPrev.prevRoot, `sha256:${"3".repeat(64)}`);
  assert.throws(() => decodeAnchorCalldata("0x1234"), /calldata/);
});

test("solana adapter remains an explicit stub", async () => {
  const solana = await createSolanaAnchorAdapter({});
  await assert.rejects(() => solana.submitRoot({}), /not implemented/);
});

test("public EVM configuration reads and confirms transactions without a signing key", async (t) => {
  const data = encodeAnchorCalldata({ root, manifestHash, leafCount: 7, prevRoot: null });
  let reads = 0;
  t.mock.method(JsonRpcProvider.prototype, "getTransaction", async () => { reads++; return { data, from: "0x0000000000000000000000000000000000000001" }; });
  t.mock.method(JsonRpcProvider.prototype, "getTransactionReceipt", async () => ({ blockNumber: 100, status: 1 }));
  t.mock.method(JsonRpcProvider.prototype, "getBlockNumber", async () => 102);
  const send = t.mock.method(Wallet.prototype, "sendTransaction", async () => { throw new Error("must never sign"); });
  const adapter = await createEvmAnchorAdapter({ network: "base-sepolia", rpcUrl: "http://127.0.0.1:1", confirmationThreshold: 2 });
  const txRef = `evm:base-sepolia:0x${"a".repeat(64)}`;
  assert.equal((await adapter.readAnchoredRoot({ txRef })).root, root);
  assert.deepEqual(await adapter.getConfirmation({ txRef }), { status: "confirmed", confirmations: 3, blockRef: 100 });
  assert.equal(adapter.operatorAddress, null);
  await assert.rejects(() => adapter.submitRoot({ root, manifestHash, leafCount: 7, prevRoot: null }), /read-only/);
  await assert.rejects(() => adapter.readAnchoredRoot({ txRef: txRef.replace("base-sepolia", "other") }), /network/);
  assert.equal(reads, 1);
  assert.equal(send.mock.callCount(), 0);
});

test("signing adapter retains transaction submission and rejects mismatched public operator identity", async (t) => {
  const privateKey = `0x${"1".padStart(64, "0")}`;
  const wallet = new Wallet(privateKey);
  const operatorPrivateKeyJwk = { kty: "EC", crv: "secp256k1", d: Buffer.from(privateKey.slice(2), "hex").toString("base64url") };
  t.mock.method(Wallet.prototype, "populateTransaction", async tx => ({...tx, chainId:84532n, nonce:0, gasLimit:30000n, gasPrice:1n, type:0}));
  t.mock.method(JsonRpcProvider.prototype, "getNetwork", async () => ({chainId:84532n}));
  t.mock.method(JsonRpcProvider.prototype, "getTransaction", async () => null);
  const send = t.mock.method(JsonRpcProvider.prototype, "broadcastTransaction", async raw => ({ hash: Transaction.from(raw).hash }));
  const config = { network: "base-sepolia", rpcUrl: "http://127.0.0.1:1", sinkAddress: "0x000000000000000000000000000000000000dEaD", operatorPrivateKeyJwk };
  const adapter = await createEvmAnchorAdapter(config);
  assert.equal(adapter.operatorAddress, wallet.address.toLowerCase());
  assert.match((await adapter.submitRoot({ root, manifestHash, leafCount: 7, prevRoot: null })).txRef, /^evm:base-sepolia:/);
  const tx = Transaction.from(send.mock.calls[0].arguments[0]);
  assert.equal(tx.to, config.sinkAddress);
  assert.equal(tx.data, encodeAnchorCalldata({ root, manifestHash, leafCount:7, prevRoot:null }));
  assert.equal(tx.from, wallet.address);
  await assert.rejects(() => createEvmAnchorAdapter({ ...config, operatorAddress: "0x0000000000000000000000000000000000000002" }), /does not match/);
  const reader = await createEvmAnchorAdapter({ network: config.network, rpcUrl: config.rpcUrl, operatorAddress: wallet.address });
  assert.equal(reader.operatorAddress, wallet.address.toLowerCase());
});

async function preparedEvm(t) {
  const wallet = new Wallet(`0x${"1".padStart(64, "0")}`);
  const config = { network: "base-sepolia", rpcUrl: "http://127.0.0.1:1",
    sinkAddress: "0x000000000000000000000000000000000000dEaD", operatorAddress: wallet.address,
    operatorPrivateKeyJwk: { d: Buffer.from(wallet.privateKey.slice(2), "hex").toString("base64url") } };
  const chain = new Map(); const attempts = []; const state = { loseResponse: false, reject: false, chainId: 84532n };
  t.mock.method(Wallet.prototype, "populateTransaction", async tx => ({ ...tx, chainId:84532n, nonce:9, gasLimit:30000n, gasPrice:1n, type:0 }));
  t.mock.method(JsonRpcProvider.prototype, "getNetwork", async () => ({ chainId:state.chainId }));
  t.mock.method(JsonRpcProvider.prototype, "getTransaction", async hash => chain.get(hash) ?? null);
  t.mock.method(JsonRpcProvider.prototype, "broadcastTransaction", async raw => {
    attempts.push(raw); if (state.reject) throw new Error("nonce already consumed");
    const tx = Transaction.from(raw); chain.set(tx.hash, tx);
    if (state.loseResponse) throw new Error("response lost");
    return { hash:tx.hash };
  });
  const adapter = await createEvmAnchorAdapter(config);
  const payload = { root, manifestHash, leafCount:7, prevRoot:null };
  const prepared = await adapter.prepareRoot(payload);
  return { config, chain, attempts, state, adapter, payload, prepared };
}

test("EVM lost response and restart reconcile a persisted transaction without a signing key", async t => {
  const f = await preparedEvm(t); assert.equal(f.attempts.length, 0);
  f.state.loseResponse = true;
  await f.adapter.broadcastPreparedRoot(f.prepared, f.payload);
  const reader = await createEvmAnchorAdapter({ ...f.config, operatorPrivateKeyJwk: undefined });
  assert.equal((await reader.broadcastPreparedRoot(JSON.parse(JSON.stringify(f.prepared)), f.payload)).txRef, f.prepared.txRef);
  assert.equal(f.attempts.length, 1);
});

test("EVM rejection cannot allocate a replacement nonce on retry", async t => {
  const f = await preparedEvm(t); f.state.reject = true;
  await assert.rejects(() => f.adapter.broadcastPreparedRoot(f.prepared, f.payload), /nonce already consumed/);
  await assert.rejects(() => f.adapter.broadcastPreparedRoot(f.prepared, f.payload), /nonce already consumed/);
  assert.equal(f.attempts.length, 2); assert.equal(f.attempts[0], f.attempts[1]);
  assert.equal(Transaction.from(f.attempts[1]).nonce, 9);
});

test("EVM wrong transaction reference, anchor payload or RPC chain fail before broadcast", async t => {
  const f = await preparedEvm(t);
  await assert.rejects(() => f.adapter.broadcastPreparedRoot({ ...f.prepared, txRef:`evm:base-sepolia:0x${"a".repeat(64)}` }, f.payload), /does not match/);
  await assert.rejects(() => f.adapter.broadcastPreparedRoot(f.prepared, { ...f.payload, leafCount:8 }), /does not match/);
  f.state.chainId = 1n;
  await assert.rejects(() => f.adapter.broadcastPreparedRoot(f.prepared, f.payload), /does not match/);
  assert.equal(f.attempts.length, 0);
});

test("EVM lookup must match the persisted signed transaction", async t => {
  const f = await preparedEvm(t);
  const hash = f.prepared.txRef.split(":")[2];
  f.chain.set(hash, { hash, data: "0x" });
  await assert.rejects(() => f.adapter.broadcastPreparedRoot(f.prepared, f.payload), /inconsistent transaction/);
  assert.equal(f.attempts.length, 0);
});
