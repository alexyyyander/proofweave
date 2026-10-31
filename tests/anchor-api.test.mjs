import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  AnchorListQueryError,
  anchorCoordinatorConfigFromSettings,
  buildAnchorAdapterRegistry,
  computeAnchorProof,
  createVolatileManifestStorage,
  createWitnessAuthorityVerifier,
  detectAnchoringState,
  listPublicAnchorBatches,
  loadAnchorManifest,
  resolveWitnessSubmissionTarget,
  witnessAuthorityCandidatesFromProfile,
  witnessRejectionErrorCode,
  witnessRejectionHttpStatus,
  witnessThresholdFromSettings,
  WitnessAuthorityError,
} from "../app/lib/anchor-routes.ts";
import { D1AnchorStore } from "../services/anchoring/d1-anchor-store.mjs";
import { createAnchorIntake } from "../services/anchoring/anchor-intake.mjs";
import { createAnchorBatchBuilder } from "../services/anchoring/anchor-batch-builder.mjs";
import { createManifestStorage } from "../services/anchoring/anchor-manifest-storage.mjs";
import { createMockAnchorAdapter } from "../services/anchoring/mock-anchor-adapter.mjs";
import { AnchorAdapterConfigurationError } from "../services/anchoring/anchor-chain-adapter.mjs";
import {
  anchorWitnessSigningPayload,
  signAnchorWitness,
} from "../packages/protocol/anchor-witness.mjs";
import { anchorLeafHash } from "../packages/protocol/anchor-leaf.mjs";
import { verifyInclusionProof } from "../packages/protocol/merkle-tree.mjs";
import { sha256Canonical } from "../packages/protocol/canonical-json.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
const fixedNow = () => "2026-06-01T00:00:00.000Z";

let miniflare;
let database;
let store;
let intake;
let builder;
let adapter;
let bucket;
let manifestStorage;
let clock = 0;

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
  intake = createAnchorIntake(store);
  builder = createAnchorBatchBuilder({ store, chain: "mock", network: "local" });
  adapter = createMockAnchorAdapter({ network: "local", operatorAddress: "mock:operator" });
  bucket = new MemoryBucket();
  manifestStorage = createManifestStorage({ bucket });
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

function ts() {
  clock += 1;
  return new Date(Date.UTC(2026, 9, 14, 0, 0, clock)).toISOString();
}

async function enqueueReceipt(id) {
  const recordHash = await sha256Canonical({ fakeReceipt: id });
  await intake.enqueueAnchorRecord({
    recordType: "contribution_receipt",
    recordId: id,
    recordHash,
    createdAt: ts(),
  });
  return recordHash;
}

async function buildAndSubmitBatch({ confirm = true }) {
  const head = await store.getLogHead();
  const built = await builder.buildNextBatch({
    prevBatchId: head.headBatchId,
    prevRoot: head.headRoot,
    expectedHeadVersion: head.version,
  });
  assert.equal(built.created, true);
  const { txRef } = await adapter.submitRoot({
    root: built.batch.root,
    manifestHash: built.manifestHash,
    leafCount: built.batch.leaf_count,
    prevRoot: built.batch.prev_root,
    batchId: built.batch.id,
  });
  await store.markSubmitted(built.batch.id, txRef, ts());
  if (confirm) {
    const [platform] = await store.listSubmissions(built.batch.id);
    await store.updateSubmissionStatus({
      submissionId: platform.id, status: "confirmed", confirmations: 12, blockRef: "b", updatedAt: ts(),
    });
    await store.markBatchConfirmed(built.batch.id, ts());
  }
  return { ...built, platformTxRef: txRef };
}

function proofRequest(overrides = {}) {
  return {
    store,
    adaptersConfigured: true,
    type: "contribution_receipt",
    recordId: "receipt:api-a",
    recordHash: `sha256:${"a".repeat(64)}`,
    ...overrides,
  };
}

test("batch list reports anchoring_disabled when the batch table is empty and no adapters are configured", async () => {
  const result = await listPublicAnchorBatches({ store, adaptersConfigured: false });
  assert.deepEqual(result, { status: "anchoring_disabled", batches: [] });
  assert.equal(await detectAnchoringState({ store, adaptersConfigured: false }), "anchoring_disabled");
});

