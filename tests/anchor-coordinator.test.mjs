// tests/anchor-coordinator.test.mjs
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
import {
  anchorWitnessSigningPayload,
  signAnchorWitness,
  verifyAnchorWitnessSignature,
} from "../packages/protocol/anchor-witness.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let sharedAdapter;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
  // One adapter for the whole file: its tx counter never repeats, so tx_refs stay
  // unique against the shared database's (chain, network, tx_ref) constraint.
  sharedAdapter = createMockAnchorAdapter({ network: "local", operatorAddress: "mock:operator" });
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

async function setupCoordinator({ minLeafCount = 100, maxIntervalSeconds = 86400, confirmationThreshold = 12 } = {}) {
  const store = new D1AnchorStore(database);
  const adapter = sharedAdapter;
  const bucket = new MemoryBucket();
  const manifestStorage = createManifestStorage({ bucket });
  const intake = createAnchorIntake(store);
  const builder = createAnchorBatchBuilder({ store, chain: "mock", network: "local" });
  const witnessKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const coordinator = createAnchorCoordinator({
    store, builder, manifestStorage, adapter,
    config: { chain: "mock", network: "local", minLeafCount, maxIntervalSeconds, confirmationThreshold },
    verifyWitnessAuthority: async ({ payload, signature }) => {
      const ok = await verifyAnchorWitnessSignature(payload, signature, witnessKeys.publicKey);
      if (!ok) throw new Error("bad authority");
      return { submitterId: "person:witness" };
    },
  });
  return { store, coordinator, adapter, bucket, intake, witnessKeys };
}

function witnessPayload(batch, txRef) {
  return anchorWitnessSigningPayload({ batchId: batch.id, root: batch.root, manifestHash: batch.manifest_hash, txRef });
}

async function enqueueAnchorRecord(intake, i) {
  await intake.enqueueAnchorRecord({
    recordType: "contribution_receipt",
    recordId: `receipt:${i}`,
    recordHash: `sha256:${String(i).padStart(64, "0")}`,
    createdAt: "2026-10-14T00:00:00.000Z",
  });
}

async function enqueueAndSubmitOne(coordinator, intake, i) {
  await enqueueAnchorRecord(intake, i);
  const summary = await coordinator.maybeBuildAndSubmit({ force: true });
  assert.equal(summary.created, true);
  return summary;
}

test("builds and submits when threshold reached, then confirms", async () => {
  const { store, coordinator, intake } = await setupCoordinator({ minLeafCount: 2, confirmationThreshold: 1 });
  for (let i = 0; i < 2; i += 1) {
    await enqueueAnchorRecord(intake, i);
  }
  const summary = await coordinator.maybeBuildAndSubmit({});
  assert.equal(summary.created, true);
  const batch = await store.getBatch(summary.batch.id);
  assert.equal(batch.status, "submitted");
  const confirmed = await coordinator.pollConfirmations();
  assert.equal(confirmed.confirmedBatches.length, 1);
  assert.equal((await store.getBatch(summary.batch.id)).status, "confirmed");
});

