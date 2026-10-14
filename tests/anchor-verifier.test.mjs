// tests/anchor-verifier.test.mjs
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1AnchorStore } from "../services/anchoring/d1-anchor-store.mjs";
import { createMockAnchorAdapter } from "../services/anchoring/mock-anchor-adapter.mjs";
import { verifyAnchorRecord } from "../services/anchoring/anchor-verifier.mjs";
import { anchorLeafHash, anchorLeafProtocolVersion } from "../packages/protocol/anchor-leaf.mjs";
import { buildMerkleTree } from "../packages/protocol/merkle-tree.mjs";
import { sha256Canonical } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let store;
let adapter;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  store = new D1AnchorStore(database);
  // One adapter for the whole file: its tx counter never repeats, so tx_refs stay
  // unique against the shared database's (chain, network, tx_ref) constraint.
  adapter = createMockAnchorAdapter({ network: "local", operatorAddress: "mock:operator" });
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

const RECORD_TYPE = "contribution_receipt";
let clock = 0;
function ts() {
  clock += 1;
  return new Date(Date.UTC(2026, 9, 14, 0, 0, clock)).toISOString();
}

// The verifier's `hasher` is selected by the caller per record type; these fixtures
// use a deterministic fake so the test stays self-contained.
const fakeHasher = async (record) => sha256Canonical({ anchorSubject: record.id });

async function enqueueSubject(i, { leafHash } = {}) {
  const record = { id: `receipt:v${i}` };
  const recordHash = await fakeHasher(record);
  const boundLeafHash = leafHash ?? await anchorLeafHash({
    protocolVersion: anchorLeafProtocolVersion, recordType: RECORD_TYPE, recordId: record.id, recordHash,
  });
  await store.insertRecord({ recordType: RECORD_TYPE, recordId: record.id, recordHash, leafHash: boundLeafHash, createdAt: ts() });
  return { record, recordHash, leafHash: boundLeafHash };
}

function leafRow(entry) {
  return { record_type: RECORD_TYPE, record_id: entry.record.id, record_hash: entry.recordHash, leaf_hash: entry.leafHash };
}

async function merkleRoot(leaves) {
  return (await buildMerkleTree(leaves.map((leaf) => leaf.leaf_hash))).root;
}

/**
 * Creates a batch over `leaves`, submits it through the mock adapter (default
 * operator sender) and, unless `confirm: false`, walks it to 'confirmed' via
 * updateSubmissionStatus + markBatchConfirmed. prev pointers default to the
 * current log head; explicit values let tests forge them. `submittedRoot` lets
 * a test put a tampered root on-chain under the batch's submission.
 */
async function anchorBatch({ id, leaves, root, submittedRoot = root, prevBatchId, prevRoot, expectedHeadVersion, confirm = true }) {
  const head = await store.getLogHead();
  const chainPrevBatchId = prevBatchId === undefined ? head.headBatchId : prevBatchId;
  const chainPrevRoot = prevRoot === undefined ? head.headRoot : prevRoot;
  const manifestHash = await sha256Canonical({ batch: id });
  await store.createBatch({
    id, root, leafCount: leaves.length, manifestHash, manifestKey: `anchors/${id}`,
    prevBatchId: chainPrevBatchId, prevRoot: chainPrevRoot, chain: "mock", network: "local",
    createdAt: ts(), leaves, expectedHeadVersion: expectedHeadVersion ?? head.version,
  });
  const { txRef } = await adapter.submitRoot({
    root: submittedRoot, manifestHash, leafCount: leaves.length, prevRoot: chainPrevRoot, batchId: id,
  });
  await store.markSubmitted(id, txRef, ts());
  if (confirm) {
    const [submission] = await store.listSubmissions(id);
    await store.updateSubmissionStatus({
      submissionId: submission.id, status: "confirmed", confirmations: 12, blockRef: "mock-block-12", updatedAt: ts(),
    });
    await store.markBatchConfirmed(id, ts());
  }
  return { txRef, manifestHash };
}

function verify(entry, overrides = {}) {
  return verifyAnchorRecord({
    recordType: RECORD_TYPE, record: entry.record, hasher: fakeHasher, store, adapter, ...overrides,
  });
}

test("verified: recomputed leaf, proof, and root match the confirmed on-chain anchor", async () => {
  const entry = await enqueueSubject(1);
  const leaves = [leafRow(entry)];
  const batchId = "anchor-batch:verify-b1";
  await anchorBatch({ id: batchId, leaves, root: await merkleRoot(leaves) });
  const batch = await store.getBatch(batchId);
  const result = await verify(entry);
  assert.equal(result.status, "verified");
  assert.equal(result.batchId, batchId);
  assert.equal(result.root, batch.root);
  assert.equal(result.index, 0);
  assert.deepEqual(result.proof.path, []);
  assert.match(result.txRef, /^mock:local:tx-\d+$/);
});