test("batch list with adapters configured is enabled even with an empty batch table", async () => {
  const result = await listPublicAnchorBatches({ store, adaptersConfigured: true });
  assert.deepEqual(result, { status: "ok", batches: [], pagination: { limit: 50, offset: 0, total: 0 } });
  assert.equal(await detectAnchoringState({ store, adaptersConfigured: true }), "enabled");
});

test("manifest lookup for an unknown batch reports anchoring_disabled instead of 404 while anchoring is off", async () => {
  const disabled = await loadAnchorManifest({
    store, bucket, batchId: "anchor-batch:missing", adaptersConfigured: false,
  });
  assert.deepEqual(disabled, { status: "anchoring_disabled" });
  const enabled = await loadAnchorManifest({
    store, bucket, batchId: "anchor-batch:missing", adaptersConfigured: true,
  });
  assert.deepEqual(enabled, { status: "not_found" });
});

test("proof request reports anchoring_disabled while anchoring is off", async () => {
  const result = await computeAnchorProof(proofRequest({
    adaptersConfigured: false,
    recordId: "receipt:never-enqueued",
    recordHash: `sha256:${"0".repeat(64)}`,
  }));
  assert.deepEqual(result, { status: "anchoring_disabled" });
});

test("proof request validates its query parameters", async () => {
  const badType = await computeAnchorProof(proofRequest({ type: "artifact_bundle" }));
  assert.equal(badType.status, "invalid_request");
  const badHash = await computeAnchorProof(proofRequest({ recordHash: "deadbeef" }));
  assert.equal(badHash.status, "invalid_request");
  const missingId = await computeAnchorProof(proofRequest({ recordId: "" }));
  assert.equal(missingId.status, "invalid_request");
});

test("witness authority requires a payload and base64url signature", async () => {
  const { publicKey } = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
  const candidate = { submitterId: "person:x", publicKey: base64Url(raw) };
  const verifier = createWitnessAuthorityVerifier({ candidates: [candidate] });
  await assert.rejects(() => verifier({ payload: null, signature: "aa" }), WitnessAuthorityError);
  await assert.rejects(() => verifier({ payload: { protocolVersion: "pw-anchor-witness-v1" }, signature: "" }), WitnessAuthorityError);
  await assert.rejects(() => verifier({ payload: [1, 2], signature: "aa" }), WitnessAuthorityError);
});

test("anchored world: two batches (confirmed + submitted) with a confirmed witness submission", async () => {
  const recordHashA = await enqueueReceipt("receipt:api-a");
  const recordHashB = await enqueueReceipt("receipt:api-b");
  const built = await buildAndSubmitBatch({ confirm: true });

  const witnessTx = await adapter.submitRoot({
    root: built.batch.root, manifestHash: built.manifestHash, leafCount: built.batch.leaf_count,
    prevRoot: built.batch.prev_root, batchId: built.batch.id, sender: "mock:witness-1",
  });
  const recorded = await store.recordSubmission({
    batchId: built.batch.id, submitterKind: "witness", submitterId: "person:api-witness",
    chain: "mock", network: "local", txRef: witnessTx.txRef, submittedAt: ts(),
  });
  assert.equal(recorded.created, true);
  await store.updateSubmissionStatus({
    submissionId: recorded.submission.id, status: "confirmed", confirmations: 12, blockRef: "b", updatedAt: ts(),
  });
  await store.syncWitnessCount(built.batch.id, ts());

  const manifestPut = await manifestStorage.put(built.manifest);
  assert.equal(manifestPut.key, built.manifestKey);

  const recordHashC = await enqueueReceipt("receipt:api-c");
  const submitted = await buildAndSubmitBatch({ confirm: false });

  globalThis.anchorWorld = {
    confirmed: {
      batchId: built.batch.id,
      batch: built.batch,
      manifest: built.manifest,
      manifestHash: built.manifestHash,
      manifestKey: built.manifestKey,
      platformTxRef: built.platformTxRef,
      witnessTxRef: witnessTx.txRef,
      recordHashes: { a: recordHashA, b: recordHashB },
    },
    submitted: { batchId: submitted.batch.id, batch: submitted.batch, recordHash: recordHashC },
  };
});

