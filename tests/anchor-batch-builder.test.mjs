// tests/anchor-batch-builder.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createAnchorBatchBuilder } from "../services/anchoring/anchor-batch-builder.mjs";
import { anchorLeafHash, anchorLeafProtocolVersion } from "../packages/protocol/anchor-leaf.mjs";

function fakeStoreWith(pending) {
  return {
    async countPendingRecords() { return pending.length; },
    async listPendingRecords() { return pending; },
    async getLogHead() { return { headBatchId: null, headRoot: null, version: 0 }; },
    async createBatch(input) { return { created: true, batch: { id: input.id, ...input } }; },
  };
}

test("builder sorts leaves deterministically and verifies manifest root", async () => {
  const pending = ["b", "a"].map((ch) => ({
    id: `anchor-record:${ch}`, record_type: "contribution_receipt", record_id: `receipt:${ch}`,
    record_hash: `sha256:${ch.repeat(64)}`, leaf_hash: "", created_at: "2026-10-14T00:00:00.000Z",
  }));
  // Row shape matches store return (snake_case); leaf_hash must be genuinely recomputable
  for (const row of pending) {
    row.leaf_hash = await anchorLeafHash({
      protocolVersion: anchorLeafProtocolVersion, recordType: row.record_type, recordId: row.record_id, recordHash: row.record_hash,
    });
  }
  const builder = createAnchorBatchBuilder({ store: fakeStoreWith(pending), chain: "mock", network: "local" });
  const result = await builder.buildNextBatch({ prevBatchId: null, prevRoot: null });
  assert.equal(result.created, true);
  const [first, second] = result.manifest.leaves;
  assert.equal(first.recordId, "receipt:a"); // sorted by (type,id,hash)
  assert.equal(result.tree.root, result.manifest.root);
});

test("builder refuses to create an empty batch", async () => {
  const builder = createAnchorBatchBuilder({ store: fakeStoreWith([]), chain: "mock", network: "local" });
  const result = await builder.buildNextBatch({ prevBatchId: null, prevRoot: null });
  assert.equal(result.created, false);
});
