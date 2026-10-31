// tests/anchor-chain-adapter.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { parseChainSpecifier, parseTxRef, resolveAdapter } from "../services/anchoring/anchor-chain-adapter.mjs";
import { createMockAnchorAdapter } from "../services/anchoring/mock-anchor-adapter.mjs";

test("chain/tx specifiers parse and reject malformed input", () => {
  assert.deepEqual(parseChainSpecifier("evm:base-sepolia"), { chain: "evm", network: "base-sepolia" });
  assert.deepEqual(parseTxRef("evm:base-sepolia:0xabc"), { chain: "evm", network: "base-sepolia", txId: "0xabc" });
  assert.throws(() => parseTxRef("garbage"), /txRef/);
  assert.throws(() => parseChainSpecifier("only-chain"), /chain specifier/);
});

test("mock adapter submits, confirms, and reads back anchored root", async () => {
  const adapter = createMockAnchorAdapter({ network: "local", operatorAddress: "mock:operator" });
  const submitted = await adapter.submitRoot({
    root: `sha256:${"1".repeat(64)}`, manifestHash: `sha256:${"2".repeat(64)}`,
    leafCount: 3, prevRoot: null, batchId: "anchor-batch:b1",
  });
  assert.match(submitted.txRef, /^mock:local:tx-/);
  const confirmation = await adapter.getConfirmation({ txRef: submitted.txRef });
  assert.equal(confirmation.status, "confirmed");
  const read = await adapter.readAnchoredRoot({ txRef: submitted.txRef });
  assert.equal(read.root, `sha256:${"1".repeat(64)}`);
  assert.equal(read.sender, "mock:operator");
  assert.equal(await adapter.readAnchoredRoot({ txRef: "mock:local:missing" }), null);
});

test("resolveAdapter matches chain+network and throws when absent", () => {
  const adapter = createMockAnchorAdapter({ network: "local", operatorAddress: "mock:operator" });
  const registry = new Map([["mock:local", adapter]]);
  assert.equal(resolveAdapter({ registry, chain: "mock", network: "local" }), adapter);
  assert.throws(() => resolveAdapter({ registry, chain: "solana", network: "mainnet" }), /No anchor adapter/);
});