test("batch list projects batches newest-first with witness counts", async () => {
  const world = globalThis.anchorWorld;
  const result = await listPublicAnchorBatches({ store, adaptersConfigured: true });
  assert.equal(result.status, "ok");
  assert.equal(result.batches.length, 2);
  assert.equal(result.batches[0].id, world.submitted.batchId);
  assert.equal(result.batches[0].status, "submitted");
  const confirmed = result.batches.find((batch) => batch.id === world.confirmed.batchId);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.leafCount, 2);
  assert.equal(confirmed.witnessCount, 1);
  assert.equal(confirmed.chain, "mock");
  assert.equal(confirmed.network, "local");
  assert.equal(confirmed.manifestHash, world.confirmed.manifestHash);
  assert.equal(confirmed.root, world.confirmed.batch.root);
  assert.deepEqual(Object.keys(confirmed).sort(), [
    "anchoredAt", "chain", "createdAt", "id", "leafCount", "manifestHash",
    "network", "prevBatchId", "prevRoot", "root", "status", "witnessCount", "witnessState",
  ]);
});

test("batch list supports pagination with totals", async () => {
  const world = globalThis.anchorWorld;
  // 第三个批次，让分页窗口可断言
  await enqueueReceipt("receipt:api-d");
  // Preserve an explicit pre-upgrade multiple-open-batch fixture for list/proof
  // reads. The new transactional guard prevents creating this state normally.
  await database.prepare("UPDATE anchor_batches SET status = 'confirmed' WHERE id = ?").bind(world.submitted.batchId).run();
  const third = await buildAndSubmitBatch({ confirm: false });
  await database.prepare("UPDATE anchor_batches SET status = 'submitted' WHERE id = ?").bind(world.submitted.batchId).run();
  world.third = { batchId: third.batch.id };

  const page1 = await listPublicAnchorBatches({ store, adaptersConfigured: true, query: { limit: 1, offset: 0 } });
  assert.equal(page1.status, "ok");
  assert.equal(page1.batches.length, 1);
  assert.equal(page1.batches[0].id, third.batch.id); // newest first
  assert.equal(page1.pagination.total, 3);
  assert.equal(page1.pagination.limit, 1);
  assert.equal(page1.pagination.offset, 0);

  const page2 = await listPublicAnchorBatches({ store, adaptersConfigured: true, query: { limit: 1, offset: 1 } });
  assert.equal(page2.batches[0].id, world.submitted.batchId);
  assert.equal(page2.pagination.total, 3);

  const everything = await listPublicAnchorBatches({ store, adaptersConfigured: true, query: { limit: 200 } });
  assert.equal(everything.batches.length, 3);
  assert.equal(everything.pagination.total, 3);
  // 默认值：limit 50
  const defaults = await listPublicAnchorBatches({ store, adaptersConfigured: true });
  assert.equal(defaults.pagination.limit, 50);
  assert.equal(defaults.pagination.offset, 0);
});

test("batch list filters by status and rejects invalid queries", async () => {
  const world = globalThis.anchorWorld;
  const confirmed = await listPublicAnchorBatches({ store, adaptersConfigured: true, query: { status: "confirmed" } });
  assert.equal(confirmed.batches.length, 1);
  assert.equal(confirmed.batches[0].id, world.confirmed.batchId);
  assert.equal(confirmed.pagination.total, 1);

  const submitted = await listPublicAnchorBatches({ store, adaptersConfigured: true, query: { status: "submitted", limit: 1, offset: 1 } });
  assert.equal(submitted.batches.length, 1);
  assert.equal(submitted.pagination.total, 2);

  const combined = await listPublicAnchorBatches({ store, adaptersConfigured: true, query: { status: "submitted", limit: 1, offset: 0 } });
  assert.equal(combined.batches[0].id, world.third.batchId);

  for (const bad of [{ status: "bogus" }, { limit: 0 }, { limit: 201 }, { limit: "abc" }, { offset: -1 }]) {
    await assert.rejects(
      () => listPublicAnchorBatches({ store, adaptersConfigured: true, query: bad }),
      AnchorListQueryError,
    );
  }
});

