import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const snapshotDirectory = resolve(root, "data/formal-conjectures");
const outputPath = resolve(root, "open-catalog/catalog/problems.json");

const snapshotPaths = (await readdir(snapshotDirectory))
  .filter((filename) => filename.endsWith(".json"))
  .sort()
  .map((filename) => resolve(snapshotDirectory, filename));
const snapshots = await Promise.all(snapshotPaths.map(readJson));
const existingMetadata = new Map(
  snapshots
    .filter((snapshot) => snapshot.schemaVersion === 2)
    .flatMap((snapshot) => snapshot.existingRecords ?? [])
    .map((record) => [record.problemRevisionId, record]),
);

const records = snapshots.flatMap((catalog) => {
  if (catalog.schemaVersion === 1) {
    return catalog.records.map((record) => toPublicRecord({
      record,
      project: catalog.project,
      snapshot: catalog.snapshot,
      metadata: existingMetadata.get(record.id),
    }));
  }

  return catalog.projects.flatMap((project) => project.records.map((record) => toPublicRecord({
    record,
    project,
    snapshot: catalog.snapshot,
    metadata: record,
  })));
}).sort((left, right) => right.priority - left.priority || left.slug.localeCompare(right.slug));

const output = {
  schemaVersion: 1,
  catalog: {
    name: "Proofweave Open Catalog",
    generatedAt: "2026-07-16T00:00:00Z",
    recordCount: records.length,
    policy: "policy/famous-problem-intake.md",
    boundary: "A source-pinned record is not a claim that the literature review is current or that Proofweave has verified the mathematics.",
  },
  records,
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Exported ${records.length} public catalog records to ${outputPath}`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function toPublicRecord({ record, project, snapshot, metadata }) {
  const subjects = (metadata?.subjects ?? []).map((subject) => subject.slug);
  const sourceUrl = record.declaration.sourceUrl ??
    `https://github.com/google-deepmind/formal-conjectures/blob/${snapshot.revisionCommit}/${record.declaration.sourcePath}`;

  return {
    id: record.id,
    slug: record.slug,
    title: record.title,
    project: { id: project.id, slug: project.slug, title: project.title },
    subjects,
    researchStatus: {
      value: record.researchStatus,
      authority: "upstream_import",
      proofweaveAttested: false,
    },
    formalization: {
      state: record.proofState,
      correspondence: record.sourceCorrespondence,
      qualifiedName: record.declaration.qualifiedName,
      statement: record.leanStatement,
    },
    source: {
      upstream: snapshot.upstreamName,
      revision: snapshot.revisionCommit,
      revisionTag: snapshot.revisionTag,
      path: record.declaration.sourcePath,
      url: sourceUrl,
      contentHash: record.declaration.sourceContentHash,
      retrievedAt: snapshot.retrievedAt,
      leanToolchain: snapshot.leanToolchain,
      mathlibRevision: snapshot.mathlibRevision,
      licenseNote: snapshot.sourceLicense,
    },
    frontierAudit: {
      status: "not_completed",
      literatureCheckedThrough: null,
      reviewedBy: null,
      priorWork: [],
      note: "Formal source imported. Open status, best-known results, and recent literature still require an independent dated review.",
    },
    priority: record.priority,
  };
}
