import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const inputUrl = new URL(
  process.argv[2] ?? "../../data/formal-conjectures/focus-v1-lean4.27.0.json",
  import.meta.url,
);
const outputUrl = new URL(
  process.argv[3] ?? "../../drizzle/0030_add_curated_challenges.sql",
  import.meta.url,
);
const input = await readFile(inputUrl, "utf8");
const catalog = JSON.parse(input);

if (catalog.schemaVersion !== 2) {
  throw new Error(`Unsupported focus catalog schema: ${catalog.schemaVersion}`);
}

const statements = [];
const add = (sql) => statements.push(sql.trim());
const quote = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
};
const values = (rows) => rows.map((row) => `  (${row.map(quote).join(", ")})`).join(",\n");
const subjectBySlug = new Map(catalog.subjects.map((subject) => [subject.slug, subject]));
const collectionBySlug = new Map(
  catalog.collections.map((collection) => [collection.slug, collection]),
);

add(`
CREATE TABLE IF NOT EXISTS catalog_subjects (
  id text PRIMARY KEY NOT NULL,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  ams_code text NOT NULL UNIQUE,
  description text NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
)`);
add("CREATE INDEX IF NOT EXISTS catalog_subjects_sort_idx ON catalog_subjects (sort_order, name)");
add(`
CREATE TABLE IF NOT EXISTS problem_subjects (
  problem_revision_id text NOT NULL,
  subject_id text NOT NULL,
  is_primary integer DEFAULT 0 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (problem_revision_id, subject_id),
  FOREIGN KEY (problem_revision_id) REFERENCES problem_revisions(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (subject_id) REFERENCES catalog_subjects(id) ON UPDATE no action ON DELETE restrict
)`);
add("CREATE INDEX IF NOT EXISTS problem_subjects_subject_idx ON problem_subjects (subject_id, is_primary)");
add(`
CREATE TABLE IF NOT EXISTS catalog_collections (
  id text PRIMARY KEY NOT NULL,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL,
  tier text NOT NULL,
  priority integer DEFAULT 0 NOT NULL,
  visibility text DEFAULT 'public' NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
)`);
add("CREATE INDEX IF NOT EXISTS catalog_collections_visibility_priority_idx ON catalog_collections (visibility, priority)");
add(`
CREATE TABLE IF NOT EXISTS catalog_collection_members (
  collection_id text NOT NULL,
  problem_revision_id text NOT NULL,
  role text NOT NULL,
  position integer DEFAULT 0 NOT NULL,
  created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (collection_id, problem_revision_id),
  FOREIGN KEY (collection_id) REFERENCES catalog_collections(id) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (problem_revision_id) REFERENCES problem_revisions(id) ON UPDATE no action ON DELETE cascade
)`);
add("CREATE INDEX IF NOT EXISTS catalog_collection_members_revision_idx ON catalog_collection_members (problem_revision_id)");
add("CREATE INDEX IF NOT EXISTS catalog_collection_members_position_idx ON catalog_collection_members (collection_id, position)");

if (catalog.snapshot.revisionIdentity === "commit_and_manifest") {
  add("DROP INDEX IF EXISTS source_snapshots_upstream_revision_idx");
  add("CREATE INDEX IF NOT EXISTS source_snapshots_upstream_revision_idx ON source_snapshots (upstream_name, revision_commit)");
  add("CREATE UNIQUE INDEX IF NOT EXISTS source_snapshots_upstream_revision_manifest_idx ON source_snapshots (upstream_name, revision_commit, manifest_hash)");
}

add(`
INSERT OR IGNORE INTO source_snapshots (
  id, upstream_name, source_url, revision_tag, revision_commit,
  retrieved_at, content_hash, manifest_hash, source_license,
  lean_toolchain, mathlib_revision
) VALUES ${values([[
  catalog.snapshot.id,
  catalog.snapshot.upstreamName,
  catalog.snapshot.sourceUrl,
  catalog.snapshot.revisionTag,
  catalog.snapshot.revisionCommit,
  catalog.snapshot.retrievedAt,
  catalog.snapshot.contentHash,
  catalog.snapshot.manifestHash,
  catalog.snapshot.sourceLicense,
  catalog.snapshot.leanToolchain,
  catalog.snapshot.mathlibRevision,
]])}`);

add(`
INSERT OR IGNORE INTO catalog_subjects (
  id, slug, name, ams_code, description, sort_order
) VALUES\n${values(catalog.subjects.map((subject) => [
  subject.id,
  subject.slug,
  subject.name,
  subject.amsCode,
  subject.description,
  subject.sortOrder,
]))}`);