test("batch summary derives witness_state from ANCHOR_WITNESS_THRESHOLD", async () => {
  const world = globalThis.anchorWorld;
  // 默认 K=1：confirmed 批次 witness_count=1 → witnessed；submitted/third count=0 → none
  const list = await listPublicAnchorBatches({ store, adaptersConfigured: true, witnessThreshold: 1 });
  const confirmed = list.batches.find((batch) => batch.id === world.confirmed.batchId);
  const submitted = list.batches.find((batch) => batch.id === world.submitted.batchId);
  assert.equal(confirmed.witnessState, "witnessed");
  assert.equal(submitted.witnessState, "none");
  assert.deepEqual(Object.keys(confirmed).sort(), [
    "anchoredAt", "chain", "createdAt", "id", "leafCount", "manifestHash",
    "network", "prevBatchId", "prevRoot", "root", "status", "witnessCount", "witnessState",
  ]);

  // K=2：count=1 也不再是 witnessed
  const strict = await listPublicAnchorBatches({ store, adaptersConfigured: true, witnessThreshold: 2 });
  assert.equal(strict.batches.find((batch) => batch.id === world.confirmed.batchId).witnessState, "none");

  // 见证状态筛选
  const witnessed = await listPublicAnchorBatches({ store, adaptersConfigured: true, witnessThreshold: 1, query: { witnessState: "witnessed" } });
  assert.deepEqual(witnessed.batches.map((batch) => batch.id), [world.confirmed.batchId]);
  assert.equal(witnessed.pagination.total, 1);
  const none = await listPublicAnchorBatches({ store, adaptersConfigured: true, witnessThreshold: 1, query: { witnessState: "none" } });
  assert.equal(none.pagination.total, 2);
  await assert.rejects(
    () => listPublicAnchorBatches({ store, adaptersConfigured: true, query: { witnessState: "bogus" } }),
    AnchorListQueryError,
  );
});

test("witness threshold parses env values with safe fallback", () => {
  assert.equal(witnessThresholdFromSettings(undefined), 1);
  assert.equal(witnessThresholdFromSettings("3"), 3);
  assert.equal(witnessThresholdFromSettings("0"), 0);
  assert.equal(witnessThresholdFromSettings("abc"), 1);
  assert.equal(witnessThresholdFromSettings("-2"), 1);
  assert.equal(witnessThresholdFromSettings("1.5"), 1);
});