test("witness flow enforces signature, chain truth, and independence", async () => {
  const { store, coordinator, adapter, intake, witnessKeys } = await setupCoordinator({ minLeafCount: 1, confirmationThreshold: 0 });
  const summary = await enqueueAndSubmitOne(coordinator, intake, 100);
  const batch = await store.getBatch(summary.batch.id);
  const witnessTxRef = "mock:local:tx-witness-1"; // gate 1 only checks the signature; the txRef matters from gate 3 on

  // gate 1: invalid signature → { accepted: false } (reason "invalid_signature")
  const badSignature = await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, witnessTxRef), signature: "bad", txRef: witnessTxRef,
  });
  assert.equal(badSignature.accepted, false);

  // gate 2: network mismatch (batch canonical network is mock:local)
  const wrongNetworkTx = "mock:other:tx-9";
  assert.equal((await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, wrongNetworkTx),
    signature: await signAnchorWitness(witnessPayload(batch, wrongNetworkTx), witnessKeys.privateKey), txRef: wrongNetworkTx,
  })).accepted, false);

  // gate 3: valid signature but txRef does not carry this batch's root on-chain
  const forgedTxRef = "mock:local:tx-forged";
  assert.equal((await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, forgedTxRef),
    signature: await signAnchorWitness(witnessPayload(batch, forgedTxRef), witnessKeys.privateKey), txRef: forgedTxRef,
  })).accepted, false);

  // gate 4/5: reusing the platform's own transaction → independence rejection
  const platformTxRef = (await store.listSubmissions(batch.id))[0].tx_ref;
  assert.equal((await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, platformTxRef),
    signature: await signAnchorWitness(witnessPayload(batch, platformTxRef), witnessKeys.privateKey), txRef: platformTxRef,
  })).accepted, false);

  // legitimate: witness submits a REAL transaction anchoring the same root with a DIFFERENT sender
  const witnessSubmission = await adapter.submitRoot({
    root: batch.root, manifestHash: batch.manifest_hash, leafCount: batch.leaf_count,
    prevRoot: batch.prev_root, batchId: batch.id, sender: "mock:witness-1",
  });
  const ok = await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, witnessSubmission.txRef),
    signature: await signAnchorWitness(witnessPayload(batch, witnessSubmission.txRef), witnessKeys.privateKey),
    txRef: witnessSubmission.txRef,
  });
  assert.equal(ok.accepted, true);
  assert.equal((await store.getBatch(batch.id)).witness_count, 1);
  // idempotent: same witness + same txRef again → accepted true but count unchanged
  const repeat = await coordinator.submitWitness({
    batchId: batch.id, payload: witnessPayload(batch, witnessSubmission.txRef),
    signature: await signAnchorWitness(witnessPayload(batch, witnessSubmission.txRef), witnessKeys.privateKey),
    txRef: witnessSubmission.txRef,
  });
  assert.equal(repeat.accepted, true);
  assert.equal((await store.getBatch(batch.id)).witness_count, 1);
});

test("empty pending leaves no batch and reports created:false", async () => {
  const { store, coordinator } = await setupCoordinator();
  const batchesBefore = (await store.listBatches({ limit: 1000 })).length;
  const summary = await coordinator.maybeBuildAndSubmit({ force: true });
  assert.equal(summary.created, false);
  assert.equal(summary.reason, "empty");
  assert.equal((await store.listBatches({ limit: 1000 })).length, batchesBefore);
});

test("resumeUnfinishedBatches submits built batches after a crash", async () => {
  const { store, coordinator, bucket, intake } = await setupCoordinator({ minLeafCount: 1 });
  await enqueueAnchorRecord(intake, 200);
  // Simulate a crash between createBatch and markSubmitted: build directly through the builder.
  const builder = createAnchorBatchBuilder({ store, chain: "mock", network: "local" });
  const head = await store.getLogHead();
  const built = await builder.buildNextBatch({
    prevBatchId: head.headBatchId, prevRoot: head.headRoot, expectedHeadVersion: head.version,
  });
  assert.equal(built.created, true);
  const batchId = built.batch.id;
  assert.equal((await store.getBatch(batchId)).status, "built");
  assert.equal((await store.listSubmissions(batchId)).length, 0);

  const recovered = await coordinator.resumeUnfinishedBatches();
  assert.equal(recovered, 1);
  const batch = await store.getBatch(batchId);
  assert.equal(batch.status, "submitted");
  const submissions = await store.listSubmissions(batchId);
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].submitter_kind, "platform");
  assert.ok(submissions[0].tx_ref.startsWith("mock:local:tx-"));
  // Manifest must be durable under its content-addressed key after recovery.
  const storage = createManifestStorage({ bucket });
  const stored = JSON.parse(new TextDecoder().decode(await storage.get(batch.manifest_key)));
  assert.equal(stored.batchId, batchId);
  assert.equal(stored.root, batch.root);
  // Re-running recovery is a no-op once nothing is left in 'built'.
  assert.equal(await coordinator.resumeUnfinishedBatches(), 0);
});
