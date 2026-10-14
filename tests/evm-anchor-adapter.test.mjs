// tests/evm-anchor-adapter.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { decodeAnchorCalldata, encodeAnchorCalldata } from "../services/anchoring/evm-anchor-adapter.mjs";
import { createSolanaAnchorAdapter } from "../services/anchoring/solana-anchor-adapter.mjs";
import { createTronAnchorAdapter } from "../services/anchoring/tron-anchor-adapter.mjs";

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

test("solana and tron adapters are explicit stubs", async () => {
  const solana = await createSolanaAnchorAdapter({});
  await assert.rejects(() => solana.submitRoot({}), /not implemented/);
  const tron = await createTronAnchorAdapter({});
  await assert.rejects(() => tron.submitRoot({}), /not implemented/);
});