test("manifest is served from the bucket when it matches the batch", async () => {
  const world = globalThis.anchorWorld;
  const result = await loadAnchorManifest({
    store, bucket, batchId: world.confirmed.batchId, adaptersConfigured: true,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.source, "bucket");
  assert.deepEqual(result.manifest, world.confirmed.manifest);
});

test("manifest is rebuilt from the batch row and leaves when the bucket is unavailable", async () => {
  const world = globalThis.anchorWorld;
  const result = await loadAnchorManifest({
    store, bucket: undefined, batchId: world.confirmed.batchId, adaptersConfigured: true,
  });
  assert.equal(result.status, "ok");
  assert.equal(result.source, "rebuilt");
  assert.deepEqual(result.manifest, world.confirmed.manifest);
});

test("a corrupt or foreign bucket object falls back to the rebuilt manifest", async () => {
  const world = globalThis.anchorWorld;
  const corrupt = await loadAnchorManifest({
    store, bucket: { get: async () => "not-json{{" }, batchId: world.confirmed.batchId, adaptersConfigured: true,
  });
  assert.equal(corrupt.status, "ok");
  assert.equal(corrupt.source, "rebuilt");

  const foreign = await loadAnchorManifest({
    store,
    bucket: {
      get: async () => JSON.stringify({ ...world.confirmed.manifest, root: `sha256:${"9".repeat(64)}` }),
    },
    batchId: world.confirmed.batchId,
    adaptersConfigured: true,
  });
  assert.equal(foreign.status, "ok");
  assert.equal(foreign.source, "rebuilt");
  assert.deepEqual(foreign.manifest, world.confirmed.manifest);
});

test("proof for a confirmed batch is pending with a verifying inclusion proof and submission evidence", async () => {
  const world = globalThis.anchorWorld;
  const leafHash = await anchorLeafHash({
    protocolVersion: "pw-anchor-leaf-v1",
    recordType: "contribution_receipt",
    recordId: "receipt:api-a",
    recordHash: world.confirmed.recordHashes.a,
  });
  const result = await computeAnchorProof(proofRequest({ recordHash: world.confirmed.recordHashes.a }));
  assert.equal(result.status, "pending");
  assert.equal(result.leafHash, leafHash);
  assert.deepEqual(result.leaf, {
    recordType: "contribution_receipt",
    recordId: "receipt:api-a",
    recordHash: world.confirmed.recordHashes.a,
  });
  assert.equal(result.root, world.confirmed.batch.root);
  assert.equal(typeof result.proof, "object");
  assert.equal(
    await verifyInclusionProof(leafHash, result.proof, world.confirmed.batch.root),
    true,
  );
  assert.equal(result.batch.id, world.confirmed.batchId);
  assert.equal(result.batch.status, "confirmed");
  assert.equal(result.batch.chain, "mock");
  assert.equal(result.batch.network, "local");
  assert.ok(result.batch.txRefs.includes(world.confirmed.platformTxRef));
  assert.ok(result.batch.txRefs.includes(world.confirmed.witnessTxRef));
  const witness = result.submissions.find((submission) => submission.submitterKind === "witness");
  assert.equal(witness.submitterId, "person:api-witness");
  assert.equal(witness.status, "confirmed");
  assert.equal(witness.txRef, world.confirmed.witnessTxRef);
  assert.ok(result.submissions.some((submission) => submission.submitterKind === "platform"));
});

test("proof for a submitted (unconfirmed) batch is pending without a proof", async () => {
  const world = globalThis.anchorWorld;
  const result = await computeAnchorProof(proofRequest({
    recordId: "receipt:api-c",
    recordHash: world.submitted.recordHash,
  }));
  assert.equal(result.status, "pending");
  assert.equal(result.proof, undefined);
  assert.equal(result.batch.status, "submitted");
  assert.equal(result.root, world.submitted.batch.root);
});

test("proof for an unenqueued record is not_found", async () => {
  const result = await computeAnchorProof(proofRequest({
    recordId: "receipt:never-enqueued",
    recordHash: `sha256:${"1".repeat(64)}`,
  }));
  assert.deepEqual(result, { status: "not_found" });
});

test("witness authority candidates are derived from a valid delegation and active keys", async () => {
  const [personKey, agentKey] = await Promise.all([
    crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
    crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]),
  ]);
  const [personRaw, agentRaw] = await Promise.all([
    crypto.subtle.exportKey("raw", personKey.publicKey),
    crypto.subtle.exportKey("raw", agentKey.publicKey),
  ]);
  const profile = {
    person: { id: "person:api-witness", displayName: "API Witness" },
    signingKeys: [
      { id: "person-key:1", algorithm: "ed25519", publicKey: base64Url(personRaw), revokedAt: null },
      { id: "person-key:2", algorithm: "ed25519", publicKey: base64Url(personRaw), revokedAt: "2026-02-01T00:00:00.000Z" },
    ],
    agents: [
      { id: "agent:api-witness", publicKey: base64Url(agentRaw), status: "active", revokedAt: null },
      { id: "agent:revoked", publicKey: base64Url(agentRaw), status: "active", revokedAt: null },
    ],
    delegations: [
      delegationFixture({ id: "delegation:live", agentId: "agent:api-witness", agentPublicKey: base64Url(agentRaw) }),
      delegationFixture({
        id: "delegation:revoked", agentId: "agent:revoked", agentPublicKey: base64Url(agentRaw),
        revokedAt: "2026-02-01T00:00:00.000Z",
      }),
      delegationFixture({
        id: "delegation:expired", agentId: "agent:expired", agentPublicKey: base64Url(agentRaw),
        validUntil: "2026-02-01T00:00:00Z",
      }),
    ],
  };
  const candidates = witnessAuthorityCandidatesFromProfile({ profile, now: fixedNow });
  assert.deepEqual(candidates.map((candidate) => candidate.submitterId).sort(), [
    "agent:api-witness",
    "person:api-witness",
  ]);

  const verifier = createWitnessAuthorityVerifier({ candidates });
  const payload = anchorWitnessSigningPayload({
    batchId: "anchor-batch:1",
    root: `sha256:${"2".repeat(64)}`,
    manifestHash: `sha256:${"3".repeat(64)}`,
    txRef: "mock:local:tx-1",
  });
  const agentAuthority = await verifier({
    payload,
    signature: await signAnchorWitness(payload, agentKey.privateKey),
  });
  assert.deepEqual(agentAuthority, { submitterId: "agent:api-witness", publicKey: base64Url(agentRaw) });

  const personAuthority = await verifier({
    payload,
    signature: await signAnchorWitness(payload, personKey.privateKey),
  });
  assert.deepEqual(personAuthority, { submitterId: "person:api-witness", publicKey: base64Url(personRaw) });

  const stranger = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  await assert.rejects(
    async () => verifier({ payload, signature: await signAnchorWitness(payload, stranger.privateKey) }),
    WitnessAuthorityError,
  );
  await assert.rejects(() => verifier({ payload, signature: "not-a-signature" }), WitnessAuthorityError);
});

