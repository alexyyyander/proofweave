import assert from "node:assert/strict";
import test from "node:test";
import { Miniflare } from "miniflare";
import {
  D1HybridArtifactBucket,
  D1InlineArtifactBucket,
} from "../services/artifacts/d1-inline-artifact-store.mjs";

const keyFor = (character) => `bundles/sha256/${character.repeat(64)}/source.tar.zst`;

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function put(bucket, key, text) {
  const bytes = new TextEncoder().encode(text);
  return bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    httpMetadata: { contentType: "text/plain" },
    customMetadata: { sha256: await sha256(bytes) },
  });
}

async function textOf(object) {
  return new TextDecoder().decode(await object.arrayBuffer());
}

test("hybrid artifact storage keeps small objects inline and spills large objects to R2", async (t) => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: ["DB"],
    r2Buckets: ["ARTIFACTS"],
  });
  t.after(() => miniflare.dispose());
  const database = await miniflare.getD1Database("DB");
  const remote = await miniflare.getR2Bucket("ARTIFACTS");
  await database.prepare(
    "CREATE TABLE inline_artifact_bytes (object_key TEXT PRIMARY KEY, content_hash TEXT NOT NULL, byte_length INTEGER NOT NULL, content_type TEXT NOT NULL, bytes BLOB NOT NULL)",
  ).run();

  const hybrid = new D1HybridArtifactBucket({ database, bucket: remote, inlineLimit: 10 });
  const inlineKey = keyFor("a");
  const remoteKey = keyFor("b");
  assert.ok(await put(hybrid, inlineKey, "small"));
  assert.ok(await put(hybrid, remoteKey, "this object is larger than ten bytes"));

  const inlineRows = await database.prepare("SELECT object_key FROM inline_artifact_bytes ORDER BY object_key").all();
  assert.deepEqual(inlineRows.results.map((row) => row.object_key), [inlineKey]);
  assert.equal(await remote.head(inlineKey), null);
  assert.ok(await remote.head(remoteKey));
  assert.equal((await database.prepare("SELECT COUNT(*) AS count FROM inline_artifact_bytes").first("count")), 1);

  for (const [key, value] of [[inlineKey, "small"], [remoteKey, "this object is larger than ten bytes"]]) {
    const head = await hybrid.head(key);
    assert.equal(head.size, new TextEncoder().encode(value).byteLength);
    assert.equal(await textOf(await hybrid.get(key)), value);
  }

  const many = await hybrid.getMany([inlineKey, remoteKey]);
  assert.deepEqual([...many.keys()].sort(), [inlineKey, remoteKey].sort());
  assert.equal(await textOf(many.get(inlineKey)), "small");
  assert.equal(await textOf(many.get(remoteKey)), "this object is larger than ten bytes");

  const inlineOnly = new D1InlineArtifactBucket(database);
  assert.equal(await inlineOnly.head(inlineKey) === null, false);
  assert.equal(await inlineOnly.head(remoteKey), null);
});
