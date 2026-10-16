// tests/evm-anchor-adapter.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createEvmAnchorAdapter, decodeAnchorCalldata, encodeAnchorCalldata } from "../services/anchoring/evm-anchor-adapter.mjs";
import { JsonRpcProvider, Wallet } from "ethers";
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
  const send = t.mock.method(Wallet.prototype, "sendTransaction", async () => ({ hash: `0x${"b".repeat(64)}` }));
  const config = { network: "base-sepolia", rpcUrl: "http://127.0.0.1:1", sinkAddress: "0x000000000000000000000000000000000000dEaD", operatorPrivateKeyJwk };
  const adapter = await createEvmAnchorAdapter(config);
  assert.equal(adapter.operatorAddress, wallet.address.toLowerCase());
  assert.match((await adapter.submitRoot({ root, manifestHash, leafCount: 7, prevRoot: null })).txRef, /^evm:base-sepolia:/);
  assert.deepEqual(send.mock.calls[0].arguments[0], { to: config.sinkAddress, data: encodeAnchorCalldata({ root, manifestHash, leafCount: 7, prevRoot: null }) });
  await assert.rejects(() => createEvmAnchorAdapter({ ...config, operatorAddress: "0x0000000000000000000000000000000000000002" }), /does not match/);
  const reader = await createEvmAnchorAdapter({ network: config.network, rpcUrl: config.rpcUrl, operatorAddress: wallet.address });
  assert.equal(reader.operatorAddress, wallet.address.toLowerCase());
});