test("a profile without any valid delegation yields no witness authority", async () => {
  const key = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const raw = await crypto.subtle.exportKey("raw", key.publicKey);
  const profile = {
    person: { id: "person:no-delegation", displayName: "No Delegation" },
    signingKeys: [{ id: "person-key:1", algorithm: "ed25519", publicKey: base64Url(raw), revokedAt: null }],
    agents: [{ id: "agent:no-delegation", publicKey: base64Url(raw), status: "active", revokedAt: null }],
    delegations: [delegationFixture({
      id: "delegation:expired",
      agentId: "agent:no-delegation",
      agentPublicKey: base64Url(raw),
      validUntil: "2026-02-01T00:00:00Z",
    })],
  };
  const candidates = witnessAuthorityCandidatesFromProfile({ profile, now: fixedNow });
  assert.deepEqual(candidates, []);
  const verifier = createWitnessAuthorityVerifier({ candidates });
  const payload = anchorWitnessSigningPayload({
    batchId: "anchor-batch:1",
    root: `sha256:${"2".repeat(64)}`,
    manifestHash: `sha256:${"3".repeat(64)}`,
    txRef: "mock:local:tx-1",
  });
  await assert.rejects(
    async () => verifier({ payload, signature: await signAnchorWitness(payload, key.privateKey) }),
    WitnessAuthorityError,
  );
});

test("witness target resolution maps unknown batches and unconfigured adapters", async () => {
  const world = globalThis.anchorWorld;
  const unknown = await resolveWitnessSubmissionTarget({
    store, registry: null, batchId: "anchor-batch:missing",
  });
  assert.deepEqual(unknown, { status: "unknown_batch" });
  const unconfigured = await resolveWitnessSubmissionTarget({
    store, registry: null, batchId: world.confirmed.batchId,
  });
  assert.deepEqual(unconfigured, { status: "adapter_not_configured" });
  const wrongChain = await resolveWitnessSubmissionTarget({
    store, registry: new Map([["evm:mainnet", {}]]), batchId: world.confirmed.batchId,
  });
  assert.deepEqual(wrongChain, { status: "adapter_not_configured" });
  const ok = await resolveWitnessSubmissionTarget({
    store, registry: new Map([["mock:local", { id: "mock" }]]), batchId: world.confirmed.batchId,
  });
  assert.equal(ok.status, "ok");
  assert.equal(ok.batch.id, world.confirmed.batchId);
  assert.deepEqual(ok.adapter, { id: "mock" });
});

