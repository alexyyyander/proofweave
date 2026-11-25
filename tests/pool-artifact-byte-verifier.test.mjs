import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import { D1InlineArtifactBucket } from "../services/artifacts/d1-inline-artifact-store.mjs";
import { maxArtifactObjectBytes } from "../services/artifacts/d1-r2-artifact-store.mjs";
import { verifyPoolArtifactBytes } from "../services/credits/pool-artifact-byte-verifier.mjs";

const encode = (text) => new TextEncoder().encode(text);
async function descriptor(bytes, name) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hex = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { objectKey: `bundles/sha256/${hex}/${name}`, contentHash: `sha256:${hex}`, byteLength: bytes.byteLength };
}

test("rehashes real D1 and R2 bytes, rejects missing, tampered and oversized evidence", async (t) => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-07-16", d1Databases: ["DB"], r2Buckets: ["ARTIFACTS"] });
  t.after(async () => mf.dispose());
  const db = await mf.getD1Database("DB"), remote = await mf.getR2Bucket("ARTIFACTS");
  await db.prepare("CREATE TABLE inline_artifact_bytes (object_key TEXT PRIMARY KEY, content_hash TEXT, byte_length INTEGER, content_type TEXT, bytes BLOB)").run();
  const inlineBytes = encode("synthetic Bundle bytes"), remoteBytes = encode("synthetic independent review evidence");
  const first = await descriptor(inlineBytes, "bundle.json"), second = await descriptor(remoteBytes, "review.json");
  await new D1InlineArtifactBucket(db).put(first.objectKey, inlineBytes, { customMetadata: { sha256: first.contentHash }, httpMetadata: { contentType: "application/json" } });
  await remote.put(second.objectKey, remoteBytes);
  const result = await verifyPoolArtifactBytes({ database: db, objects: [first, second], remoteBucket: remote });
  assert.equal(result.allInline, false);
  assert.deepEqual(result.objects.map((item) => item.storage), ["inline", "remote"]);
  await assert.rejects(verifyPoolArtifactBytes({ database: db, objects: [second] }), /missing/);
  await remote.put(second.objectKey, encode("x".repeat(remoteBytes.length)));
  await assert.rejects(verifyPoolArtifactBytes({ database: db, objects: [second], remoteBucket: remote }), /do not match/);
  await db.prepare("UPDATE inline_artifact_bytes SET bytes = ? WHERE object_key = ?").bind(encode("x".repeat(inlineBytes.length)), first.objectKey).run();
  await assert.rejects(verifyPoolArtifactBytes({ database: db, objects: [first], remoteBucket: remote }), /do not match/);
  await assert.rejects(verifyPoolArtifactBytes({ database: db, objects: [{ ...first, byteLength: maxArtifactObjectBytes + 1 }] }), /size limit/);
  const huge = ["a", "b", "c"].map((letter) => ({ objectKey: `bundles/sha256/${letter.repeat(64)}/huge`, contentHash: `sha256:${letter.repeat(64)}`, byteLength: maxArtifactObjectBytes }));
  await assert.rejects(verifyPoolArtifactBytes({ database: db, objects: huge }), /total size limit/);
});

test("rejects a remote stream that exceeds its claimed object length", async (t) => {
  const mf = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok'); } }", compatibilityDate: "2026-07-16", d1Databases: ["DB"] });
  t.after(async () => mf.dispose());
  const db = await mf.getD1Database("DB");
  await db.prepare("CREATE TABLE inline_artifact_bytes (object_key TEXT PRIMARY KEY, content_hash TEXT, byte_length INTEGER, content_type TEXT, bytes BLOB)").run();
  const item = await descriptor(encode("ok"), "evidence.txt");
  const remoteBucket = { async get() { return { size: 2, body: new ReadableStream({ start(controller) { controller.enqueue(encode("too long")); controller.close(); } }) }; } };
  await assert.rejects(verifyPoolArtifactBytes({ database: db, objects: [item], remoteBucket }), /exceeds its declared size/);
});
