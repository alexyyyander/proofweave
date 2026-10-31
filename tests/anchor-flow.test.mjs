// tests/anchor-flow.test.mjs
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { D1AnchorStore } from "../services/anchoring/d1-anchor-store.mjs";
import { createAnchorIntake } from "../services/anchoring/anchor-intake.mjs";
import { createAnchorBatchBuilder } from "../services/anchoring/anchor-batch-builder.mjs";
import { createManifestStorage } from "../services/anchoring/anchor-manifest-storage.mjs";
import { createAnchorCoordinator } from "../services/anchoring/anchor-coordinator.mjs";
import { createMockAnchorAdapter } from "../services/anchoring/mock-anchor-adapter.mjs";
import { verifyAnchorRecord } from "../services/anchoring/anchor-verifier.mjs";
import { buildMerkleTree } from "../packages/protocol/merkle-tree.mjs";
import { sha256Canonical } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let store;
let adapter;
let bucket;

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
  bucket = new MemoryBucket();
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

class MemoryBucket {
  constructor() { this.map = new Map(); }
  async put(key, value) { this.map.set(key, value); }
  async get(key) { return this.map.get(key) ?? null; }
}

/** Composes the full off-chain pipeline exactly like the coordinator wiring. */
function setupFlow() {
  const manifestStorage = createManifestStorage({ bucket });
  const intake = createAnchorIntake(store);
  const builder = createAnchorBatchBuilder({ store, chain: "mock", network: "local" });
  const coordinator = createAnchorCoordinator({
    store, builder, manifestStorage, adapter,
    config: { chain: "mock", network: "local", minLeafCount: 1, maxIntervalSeconds: 86400, confirmationThreshold: 1 },
    // The flow test never exercises the witness gates; a stub keeps the composition self-contained.
    verifyWitnessAuthority: async () => ({ submitterId: "person:flow-witness" }),
  });
  return { intake, coordinator };
}

let clock = 0;
function ts() {
  clock += 1;
  return new Date(Date.UTC(2026, 9, 14, 0, 0, clock)).toISOString();
}

async function enqueueFakeReceipt(intake, id) {
  const recordHash = await sha256Canonical({ fakeReceipt: id });
  await intake.enqueueAnchorRecord({ recordType: "contribution_receipt", recordId: id, recordHash, createdAt: ts() });
  return { id, recordHash };
}

// Flow fixtures are their own hash carrier: the "record" is the fake receipt.
const flowHasher = async (record) => record.recordHash;

test("closed loop: intake → build → submit → confirm → verified", async () => {
  const { intake, coordinator } = setupFlow();
  const receipt = await enqueueFakeReceipt(intake, "receipt:flow-1");
  const summary = await coordinator.maybeBuildAndSubmit({});
  assert.equal(summary.created, true);
  const confirmed = await coordinator.pollConfirmations();
  assert.deepEqual(confirmed.confirmedBatches, [summary.batch.id]);
  const result = await verifyAnchorRecord({
    recordType: "contribution_receipt",
    record: { id: receipt.id, recordHash: receipt.recordHash },
    hasher: flowHasher, store, adapter,
  });
  assert.equal(result.status, "verified");
  assert.equal(result.batchId, summary.batch.id);
  assert.equal(result.txRef, summary.txRef);
  assert.equal(result.index, 0);
});

test("a tampered record id has no anchor row and verifies as unanchored", async () => {
  const result = await verifyAnchorRecord({
    recordType: "contribution_receipt",
    // Same recordHash as the anchored receipt, but the id no longer matches any row.
    record: { id: "receipt:flow-1-tampered", recordHash: await sha256Canonical({ fakeReceipt: "receipt:flow-1" }) },
    hasher: flowHasher, store, adapter,
  });
  assert.equal(result.status, "unanchored");
});

test("a batch born with tampered prev pointers verifies as prev_root_mismatch", async () => {
  const { intake } = setupFlow();
  const receipt = await enqueueFakeReceipt(intake, "receipt:flow-2");
  const head = await store.getLogHead();
  const wrongRoot = `sha256:${"9".repeat(64)}`;
  // The build-time CAS guard refuses forged prev pointers, so corrupt the head row
  // directly: the next batch is created with a prev_root that does not chain to the
  // real previous batch. The verifier is the second line of defense.
  await database.prepare("UPDATE anchor_log_head SET head_root = ? WHERE version = ?")
    .bind(wrongRoot, head.version)
    .run();
  const pending = await store.listPendingRecords();
  assert.equal(pending.length, 1);
  const leaves = pending.map((row) => ({
    record_type: row.record_type, record_id: row.record_id, record_hash: row.record_hash, leaf_hash: row.leaf_hash,
  }));
  const root = (await buildMerkleTree(leaves.map((leaf) => leaf.leaf_hash))).root;
  const batchId = "anchor-batch:flow-b2";
  const manifestHash = await sha256Canonical({ batch: batchId });
  await store.createBatch({
    id: batchId, root, leafCount: leaves.length, manifestHash, manifestKey: `anchors/${batchId}`,
    prevBatchId: head.headBatchId, prevRoot: wrongRoot, chain: "mock", network: "local",
    createdAt: ts(), leaves, expectedHeadVersion: head.version,
  });
  const { txRef } = await adapter.submitRoot({
    root, manifestHash, leafCount: leaves.length, prevRoot: wrongRoot, batchId,
  });
  await store.markSubmitted(batchId, txRef, ts());
  const [submission] = await store.listSubmissions(batchId);
  await store.updateSubmissionStatus({
    submissionId: submission.id, status: "confirmed", confirmations: 12, blockRef: "mock-block-12", updatedAt: ts(),
  });
  await store.markBatchConfirmed(batchId, ts());
  const result = await verifyAnchorRecord({
    recordType: "contribution_receipt",
    record: { id: receipt.id, recordHash: receipt.recordHash },
    hasher: flowHasher, store, adapter,
  });
  assert.deepEqual(result, { status: "mismatch", reason: "prev_root_mismatch" });
});
