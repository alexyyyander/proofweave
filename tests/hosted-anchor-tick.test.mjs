import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { withAnchorTickLease } from "../services/anchoring/anchor-tick-lease.mjs";
import { runHostedAnchorTick, anchorTickAuthorized } from "../services/anchoring/hosted-anchor-tick.mjs";
import { createMockAnchorAdapter } from "../services/anchoring/mock-anchor-adapter.mjs";
import { researchCheckpointHash, researchCheckpointPayloadHash, researchCheckpointSigningPayload } from "../packages/protocol/research-checkpoint.mjs";
import { canonicalJson } from "../packages/protocol/canonical-json.mjs";
async function setup(t) {
 const db = new LibsqlD1Database(createClient({ url: "file::memory:" })); t.after(() => db.close());
 for (const name of ["0046_add_anchor_tables.sql", "0047_add_anchor_tick_lease.sql", "0048_add_anchor_submission_outbox.sql"]) {
  for (const sql of (await readFile(new URL(`../drizzle/${name}`, import.meta.url), "utf8")).split("--> statement-breakpoint").filter(s=>s.trim())) await db.prepare(sql).run();
 }
 for (const sql of [
  "CREATE TABLE projects (id TEXT, visibility TEXT)",
  "CREATE TABLE problem_revisions (id TEXT, project_id TEXT)",
  "CREATE TABLE research_nodes (id TEXT, checkpoint_hash TEXT, canonical_checkpoint TEXT, agent_event_occurred_at TEXT, problem_revision_id TEXT, artifact_bundle_manifest_hash TEXT)",
  "CREATE TABLE contribution_receipts (id TEXT, receipt_hash TEXT, canonical_receipt TEXT, issued_at TEXT, artifact_bundle_manifest_hash TEXT)",
  "CREATE TABLE contribution_receipt_publications (receipt_id TEXT, record_class TEXT, visibility TEXT)",
  "CREATE TABLE artifact_bundles (id TEXT, manifest_hash TEXT, canonical_manifest TEXT, created_at TEXT)",
 ]) await db.prepare(sql).run();
 return db;
}
test("tick rejects missing and incorrect credentials", () => {
 const token = "x".repeat(48);
 assert.equal(anchorTickAuthorized(null, token), false);
 assert.equal(anchorTickAuthorized("Bearer " + "y".repeat(48), token), false);
 assert.equal(anchorTickAuthorized("Bearer " + token, token), true);
 assert.equal(anchorTickAuthorized("Bearer undefined", undefined), false);
});
test("overlapping ticks are excluded and stale owners cannot renew", async t => {
 const db = await setup(t); let time = 100;
 await withAnchorTickLease(db, async renew => {
  assert.equal((await withAnchorTickLease(db, () => assert.fail("overlap"), {now:()=>time})).summary.status, "busy");
  time += 700000;
  await withAnchorTickLease(db, async () => { await assert.rejects(renew, /expired/); }, {now:()=>time});
 }, {now:()=>time});
 assert.equal((await db.prepare("SELECT count(*) n FROM anchor_tick_leases").first()).n, 0);
});
test("hosted tick anchors signed public checkpoint, excludes internal records and repeats idempotently", async t => {
 const database = await setup(t);
 const pair = await crypto.subtle.generateKey({name:"Ed25519"}, true, ["sign","verify"]);
 const cp = await signedCheckpoint(pair.privateKey, base64Url(await crypto.subtle.exportKey("raw",pair.publicKey)));
 await database.prepare("INSERT INTO projects VALUES ('project:test','public')").run();
 await database.prepare("INSERT INTO problem_revisions VALUES ('revision:test','project:test')").run();
 await database.prepare("INSERT INTO research_nodes VALUES (?,?,?,?,?,NULL)").bind(cp.id,await researchCheckpointHash(cp),JSON.stringify(cp),cp.agentEvent.occurredAt,cp.problemRevisionId).run();
 await database.prepare("INSERT INTO contribution_receipts VALUES ('private', 'not-a-hash', '{}', 'today', NULL)").run();
 await database.prepare("INSERT INTO contribution_receipt_publications VALUES ('private','smoke_test','internal')").run();
 await database.prepare("INSERT INTO artifact_bundles VALUES ('staged', 'not-a-hash', '{}', 'today')").run();
 const objects = new Map(); const adapter = createMockAnchorAdapter(); let submits=0;
 const broadcast = adapter.broadcastPreparedRoot; adapter.broadcastPreparedRoot = async (p, payload) => {submits++; return broadcast(p, payload);};
 const options = {database, registry:new Map([["mock:local",adapter]]),bucket:{put:async(k,v)=>objects.set(k,v),get:async k=>objects.get(k)},config:{minLeafCount:100,maxIntervalSeconds:86400,confirmationThreshold:12}};
 const first = await runHostedAnchorTick(options);
 assert.equal(first.summary.enqueued,1); assert.equal(first.summary.leafCount,1);
 assert.equal(first.summary.manifestStorage,"r2"); assert.equal(objects.size,1);
 assert.equal((await runHostedAnchorTick(options)).summary.enqueued,0); assert.equal(submits,1);
 await assert.rejects(()=>runHostedAnchorTick({...options,bucket:null}),/Durable/);
 await database.prepare("UPDATE research_nodes SET checkpoint_hash = ?").bind("sha256:" + "0".repeat(64)).run();
 await assert.rejects(()=>runHostedAnchorTick(options), /integrity/); assert.equal(submits,1);
});
async function signedCheckpoint(privateKey, publicKey, overrides = {}) {
  const checkpoint = {
    protocolVersion: "pw-research-checkpoint-v1",
    id: "research-node:test",
    attemptId: "attempt:test",
    problemRevisionId: "revision:test",
    kind: "lemma",
    summary: "Reduced the target to a reusable bounded lemma.",
    parentNodeIds: [],
    proofStateHash: null,
    artifactBundleHash: null,
    citations: [],
    agentEvent: {
      id: "research-checkpoint-event:test",
      agentId: "agent:test",
      agentPublicKey: publicKey,
      occurredAt: "2026-07-15T00:00:00Z",
      signature: "A".repeat(86),
    },
    payloadHash: `sha256:${"0".repeat(64)}`,
    ...overrides,
  };
  checkpoint.payloadHash = await researchCheckpointPayloadHash(checkpoint);
  checkpoint.agentEvent.signature = base64Url(await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(canonicalJson(researchCheckpointSigningPayload(checkpoint))),
  ));
  return checkpoint;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}
