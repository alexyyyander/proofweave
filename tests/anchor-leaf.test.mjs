// tests/anchor-leaf.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  anchorLeafHash,
  anchorLeafProtocolVersion,
  normalizeAnchorLeaf,
} from "../packages/protocol/anchor-leaf.mjs";

const leaf = {
  protocolVersion: anchorLeafProtocolVersion,
  recordType: "contribution_receipt",
  recordId: "receipt:alice-1",
  recordHash: `sha256:${"a".repeat(64)}`,
};

test("normalizes, whitelists, and freezes anchor leaves", () => {
  const normalized = normalizeAnchorLeaf(leaf);
  assert.deepEqual(normalized, leaf);
  assert.throws(() => normalizeAnchorLeaf({ ...leaf, extra: 1 }), /unsupported field extra/);
  assert.throws(() => normalizeAnchorLeaf({ ...leaf, protocolVersion: "pw-anchor-leaf-v0" }), /protocolVersion/);
  assert.throws(() => normalizeAnchorLeaf({ ...leaf, recordType: "other" }), /recordType/);
  assert.throws(() => normalizeAnchorLeaf({ ...leaf, recordHash: "sha256:zz" }), /recordHash/);
});

test("anchorLeafHash is deterministic and domain separated", async () => {
  const a = await anchorLeafHash(leaf);
  const b = await anchorLeafHash({ ...leaf });
  assert.equal(a, b);
  assert.match(a, /^sha256:[a-f0-9]{64}$/);
  const otherType = await anchorLeafHash({ ...leaf, recordType: "evidence_bundle" });
  assert.notEqual(a, otherType);
});
