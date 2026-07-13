import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const snapshotPath = new URL(
  "../../data/formal-conjectures/bench-v1-lean4.27.0.json",
  import.meta.url,
);
const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
const sha256 = /^sha256:[a-f0-9]{64}$/;

assert.equal(snapshot.schemaVersion, 1, "unsupported snapshot schema version");
assert.match(snapshot.snapshot.revisionTag, /^bench-v\d+-lean4\.\d+\.\d+$/);
assert.match(snapshot.snapshot.revisionCommit, /^[a-f0-9]{40}$/);
assert.match(snapshot.snapshot.contentHash, sha256);
assert.match(snapshot.snapshot.manifestHash, sha256);
assert.equal(snapshot.project.kind, "frontier");
assert.ok(snapshot.records.length > 0, "snapshot has no catalog records");

for (const record of snapshot.records) {
  assert.match(record.id, /^problem-revision:/);
  assert.match(record.targetKey, /^erdos-865-/);
  assert.match(record.declaration.id, /^declaration:/);
  assert.match(record.declaration.sourceContentHash, sha256);
  assert.ok(record.declaration.sourceUrl.includes(snapshot.snapshot.revisionCommit));
  assert.equal(record.proofState, "admitted");
}

console.log(
  `Verified ${snapshot.records.length} declarations from ${snapshot.snapshot.revisionTag}.`,
);