test("pending: structurally valid record without an adapter returns pending, never verified", async () => {
  const entry = await enqueueSubject(9);
  const leaves = [leafRow(entry)];
  const batchId = "anchor-batch:verify-b9";
  await anchorBatch({ id: batchId, leaves, root: await merkleRoot(leaves) });
  const batch = await store.getBatch(batchId);
  const result = await verify(entry, { adapter: undefined });
  assert.equal(result.status, "pending");
  assert.equal(result.batchId, batchId);
  assert.equal(result.root, batch.root);
  assert.equal(result.index, 0);
  assert.deepEqual(result.proof.path, []);
  assert.equal(result.txRef, undefined);
});

test("unanchored: no anchor row exists for the record", async () => {
  const result = await verifyAnchorRecord({
    recordType: RECORD_TYPE, record: { id: "receipt:never-seen" }, hasher: fakeHasher, store, adapter,
  });
  assert.equal(result.status, "unanchored");
  assert.match(result.recordHash, /^sha256:[a-f0-9]{64}$/);
});

test("mismatch: submission carries a different root than the batch row", async () => {
  const entry = await enqueueSubject(3);
  const leaves = [leafRow(entry)];
  const batchId = "anchor-batch:verify-b3";
  const tamperedRoot = `sha256:${"8".repeat(64)}`;
  await anchorBatch({ id: batchId, leaves, root: await merkleRoot(leaves), submittedRoot: tamperedRoot });
  const result = await verify(entry);
  assert.deepEqual(result, { status: "mismatch", reason: "chain_root_mismatch" });
});

test("mismatch: stored leaf hash was corrupted after intake", async () => {
  const corruptLeafHash = `sha256:${"7".repeat(64)}`;
  const entry = await enqueueSubject(4, { leafHash: corruptLeafHash });
  const leaves = [leafRow(entry)];
  const batchId = "anchor-batch:verify-b4";
  await anchorBatch({ id: batchId, leaves, root: await merkleRoot(leaves) });
  const result = await verify(entry);
  assert.deepEqual(result, { status: "mismatch", reason: "leaf_hash_mismatch" });
});

test("mismatch: batch root does not match the merkle root of its manifest leaves", async () => {
  const entry = await enqueueSubject(5);
  const leaves = [leafRow(entry)];
  const batchId = "anchor-batch:verify-b5";
  await anchorBatch({ id: batchId, leaves, root: `sha256:${"6".repeat(64)}` });
  const result = await verify(entry);
  assert.deepEqual(result, { status: "mismatch", reason: "proof_failed" });
});

test("pending: batch submitted but not yet confirmed", async () => {
  const entry = await enqueueSubject(6);
  const leaves = [leafRow(entry)];
  const batchId = "anchor-batch:verify-b6";
  await anchorBatch({ id: batchId, leaves, root: await merkleRoot(leaves), confirm: false });
  assert.equal((await store.getBatch(batchId)).status, "submitted");
  const result = await verify(entry);
  assert.deepEqual(result, { status: "pending", batchId });
});

test("mismatch: prev_root does not chain to the previous batch root", async () => {
  const head = await store.getLogHead();
  const wrongRoot = `sha256:${"5".repeat(64)}`;
  // The build-time CAS guard refuses forged prev pointers, so corrupt the head row
  // directly: the next batch is born with a prev_root no real batch ever had. The
  // verifier is the second line of defense against a tampered projection.
  await database.prepare("UPDATE anchor_log_head SET head_root = ? WHERE version = ?")
    .bind(wrongRoot, head.version)
    .run();
  const entry = await enqueueSubject(7);
  const leaves = [leafRow(entry)];
  const batchId = "anchor-batch:verify-b7";
  await anchorBatch({
    id: batchId, leaves, root: await merkleRoot(leaves),
    prevBatchId: head.headBatchId, prevRoot: wrongRoot,
  });
  const result = await verify(entry);
  assert.deepEqual(result, { status: "mismatch", reason: "prev_root_mismatch" });
});

test("mismatch: prev_batch_id null but prev_root non-null (XOR edge)", async () => {
  const entry = await enqueueSubject(8);
  const leaves = [leafRow(entry)];
  const batchId = "anchor-batch:verify-b8";
  await anchorBatch({ id: batchId, leaves, root: await merkleRoot(leaves) });
  // Corrupt the confirmed row: sever the prev batch pointer while prev_root stays set.
  await database.prepare("UPDATE anchor_batches SET prev_batch_id = NULL WHERE id = ?").bind(batchId).run();
  const result = await verify(entry);
  assert.deepEqual(result, { status: "mismatch", reason: "prev_root_mismatch" });
});
