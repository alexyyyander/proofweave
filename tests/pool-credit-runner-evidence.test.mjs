import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { D1PoolCreditSettlement } from "../services/credits/d1-pool-credit-settlement.mjs";
import { canonicalJson, sha256Canonical } from "../packages/protocol/canonical-json.mjs";
import { signLeanRunnerResult } from "../packages/protocol/lean-runner.mjs";
import { runnerKeyFingerprint } from "../packages/protocol/runner-key-registry.mjs";

test("synthetic Runner evidence requires a trusted real signature and matches the exact attempt and Bundle", async (t) => {
  const db = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  t.after(() => db.close());
  for (const sql of [
    "CREATE TABLE runs (id TEXT, state TEXT, attempt_id TEXT, artifact_bundle_hash TEXT, request_hash TEXT, runner_result_hash TEXT)",
    "CREATE TABLE run_results (run_id TEXT, result_hash TEXT, canonical_result TEXT)",
    "CREATE TABLE runner_keys (id TEXT, public_key TEXT, fingerprint TEXT, status TEXT, revoked_at TEXT)",
    "CREATE TABLE runner_output_artifacts (run_id TEXT, role TEXT, content_hash TEXT)",
  ]) await db.prepare(sql).run();
  const sha = (digit) => `sha256:${digit.repeat(64)}`;
  const keys = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("base64url");
  const result = await signLeanRunnerResult({ runnerPrivateKey: keys.privateKey, result: {
    protocolVersion: "pw-lean-runner-v1", jobId: "run:synthetic", attemptId: "attempt:synthetic", requestHash: sha("a"),
    runnerKeyId: "runner:synthetic", status: "succeeded", exitCode: 0, startedAt: "2026-07-01T00:00:00Z", finishedAt: "2026-07-01T00:00:01Z",
    kernelStatus: "accepted", checks: { network: "passed", noSorry: "passed", allowedAxioms: "passed", leanBuild: "passed" },
    artifacts: { manifestHash: sha("e"), stdoutHash: sha("c"), stderrHash: sha("d") },
  } });
  const hash = await sha256Canonical(result);
  await db.prepare("INSERT INTO runs VALUES (?, 'succeeded', ?, ?, ?, ?)").bind(result.jobId, result.attemptId, sha("e"), result.requestHash, hash).run();
  await db.prepare("INSERT INTO run_results VALUES (?, ?, ?)").bind(result.jobId, hash, canonicalJson(result)).run();
  await db.prepare("INSERT INTO runner_keys VALUES (?, ?, ?, 'active', NULL)").bind(result.runnerKeyId, publicKey, await runnerKeyFingerprint(publicKey)).run();
  for (const [role, digest] of [["stdout", sha("c")], ["stderr", sha("d")]]) await db.prepare("INSERT INTO runner_output_artifacts VALUES (?, ?, ?)").bind(result.jobId, role, digest).run();
  const store = new D1PoolCreditSettlement(db);
  await store.verifyRun(result.jobId, hash, result.requestHash, result.attemptId, sha("e"));
  await assert.rejects(store.verifyRun(result.jobId, hash, result.requestHash, "attempt:other", sha("e")), /does not match/);
  await assert.rejects(store.verifyRun(result.jobId, hash, result.requestHash, result.attemptId, sha("f")), /does not match/);
  const unsigned = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "runnerSignature"));
  const wrongManifest = await signLeanRunnerResult({ runnerPrivateKey: keys.privateKey, result: { ...unsigned, artifacts: { ...unsigned.artifacts, manifestHash: sha("f") } } });
  const wrongHash = await sha256Canonical(wrongManifest);
  await db.prepare("UPDATE runs SET runner_result_hash = ? WHERE id = ?").bind(wrongHash, result.jobId).run();
  await db.prepare("UPDATE run_results SET result_hash = ?, canonical_result = ? WHERE run_id = ?").bind(wrongHash, canonicalJson(wrongManifest), result.jobId).run();
  await assert.rejects(store.verifyRun(result.jobId, wrongHash, result.requestHash, result.attemptId, sha("e")), /does not match/);
  await db.prepare("UPDATE runs SET runner_result_hash = ? WHERE id = ?").bind(hash, result.jobId).run();
  await db.prepare("UPDATE run_results SET result_hash = ?, canonical_result = ? WHERE run_id = ?").bind(hash, canonicalJson(result), result.jobId).run();
  await db.prepare("UPDATE runner_keys SET status = 'revoked' WHERE id = ?").bind(result.runnerKeyId).run();
  await assert.rejects(store.verifyRun(result.jobId, hash, result.requestHash, result.attemptId, sha("e")), /not an active allowlisted key/);
});