add(`
INSERT OR IGNORE INTO catalog_collections (
  id, slug, title, summary, tier, priority, visibility
) VALUES\n${values(catalog.collections.map((collection) => [
  collection.id,
  collection.slug,
  collection.title,
  collection.summary,
  collection.tier,
  collection.priority,
  collection.visibility,
]))}`);

for (const project of catalog.projects) {
  add(`
  INSERT OR IGNORE INTO projects (id, slug, kind, title, summary, visibility)
  VALUES ${values([[
    project.id,
    project.slug,
    project.kind,
    project.title,
    project.summary,
    project.visibility,
  ]])}`);

  add(`
  INSERT OR IGNORE INTO problem_revisions (
    id, project_id, source_snapshot_id, target_key, slug,
    revision_number, title, domain, research_status, informal_statement,
    lean_statement, source_correspondence, proof_state, priority
  ) VALUES\n${values(project.records.map((record) => [
    record.id,
    project.id,
    catalog.snapshot.id,
    record.targetKey,
    record.slug,
    1,
    record.title,
    record.domain,
    record.researchStatus,
    record.informalStatement,
    record.leanStatement,
    record.sourceCorrespondence,
    record.proofState,
    record.priority,
  ]))}`);

  add(`
  INSERT OR IGNORE INTO declarations (
    id, problem_revision_id, qualified_name, declaration_kind,
    source_path, source_url, source_line_start, source_line_end,
    source_content_hash, is_primary
  ) VALUES\n${values(project.records.map((record) => [
    record.declaration.id,
    record.id,
    record.declaration.qualifiedName,
    record.declaration.kind,
    record.declaration.sourcePath,
    `https://github.com/google-deepmind/formal-conjectures/blob/${catalog.snapshot.revisionCommit}/${record.declaration.sourcePath}#L${record.declaration.sourceLineStart}-L${record.declaration.sourceLineEnd}`,
    record.declaration.sourceLineStart,
    record.declaration.sourceLineEnd,
    record.declaration.sourceContentHash,
    1,
  ]))}`);
}

const newRecords = catalog.projects.flatMap((project) => project.records);
const claimTypes = [
  ["bundle", "bundle_reproducible"],
  ["kernel", "kernel_accepted"],
  ["statement", "statement_faithful"],
  ["novelty", "novelty_reviewed"],
  ["accepted", "project_accepted"],
];
add(`
INSERT OR IGNORE INTO verification_claims (
  id, problem_revision_id, claim_type, status, evidence_url, recorded_at
) VALUES\n${values(newRecords.flatMap((record) =>
  claimTypes.map(([shortName, claimType]) => [
    `claim:${record.slug}:${shortName}`,
    record.id,
    claimType,
    "not_submitted",
    null,
    catalog.snapshot.retrievedAt,
  ]),
))}`);

const allMemberships = [
  ...catalog.existingRecords,
  ...newRecords.map((record) => ({
    problemRevisionId: record.id,
    subjects: record.subjects,
    collection: record.collection,
  })),
];
add(`
INSERT OR IGNORE INTO problem_subjects (
  problem_revision_id, subject_id, is_primary
) VALUES\n${values(allMemberships.flatMap((membership) =>
  membership.subjects.map((subject) => {
    const subjectRecord = subjectBySlug.get(subject.slug);
    if (!subjectRecord) throw new Error(`Unknown subject: ${subject.slug}`);
    return [membership.problemRevisionId, subjectRecord.id, subject.isPrimary ? 1 : 0];
  }),
))}`);

add(`
INSERT OR IGNORE INTO catalog_collection_members (
  collection_id, problem_revision_id, role, position
) VALUES\n${values(allMemberships.map((membership) => {
  const collection = collectionBySlug.get(membership.collection.slug);
  if (!collection) throw new Error(`Unknown collection: ${membership.collection.slug}`);
  return [
    collection.id,
    membership.problemRevisionId,
    membership.collection.role,
    membership.collection.position,
  ];
}))}`);

const inputHash = `sha256:${createHash("sha256").update(input).digest("hex")}`;
add(`
INSERT OR IGNORE INTO catalog_imports (
  id, source_snapshot_id, input_hash, imported_at, record_count
) VALUES ${values([[
  catalog.snapshot.id.replace(/^snapshot:/, "import:"),
  catalog.snapshot.id,
  inputHash,
  catalog.snapshot.retrievedAt,
  newRecords.length,
]])}`);

await writeFile(outputUrl, `${statements.join(";\n--> statement-breakpoint\n")}\n`);
console.log(`Rendered ${newRecords.length} curated catalog records from ${inputUrl.pathname} to ${outputUrl.pathname}.`);
