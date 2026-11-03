import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { tursoDatabaseFingerprint } from "../db/control-plane-authority.mjs";
import { executePoolCreditOperator } from "../scripts/lib/pool-credit-operator.mjs";

const url = "libsql://synthetic.example.test", fingerprint = tursoDatabaseFingerprint(url), revision = "a".repeat(40);
const environment = { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "synthetic-test-token-only" };
const common = ["--pool-id", "pool:synthetic", "--receipt-id", "receipt:synthetic", "--database-fingerprint", fingerprint, "--source-revision", revision];
const digest = `sha256:${"c".repeat(64)}`;
const signature = Buffer.alloc(64).toString("base64url");
const adjudication = { payload: { protocolVersion: "pw-pool-finality-v1", poolId: "pool:synthetic", problemRevisionId: "revision:synthetic", finalReceiptId: "receipt:synthetic", finalReceiptHash: digest, targetDeclaration: "Synthetic.target", targetStatementHash: digest, beneficiaryPersonId: "person:author", reviewerPersonId: "person:reviewer", reviewerKeyId: "key:reviewer", reviewAttestationId: "attestation:review", reviewAttestationHash: digest, reviewEvidenceHash: digest, noveltyAttestationId: "attestation:novelty", noveltyAttestationHash: digest, noveltyEvidenceHash: digest, ownerPersonId: "person:owner", ownerKeyId: "key:owner", issuedAt: "2026-07-01T00:00:00Z", decision: "original_final_result" }, reviewerSignature: signature, ownerSignature: signature };

function fixture() {
  const calls = [], db = { close() { calls.push("close"); } };
  return { calls, options: { environment, readSourceState: () => ({ revision, dirty: false }), loadAdjudication: async () => adjudication, openDatabase(config) { assert.equal(config.url, url); calls.push("open"); return db; }, createSettlement() { return { async preview(poolId, receiptId) { calls.push(["preview", poolId, receiptId]); return { plan: { payloadHash: `sha256:${"b".repeat(64)}`, reviews: [] } }; }, async lock(poolId, receiptId, input) { assert.deepEqual(input.finalityAdjudication, adjudication); calls.push(["lock", poolId, receiptId, input.expectedPlanHash]); throw new Error("finality required"); } }; } } };
}

test("operator preview requires a pinned database and clean source and exposes no credential", async () => {
  const { calls, options } = fixture();
  const result = await executePoolCreditOperator({ ...options, args: ["preview", ...common] });
  assert.equal(result.provisional, true);
  assert.equal(result.finality, "unverified");
  assert.equal(result.artifactBytes, "unverified");
  assert.equal(result.settlementEnabled, false);
  assert.equal(result.finalResultCredits, "not_allocated");
  assert.equal(result.reviewCredits, "pending_eligible_final_result_and_closure_lock");
  assert.equal(result.completedMarketReviews, 0);
  assert.deepEqual(calls, ["open", ["preview", "pool:synthetic", "receipt:synthetic"], "close"]);
  assert.equal(JSON.stringify(result).includes(environment.TURSO_AUTH_TOKEN), false);
});

test("status lists unverified review-job projections without a final Receipt and never reports them paid", async () => {
  const calls = [], statusArgs = ["status", "--pool-id", "pool:synthetic", "--database-fingerprint", fingerprint, "--source-revision", revision];
  const database = { prepare() { return { bind(id) { assert.equal(id, "pool:synthetic"); return { async all() { return { results: [
    { id: "job:done", claim_type: "novelty_reviewed", assignment_status: "completed", claim_id: "claim:one", review_decision: "rejected" },
    { id: "job:open", claim_type: "bundle_reproducible", assignment_status: null, claim_id: null, review_decision: null },
  ] }; } }; } }; }, close() { calls.push("close"); } };
  const result = await executePoolCreditOperator({ args: statusArgs, environment, readSourceState: () => ({ revision, dirty: false }), openDatabase: () => database, createSettlement: () => ({ async poolHistory() { return [{ sequence: 1, eventType: "created" }, { sequence: 2, eventType: "activated" }]; }, async readLocked() { return null; } }) });
  assert.equal(result.finalResultCredits, "not_allocated");
  assert.equal(result.reviewCredits, "pending_eligible_final_result_and_closure_lock");
  assert.equal(result.jobsAreUnverifiedProjections, true);
  assert.equal(result.artifactBytes, "unverified");
  assert.equal(result.settlementEnabled, false);
  assert.deepEqual(result.jobs.map((job) => job.projection), ["completed", "open"]);
  assert.deepEqual(result.jobs.map((job) => job.decision), ["rejected", null]);
  assert.deepEqual(calls, ["close"]);
});

test("operator rejects mismatched fingerprint, dirty source, malformed or implicit lock before connecting", async () => {
  for (const [args, override] of [
    [["preview", ...common.slice(0, 5), "0".repeat(16), ...common.slice(6)], {}],
    [["preview", ...common], { readSourceState: () => ({ revision, dirty: true }) }],
    [["lock", ...common], {}],
    [["preview", ...common, "--expected-plan-hash", `sha256:${"b".repeat(64)}`], {}],
    [["preview", ...common, "--pool-id", "pool:other"], {}],
  ]) {
    const { calls, options } = fixture();
    await assert.rejects(executePoolCreditOperator({ ...options, ...override, args }));
    assert.deepEqual(calls, []);
  }
});

test("explicit lock forwards the exact reviewed hash, closes the connection, and propagates the finality refusal", async () => {
  const { calls, options } = fixture(), hash = `sha256:${"b".repeat(64)}`;
  await assert.rejects(executePoolCreditOperator({ ...options, args: ["lock", ...common, "--expected-plan-hash", hash, "--adjudication-file", "/tmp/adjudication.json"] }), /finality required/);
  assert.deepEqual(calls, ["open", ["lock", "pool:synthetic", "receipt:synthetic", hash], "close"]);
});

test("operator rejects inherited Node options before using credentials", () => {
  const script = fileURLToPath(new URL("../scripts/pool-credit-operator.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: { PATH: process.env.PATH, NODE_OPTIONS: "--no-warnings", TURSO_AUTH_TOKEN: "must-not-appear" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNSUPPORTED_NODE_OPTIONS/);
  assert.equal(result.stderr.includes("must-not-appear"), false);
});

test("offline finality payload preparation preserves canonical bytes and rejects symlinks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pw-finality-payload-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const payloadPath = join(directory, "payload.json"), linkPath = join(directory, "link.json");
  await writeFile(payloadPath, JSON.stringify(adjudication.payload));
  await symlink(payloadPath, linkPath);
  const script = fileURLToPath(new URL("../scripts/pool-finality-payload.mjs", import.meta.url));
  const run = (path) => spawnSync(process.execPath, [script, path], { encoding: "utf8", env: { PATH: process.env.PATH } });
  const good = run(payloadPath);
  assert.equal(good.status, 0);
  const result = JSON.parse(good.stdout);
  assert.equal(result.canonicalPayload, canonicalJson(adjudication.payload));
  assert.equal(result.payloadHash, await sha256Canonical(adjudication.payload));
  const link = run(linkPath);
  assert.equal(link.status, 1);
  assert.match(link.stderr, /FINALITY_PAYLOAD_INVALID/);
});