test("adapter registry is built from ANCHOR_ADAPTERS_JSON with strict validation", async () => {
  assert.equal(await buildAnchorAdapterRegistry(undefined), null);
  assert.equal(await buildAnchorAdapterRegistry(""), null);
  assert.equal(await buildAnchorAdapterRegistry("   "), null);
  await assert.rejects(
    () => buildAnchorAdapterRegistry("not-json"),
    AnchorAdapterConfigurationError,
  );
  await assert.rejects(
    () => buildAnchorAdapterRegistry('{"id":"evm"}'),
    AnchorAdapterConfigurationError,
  );
  await assert.rejects(
    () => buildAnchorAdapterRegistry('[{"id":"unknown-adapter","network":"x"}]'),
    AnchorAdapterConfigurationError,
  );
  const registry = await buildAnchorAdapterRegistry(
    '[{"id":"evm","network":"base-sepolia","rpcUrl":"https://example.invalid","sinkAddress":"0x1","operatorPrivateKeyJwk":{}}]',
    { evm: (config) => ({ id: "evm", network: config.network }) },
  );
  assert.ok(registry instanceof Map);
  assert.deepEqual(registry.get("evm:base-sepolia"), { id: "evm", network: "base-sepolia" });
});

test("coordinator settings parse env values with safe defaults", () => {
  assert.deepEqual(anchorCoordinatorConfigFromSettings({}), {
    minLeafCount: 100,
    maxIntervalSeconds: 86_400,
    confirmationThreshold: 12,
  });
  assert.deepEqual(
    anchorCoordinatorConfigFromSettings({
      ANCHOR_BATCH_MIN_LEAVES: "7",
      ANCHOR_BATCH_MAX_INTERVAL_SECONDS: "3600",
      ANCHOR_CONFIRMATION_THRESHOLD: "3",
    }),
    { minLeafCount: 7, maxIntervalSeconds: 3600, confirmationThreshold: 3 },
  );
  assert.deepEqual(
    anchorCoordinatorConfigFromSettings({
      ANCHOR_BATCH_MIN_LEAVES: "-5",
      ANCHOR_BATCH_MAX_INTERVAL_SECONDS: "zero",
      ANCHOR_CONFIRMATION_THRESHOLD: "0",
    }),
    { minLeafCount: 100, maxIntervalSeconds: 86_400, confirmationThreshold: 12 },
  );
});

test("coordinator rejection reasons map to exact HTTP statuses and codes", () => {
  assert.equal(witnessRejectionHttpStatus("invalid_signature"), 400);
  assert.equal(witnessRejectionHttpStatus("payload_mismatch"), 400);
  assert.equal(witnessRejectionHttpStatus("invalid_txref"), 400);
  assert.equal(witnessRejectionHttpStatus("network_mismatch"), 400);
  assert.equal(witnessRejectionHttpStatus("chain_truth_mismatch"), 400);
  assert.equal(witnessRejectionHttpStatus("not_independent"), 403);
  assert.equal(witnessRejectionHttpStatus("batch_failed"), 404);
  assert.equal(witnessRejectionHttpStatus("unknown_batch"), 404);
  assert.equal(witnessRejectionErrorCode("network_mismatch"), "chain_mismatch");
  assert.equal(witnessRejectionErrorCode("not_independent"), "not_independent");
  assert.equal(witnessRejectionErrorCode("something_else"), "invalid_request");
});

test("volatile manifest storage round-trips content-addressed manifests", async () => {
  const storage = createVolatileManifestStorage();
  const manifest = {
    protocolVersion: "pw-anchor-manifest-v1",
    batchId: "anchor-batch:volatile",
    root: `sha256:${"4".repeat(64)}`,
    leafCount: 1,
    prevBatchId: null,
    prevRoot: null,
    createdAt: "2026-10-14T00:00:00.000Z",
    leaves: [{
      recordType: "contribution_receipt",
      recordId: "receipt:volatile",
      recordHash: `sha256:${"5".repeat(64)}`,
    }],
  };
  const stored = await storage.put(manifest);
  assert.equal(stored.key, `volatile/${stored.manifestHash}`);
  const readBack = await storage.get(stored.key);
  const parsed = JSON.parse(new TextDecoder().decode(readBack));
  assert.deepEqual(parsed, manifest);
  assert.equal(await storage.get("volatile/missing"), null);
});

function delegationFixture(overrides = {}) {
  return {
    id: "delegation:fixture",
    agentId: "agent:api-witness",
    agentPublicKey: `sha256:${"6".repeat(64)}`,
    scopes: ["prove"],
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    beneficiaryPersonId: "person:api-witness",
    revokedAt: null,
    signerKeyRevokedAt: null,
    ...overrides,
  };
}

function base64Url(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
