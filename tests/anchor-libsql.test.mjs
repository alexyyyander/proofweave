import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { D1AnchorStore, anchorBatchMaxLeaves } from "../services/anchoring/d1-anchor-store.mjs";
import { createAnchorIntake } from "../services/anchoring/anchor-intake.mjs";
import { createAnchorBatchBuilder } from "../services/anchoring/anchor-batch-builder.mjs";
import { createAnchorCoordinator } from "../services/anchoring/anchor-coordinator.mjs";
import { createMockAnchorAdapter } from "../services/anchoring/mock-anchor-adapter.mjs";
import { createManifestStorage } from "../services/anchoring/anchor-manifest-storage.mjs";
import { verifyAnchorManifest } from "../packages/protocol/anchor-manifest.mjs";

async function setup(t) {
  const db = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  t.after(() => db.close());
  const sql = await readFile(new URL("../drizzle/0046_add_anchor_tables.sql", import.meta.url), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  const store = new D1AnchorStore(db);
  const intake = createAnchorIntake(store);
  const builder = createAnchorBatchBuilder({ store, chain: "mock", network: "local" });
  const adapter = createMockAnchorAdapter();
  const objects = new Map();
  const storage = createManifestStorage({ bucket: { put: async (k, v) => objects.set(k, v), get: async (k) => objects.get(k) } });
  const coordinator = createAnchorCoordinator({ store, builder, adapter, manifestStorage: storage,
    config: { minLeafCount: 100, maxIntervalSeconds: 86400, confirmationThreshold: 12 }, verifyWitnessAuthority: async () => ({}) });
  const enqueue = (i) => intake.enqueueAnchorRecord({ recordType: "contribution_receipt", recordId: `receipt:${i}`,
    recordHash: `sha256:${i.toString(16).padStart(64, "0")}`, createdAt: new Date().toISOString() });
  return { db, store, builder, adapter, coordinator, enqueue, storage };
}

test("default 100-record trigger commits within libSQL's statement budget and drains without loss", async (t) => {
  const { store, coordinator, enqueue, storage } = await setup(t);
  for (let i = 1; i <= 100; i++) await enqueue(i);
  const first = await coordinator.maybeBuildAndSubmit({});
  assert.equal(first.created, true);
  assert.equal(first.batch.leaf_count, anchorBatchMaxLeaves);
  assert.equal(await store.countPendingRecords(), 100 - anchorBatchMaxLeaves);
  const manifest = JSON.parse(new TextDecoder().decode(await storage.get(first.batch.manifest_key)));
  assert.equal(await verifyAnchorManifest(manifest), true);
  await coordinator.pollConfirmations();
  const second = await coordinator.maybeBuildAndSubmit({ force: true });
  assert.equal(second.batch.leaf_count, 100 - anchorBatchMaxLeaves);
  assert.equal(second.batch.prev_root, first.batch.root);
  assert.equal(await store.countPendingRecords(), 0);
  const records = [...await store.listManifestLeaves(first.batch.id), ...await store.listManifestLeaves(second.batch.id)];
  assert.equal(new Set(records.map((r) => r.recordId)).size, 100);
});

test("pending predecessor blocks forced builds and the transactional guard rolls back direct builders", async (t) => {
  const { store, builder, coordinator, enqueue } = await setup(t);
  await enqueue(1);
  const first = await coordinator.maybeBuildAndSubmit({});
  await enqueue(2);
  assert.deepEqual(await coordinator.maybeBuildAndSubmit({ force: true }), {
    created: false, reason: "awaiting_predecessor", predecessorBatchId: first.batch.id,
  });
  const head = await store.getLogHead();
  await assert.rejects(() => builder.buildNextBatch({ prevBatchId: head.headBatchId, prevRoot: head.headRoot, expectedHeadVersion: head.version }), /conflict|CAS/i);
  assert.deepEqual(await store.getLogHead(), head);
  assert.equal(await store.countBatches(), 1);
  assert.equal(await store.countPendingRecords(), 1);
});

test("a reverted tip can be abandoned and its records rebuilt without a failed predecessor", async (t) => {
  const { store, adapter, coordinator, enqueue } = await setup(t);
  await enqueue(1);
  const first = await coordinator.maybeBuildAndSubmit({});
  await enqueue(2);
  assert.equal((await coordinator.maybeBuildAndSubmit({ force: true })).reason, "awaiting_predecessor");
  const getConfirmation = adapter.getConfirmation;
  adapter.getConfirmation = async () => ({ status: "failed", confirmations: 12 });
  assert.deepEqual((await coordinator.pollConfirmations()).failedBatches, [first.batch.id]);
  await store.abandonBatch(first.batch.id, new Date().toISOString());
  adapter.getConfirmation = getConfirmation;
  const rebuilt = await coordinator.maybeBuildAndSubmit({ force: true });
  assert.equal(rebuilt.created, true);
  assert.equal(rebuilt.batch.prev_batch_id, null);
  assert.equal(rebuilt.batch.prev_root, null);
  assert.equal(rebuilt.batch.leaf_count, 2);
  assert.equal((await store.getBatch(first.batch.id)).status, "failed");
  assert.deepEqual((await coordinator.pollConfirmations()).confirmedBatches, [rebuilt.batch.id]);
});

test("concurrent builders preserve atomic ownership on libSQL", async (t) => {
  const { store, builder, enqueue } = await setup(t);
  for (let i = 1; i <= 100; i++) await enqueue(i);
  const args = { prevBatchId: null, prevRoot: null, expectedHeadVersion: 0 };
  const results = await Promise.allSettled([builder.buildNextBatch(args), builder.buildNextBatch(args)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(await store.countBatches(), 1);
  assert.equal(await store.countPendingRecords(), 100 - anchorBatchMaxLeaves);
});
