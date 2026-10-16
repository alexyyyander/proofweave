import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { D1AnchorStore } from "../services/anchoring/d1-anchor-store.mjs";
import { createAnchorIntake } from "../services/anchoring/anchor-intake.mjs";
import { createAnchorBatchBuilder } from "../services/anchoring/anchor-batch-builder.mjs";
import { createAnchorCoordinator } from "../services/anchoring/anchor-coordinator.mjs";
import { createMockAnchorAdapter } from "../services/anchoring/mock-anchor-adapter.mjs";
import { createManifestStorage } from "../services/anchoring/anchor-manifest-storage.mjs";
import { runAnchorTick } from "../services/anchoring/anchor-tick.mjs";

async function migrate(db, name) {
  const sql = await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8");
  for (const statement of sql.split("--> statement-breakpoint").filter(s => s.trim())) await db.prepare(statement).run();
}
async function setup(t, { legacy = false } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pw-anchor-outbox-"));
  const url = `file:${join(dir, "state.sqlite")}`;
  let db = new LibsqlD1Database(createClient({ url }));
  t.after(async () => { db.close(); await rm(dir, { recursive: true, force: true }); });
  await migrate(db, "0046_add_anchor_tables.sql");
  if (!legacy) await migrate(db, "0048_add_anchor_submission_outbox.sql");
  const adapter = createMockAnchorAdapter();
  const prepare = adapter.prepareRoot;
  const sends = [];
  let prepares = 0;
  adapter.prepareRoot = async p => { prepares++; return prepare(p); };
  const broadcast = adapter.broadcastPreparedRoot;
  adapter.broadcastPreparedRoot = async (p, payload) => {
    sends.push(structuredClone(p));
    return broadcast(p, payload);
  };
  const objects = new Map();
  const storage = createManifestStorage({ bucket: { put: async (k, v) => objects.set(k, v), get: async k => objects.get(k) } });
  const context = () => {
    const store = new D1AnchorStore(db);
    const builder = createAnchorBatchBuilder({ store, chain: "mock", network: "local" });
    const coordinator = createAnchorCoordinator({ store, builder, manifestStorage: storage, adapter,
      config: { minLeafCount: 1, maxIntervalSeconds: 86400, confirmationThreshold: 12 }, verifyWitnessAuthority: async () => ({}) });
    return { store, builder, coordinator };
  };
  await createAnchorIntake(context().store).enqueueAnchorRecord({ recordType: "research_checkpoint", recordId: "checkpoint:test",
    recordHash: `sha256:${"a".repeat(64)}`, createdAt: new Date().toISOString() });
  return { context, adapter, sends, prepares: () => prepares, database: () => db,
    reopen() { db.close(); db = new LibsqlD1Database(createClient({ url })); return context(); } };
}

for (const afterCommit of [false, true]) {
  test(`outbox write failure (${afterCommit ? "lost acknowledgement" : "not committed"}) never broadcasts before persistence`, async t => {
    const f = await setup(t);
    const { store, coordinator } = f.context();
    const save = store.savePreparedSubmission.bind(store);
    store.savePreparedSubmission = async (...args) => { if (afterCommit) await save(...args); throw new Error("outbox IO interrupted"); };
    await assert.rejects(() => coordinator.maybeBuildAndSubmit(), /IO interrupted/);
    assert.equal(f.sends.length, 0);
    const restarted = f.reopen();
    assert.equal(await restarted.coordinator.resumeUnfinishedBatches(), 1);
    assert.equal(f.prepares(), afterCommit ? 1 : 2);
    assert.equal(f.sends.length, 1);
    const batch = await restarted.store.getLatestBatch();
    assert.equal((await restarted.store.getPreparedSubmission(batch.id)).txRef, f.sends[0].txRef);
  });
}

test("process restart after broadcast but before projection reuses the persisted bytes and txRef", async t => {
  const f = await setup(t);
  const { store, coordinator } = f.context();
  store.markSubmitted = async () => { throw new Error("projection interrupted"); };
  await assert.rejects(() => coordinator.maybeBuildAndSubmit(), /projection interrupted/);
  const restarted = f.reopen();
  assert.equal(await restarted.coordinator.resumeUnfinishedBatches(), 1);
  assert.equal(f.prepares(), 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
  const batch = await restarted.store.getLatestBatch();
  assert.equal((await restarted.store.listSubmissions(batch.id)).length, 1);
  assert.equal((await restarted.coordinator.pollConfirmations()).confirmedBatches.length, 1);
  assert.equal(await restarted.coordinator.resumeUnfinishedBatches(), 0);
});

test("lost broadcast response retries the same transaction without a new signature", async t => {
  const f = await setup(t);
  const send = f.adapter.broadcastPreparedRoot;
  let lost = true;
  f.adapter.broadcastPreparedRoot = async (p, payload) => {
    const result = await send(p, payload);
    if (lost) { lost = false; throw new Error("broadcast response lost"); }
    return result;
  };
  await assert.rejects(() => f.context().coordinator.maybeBuildAndSubmit(), /response lost/);
  assert.equal(await f.reopen().coordinator.resumeUnfinishedBatches(), 1);
  assert.equal(f.prepares(), 1);
  assert.deepEqual(f.sends[0], f.sends[1]);
});

test("lost projection acknowledgement does not broadcast again after committed state is recovered", async t => {
  const f = await setup(t);
  const { store, coordinator } = f.context();
  const mark = store.markSubmitted.bind(store);
  store.markSubmitted = async (...args) => { await mark(...args); throw new Error("projection response lost"); };
  await assert.rejects(() => coordinator.maybeBuildAndSubmit(), /projection response lost/);
  const restarted = f.reopen();
  assert.equal(await restarted.coordinator.resumeUnfinishedBatches(), 0);
  assert.equal((await restarted.coordinator.pollConfirmations()).confirmedBatches.length, 1);
  assert.equal(f.prepares(), 1);
  assert.equal(f.sends.length, 1);
});

test("competing outbox writers both receive the first persisted transaction", async t => {
  const f = await setup(t);
  const { store, builder } = f.context();
  const { batch } = await builder.buildNextBatch({ prevBatchId: null, prevRoot: null });
  const candidates = await Promise.all([f.adapter.prepareRoot({}), f.adapter.prepareRoot({})]);
  // Real transactions have canonical values; only the store CAS is under test here.
  const prepared = candidates.map(p => ({ ...p, signedTransaction: "signed:" + p.txRef }));
  const winners = await Promise.all(prepared.map(p => store.savePreparedSubmission(batch.id, p, new Date().toISOString())));
  assert.deepEqual(winners[0], winners[1]);
  assert.ok(prepared.some(p => p.txRef === winners[0].txRef));
});

test("migration fences legacy built batches and tick reports manual recovery as failure", async t => {
  const f = await setup(t, { legacy: true });
  const { builder } = f.context();
  await builder.buildNextBatch({ prevBatchId: null, prevRoot: null });
  await migrate(f.database(), "0048_add_anchor_submission_outbox.sql");
  await assert.rejects(() => runAnchorTick(f.context().coordinator), /manual chain reconciliation/);
  assert.equal(f.prepares(), 0);
  assert.equal(f.sends.length, 0);
});

test("legacy one-shot adapters are refused before any broadcast", async t => {
  const f = await setup(t);
  f.adapter.prepareRoot = undefined;
  await assert.rejects(() => f.context().coordinator.maybeBuildAndSubmit(), /durable prepared/);
  assert.equal(f.sends.length, 0);
});
