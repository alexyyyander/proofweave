import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const catalogDirectory = new URL("../../data/formal-conjectures/", import.meta.url);
const filenames = (await readdir(catalogDirectory))
  .filter((filename) => filename.endsWith(".json"))
  .sort();
const sha256 = /^sha256:[a-f0-9]{64}$/;
let declarationCount = 0;

assert.ok(filenames.length > 0, "no Formal Conjectures snapshots found");

for (const filename of filenames) {
  const snapshot = JSON.parse(await readFile(new URL(filename, catalogDirectory), "utf8"));
  verifySnapshot(snapshot, filename);
}

console.log(`Verified ${declarationCount} declarations across ${filenames.length} pinned snapshots.`);

function verifySnapshot(catalog, filename) {
  assert.ok([1, 2].includes(catalog.schemaVersion), `${filename}: unsupported schema version`);
  assert.match(catalog.snapshot.revisionCommit, /^[a-f0-9]{40}$/);
  assert.match(catalog.snapshot.contentHash, sha256);
  assert.match(catalog.snapshot.manifestHash, sha256);
  assert.ok(catalog.snapshot.sourceUrl.includes(catalog.snapshot.revisionCommit));
  assert.match(catalog.snapshot.leanToolchain, /^leanprover\/lean4:v\d+\.\d+\.\d+$/);
  assert.match(catalog.snapshot.mathlibRevision, /^[a-f0-9]{40}$/);

  if (catalog.schemaVersion === 1) {
    verifyLegacySnapshot(catalog, filename);
    return;
  }

  verifyFocusSnapshot(catalog, filename);
}

function verifyLegacySnapshot(catalog, filename) {
  assert.match(catalog.snapshot.revisionTag, /^bench-v\d+-lean4\.\d+\.\d+$/);
  assert.equal(catalog.project.kind, "frontier");
  assert.ok(catalog.records.length > 0, `${filename}: snapshot has no catalog records`);

  for (const record of catalog.records) {
    assert.match(record.id, /^problem-revision:/);
    assert.match(record.targetKey, /^erdos-865-/);
    verifyDeclaration(record, catalog.snapshot, null, filename);
  }
}

function verifyFocusSnapshot(catalog, filename) {
  assert.match(catalog.snapshot.revisionTag, /^curated-(?:focus|expansion)-v\d+-lean4\.\d+\.\d+$/);
  assert.ok(Array.isArray(catalog.snapshot.manifest));
  assert.ok(catalog.snapshot.manifest.length > 0, `${filename}: manifest is empty`);

  const manifest = new Map();
  for (const file of catalog.snapshot.manifest) {
    assert.ok(!manifest.has(file.path), `${filename}: duplicate manifest path ${file.path}`);
    assert.match(file.hash, sha256);
    manifest.set(file.path, file.hash);
  }

  const subjects = new Map();
  for (const subject of catalog.subjects) {
    assert.match(subject.id, /^subject:ams-\d{2}$/);
    assert.match(subject.amsCode, /^\d{2}$/);
    assert.ok(!subjects.has(subject.slug), `${filename}: duplicate subject ${subject.slug}`);
    subjects.set(subject.slug, subject);
  }

  const collections = new Map();
  for (const collection of catalog.collections) {
    assert.ok(["founding", "grand"].includes(collection.tier));
    assert.ok(!collections.has(collection.slug), `${filename}: duplicate collection ${collection.slug}`);
    collections.set(collection.slug, collection);
  }

  const records = catalog.projects.flatMap((project) => {
    assert.equal(project.kind, "frontier");
    assert.equal(project.visibility, "public");
    assert.ok(project.records.length > 0, `${filename}: empty project ${project.slug}`);
    return project.records;
  });
  assert.ok(records.length > 0, `${filename}: snapshot has no curated records`);

  const slugs = new Set();
  const declaredSourcePaths = new Set();
  for (const record of records) {
    assert.ok(!slugs.has(record.slug), `${filename}: duplicate record slug ${record.slug}`);
    slugs.add(record.slug);
    verifyMembership(record, subjects, collections, filename);
    verifyDeclaration(record, catalog.snapshot, manifest, filename);
    declaredSourcePaths.add(record.declaration.sourcePath);
  }
  assert.deepEqual(
    [...manifest.keys()].sort(),
    [...declaredSourcePaths].sort(),
    `${filename}: manifest must exactly cover the declared source files`,
  );

  for (const record of catalog.existingRecords ?? []) {
    assert.match(record.problemRevisionId, /^problem-revision:/);
    verifyMembership(record, subjects, collections, filename);
  }
}

function verifyMembership(record, subjects, collections, filename) {
  assert.ok(record.subjects.length > 0, `${filename}: ${record.slug ?? record.problemRevisionId} has no subject`);
  assert.equal(
    record.subjects.filter((subject) => subject.isPrimary).length,
    1,
    `${filename}: each record needs exactly one primary subject`,
  );
  for (const subject of record.subjects) {
    assert.ok(subjects.has(subject.slug), `${filename}: unknown subject ${subject.slug}`);
  }
  assert.ok(collections.has(record.collection.slug), `${filename}: unknown collection ${record.collection.slug}`);
  assert.ok(["headline", "milestone"].includes(record.collection.role));
}

function verifyDeclaration(record, snapshot, manifest, filename) {
  assert.match(record.id, /^problem-revision:/);
  assert.match(record.targetKey, /^[a-z0-9-]+$/);
  assert.match(record.declaration.id, /^declaration:/);
  assert.match(record.declaration.sourceContentHash, sha256);
  assert.equal(record.proofState, "admitted");
  assert.equal(record.sourceCorrespondence, "imported_unreviewed");
  assert.ok(record.leanStatement.includes("sorry"));
  assert.ok(record.declaration.sourceLineStart > 0);
  assert.ok(record.declaration.sourceLineEnd >= record.declaration.sourceLineStart);

  if (manifest) {
    assert.equal(
      manifest.get(record.declaration.sourcePath),
      record.declaration.sourceContentHash,
      `${filename}: declaration hash is not pinned by the manifest`,
    );
  } else {
    assert.ok(record.declaration.sourceUrl.includes(snapshot.revisionCommit));
  }
  declarationCount += 1;
}
