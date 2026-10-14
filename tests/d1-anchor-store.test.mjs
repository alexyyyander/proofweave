import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1AnchorStore } from "../services/anchoring/d1-anchor-store.mjs";
import { sha256Canonical } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
});

after(async () => { await miniflare?.dispose(); });

async function applyMigrations(d1) {
  const filenames = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await d1.prepare(statement).run();
    }
  }
}

function recordFixture(i) {
  return {
    recordType: "contribution_receipt",
    recordId: `receipt:r${i}`,
    recordHash: `sha256:${String(i).padStart(64, "0")}`,
    leafHash: `sha256:${String(1000 + i).padStart(64, "0")}`,
  };
}

test("intake insert is idempotent and unique per (type,id,hash)", async () => {
  const store = new D1AnchorStore(database);
  const first = await store.insertRecord({ ...recordFixture(1), createdAt: "2026-10-14T00:00:00.000Z" });
  const again = await store.insertRecord({ ...recordFixture(1), createdAt: "2026-10-14T00:00:01.000Z" });
  assert.equal(first.created, true);
  assert.equal(again.created, false);
});

test("createBatch snapshots pending records, CAS-serializes head, appends event", async () => {
  const store = new D1AnchorStore(database);
  const leaves = [];
  for (let i = 2; i <= 5; i += 1) {
    const fixture = { ...recordFixture(i), createdAt: "2026-10-14T00:00:00.000Z" };
    await store.insertRecord(fixture);
    leaves.push({ record_type: fixture.recordType, record_id: fixture.recordId, record_hash: fixture.recordHash, leaf_hash: fixture.leafHash });
  }
  const batchInput = {
    id: "anchor-batch:b1", root: `sha256:${"f".repeat(64)}`, leafCount: 4,
    manifestHash: await sha256Canonical({ batch: "b1" }), manifestKey: "anchors/sha256_x",
    prevBatchId: null, prevRoot: null, chain: "mock", network: "local", createdAt: "2026-10-14T00:01:00.000Z",
    leaves,
  };
  const created = await store.createBatch(batchInput);
  assert.equal(created.batch.id, "anchor-batch:b1");
  const batch = await store.getBatch("anchor-batch:b1");
  assert.equal(batch.status, "built");
  assert.equal(batch.leaf_count, 4);
  const head = await store.getLogHead();
  assert.equal(head.headBatchId, "anchor-batch:b1");
  assert.equal(head.headRoot, `sha256:${"f".repeat(64)}`);
  const assigned = await store.listPendingRecords();
  // NOTE shared DB: r1 inserted in test 1 was not batched — it is the only pending row
  assert.equal(assigned.length, 1);
  assert.equal(assigned[0].record_id, "receipt:r1");
  const events = await store.listBatchEvents("anchor-batch:b1");
  assert.equal(events.filter((event) => event.event_type === "batch_built").length, 1);
  const manifestLeaves = await store.listManifestLeaves("anchor-batch:b1");
  assert.equal(manifestLeaves.length, 4);
  assert.deepEqual(Object.keys(manifestLeaves[0]).sort(), ["recordHash", "recordId", "recordType"]);
});

test("abandonBatch releases records and rolls back head only without confirmed submissions", async () => {
  const store = new D1AnchorStore(database);
  // b1 (created by previous test) has no confirmed submission → abandonable; releases its 4 records + r1 = 5 pending
  await store.abandonBatch("anchor-batch:b1", "2026-10-14T00:02:00.000Z");
  assert.equal((await store.getBatch("anchor-batch:b1")).status, "failed");
  assert.equal((await store.listPendingRecords()).length, 5);
  const head = await store.getLogHead();
  // append-only head log: after abandon the latest head points back to genesis (NULL)
  assert.equal(head.headBatchId, null);
  // batches with a confirmed submission cannot be abandoned: build b2 → markSubmitted → confirm → abandon must reject
  const leaves2 = [];
  for (let i = 6; i <= 6; i += 1) {
    const fixture = { ...recordFixture(i), createdAt: "2026-10-14T00:03:00.000Z" };
    await store.insertRecord(fixture);
    leaves2.push({ record_type: fixture.recordType, record_id: fixture.recordId, record_hash: fixture.recordHash, leaf_hash: fixture.leafHash });
  }
  await store.createBatch({ id: "anchor-batch:b2", root: `sha256:${"e".repeat(64)}`, leafCount: 1,
    manifestHash: await sha256Canonical({ batch: "b2" }), manifestKey: "anchors/sha256_y",
    prevBatchId: null, prevRoot: null, chain: "mock", network: "local", createdAt: "2026-10-14T00:03:00.000Z", leaves: leaves2 });
  await store.markSubmitted("anchor-batch:b2", "mock:local:tx-b2", "2026-10-14T00:03:01.000Z");
  const [submission] = await store.listSubmissions("anchor-batch:b2");
  await store.updateSubmissionStatus({ submissionId: submission.id, status: "confirmed", confirmations: 12, blockRef: "b", updatedAt: "2026-10-14T00:03:02.000Z" });
  await assert.rejects(() => store.abandonBatch("anchor-batch:b2", "2026-10-14T00:03:03.000Z"), /confirmed/);
});
