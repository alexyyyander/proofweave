import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { loadProofweaveMigrations, applyProofweaveMigrations } from "../services/database/libsql-migrations.mjs";
import { catalogPageStatement, catalogSearchExpression, InvalidCatalogCursor, readCatalogMetadata, readCatalogPage } from "../services/catalog/browser.ts";
import { parseCatalogQuery } from "../packages/domain/catalog-browser.ts";

import { backfillCatalogBrowseBatch } from "../services/catalog/backfill.ts";
import { verifyCatalogBrowse } from "../scripts/backfill-catalog-browse.mjs";

const database = new LibsqlD1Database(createClient({ url: ":memory:" }));
const defaults = { ...parseCatalogQuery(new URLSearchParams()), kind: "frontier" };
before(async () => {
  await applyProofweaveMigrations({ database, migrations: await loadProofweaveMigrations() });
  let afterId = "";
  for (;;) {
    const result = await backfillCatalogBrowseBatch(database, afterId, 7);
    if (!result.nextId) break;
    afterId = result.nextId;
  }
});
after(() => database.close());
const all = async (sql, ...args) => (await database.prepare(sql).bind(...args).all()).results;
const run = (sql, ...args) => database.prepare(sql).bind(...args).run();

async function assertProjection() {
  const columns = "id, kind, title, priority, subject_code, opportunity, scope, search_text";
  assert.deepEqual(await all(`SELECT ${columns} FROM catalog_browse ORDER BY id`),
    await all(`SELECT ${columns} FROM catalog_browse_source ORDER BY id`));
  for (const kind of ["frontier", "practice"]) {
    const metadata = await readCatalogMetadata(database, kind);
    const [expected] = await all(`SELECT count(*) AS total, coalesce(sum(scope = 'bounded'), 0) AS bounded,
      coalesce(sum(opportunity = 'advance'), 0) AS advance, coalesce(sum(opportunity = 'formalize'), 0) AS formalize,
      coalesce(sum(opportunity = 'verified'), 0) AS verified FROM catalog_browse WHERE kind = ?`, kind);
    assert.deepEqual({ total: metadata.total, bounded: metadata.bounded, ...metadata.opportunities }, expected);
  }
  const [indexed] = await all("SELECT count(*) AS total FROM catalog_browse_fts");
  const [source] = await all("SELECT count(*) AS total FROM catalog_browse");
  assert.equal(indexed.total, source.total);
}

test("migration and bounded backfill cover public records, FTS documents, and exact counters", async () => {
  await assertProjection();
  assert.ok((await readCatalogMetadata(database, "frontier")).total > 20);
  const result = await readCatalogPage(database, defaults);
  assert.equal(result.ids.length, 10);
  assert.ok(result.nextCursor);
});

test("bounded backfill can be restarted without duplicating documents or counters", async () => {
  const before = await verifyCatalogBrowse(database);
  let afterId = "";
  for (;;) {
    const batch = await backfillCatalogBrowseBatch(database, afterId, 7);
    assert.ok(batch.scanned <= 7);
    if (!batch.nextId) break;
    afterId = batch.nextId;
  }
  assert.deepEqual(await verifyCatalogBrowse(database), before);
});

test("all sort orders paginate ties without omissions or duplicates", async () => {
  for (const sort of ["recommended", "title", "subject"]) {
    const options = { ...defaults, sort };
    const order = sort === "recommended" ? "-priority, title, id" : sort === "subject" ? "subject_code, title, id" : "title, id";
    const expected = (await all(`SELECT id FROM catalog_browse WHERE kind = 'frontier' ORDER BY ${order}`)).map(row => row.id);
    const actual = [];
    let cursor = null;
    do {
      const page = await readCatalogPage(database, { ...options, cursor });
      assert.ok(page.ids.length <= 10);
      actual.push(...page.ids);
      cursor = page.nextCursor;
    } while (cursor);
    assert.deepEqual(actual, expected, sort);
  }
});

test("source edits, visibility, primary declarations, claims, and taxonomy keep the index in sync", async () => {
  const [record] = await all("SELECT id, project_id, source_snapshot_id, title, proof_state FROM problem_revisions WHERE slug = 'p-vs-np'");
  await run("UPDATE problem_revisions SET title = 'UniqueIndexProbe', proof_state = 'proved' WHERE id = ?", record.id);
  assert.ok((await readCatalogPage(database, { ...defaults, q: "UniqueIndexPro", opportunity: "verified" })).ids.includes(record.id));
  await assertProjection();
  await run("UPDATE projects SET visibility = 'private' WHERE id = ?", record.project_id);
  assert.equal((await readCatalogPage(database, { ...defaults, q: "UniqueIndexPro" })).ids.length, 0);
  await assertProjection();
  await run("UPDATE projects SET visibility = 'public', kind = 'practice' WHERE id = ?", record.project_id);
  await assertProjection();
  assert.equal((await readCatalogPage(database, { ...defaults, q: "UniqueIndexPro" })).ids.length, 0);
  await run("UPDATE projects SET kind = 'frontier' WHERE id = ?", record.project_id);

  const [declaration] = await all("SELECT id, qualified_name FROM declarations WHERE problem_revision_id = ? AND is_primary = 1 LIMIT 1", record.id);
  await run("UPDATE declarations SET qualified_name = 'IndexProbe.updatedDeclaration' WHERE id = ?", declaration.id);
  assert.deepEqual((await readCatalogPage(database, { ...defaults, q: "IndexProbe.updatedDecl" })).ids, [record.id]);
  await run("UPDATE declarations SET is_primary = 0 WHERE id = ?", declaration.id);
  await assertProjection();
  assert.equal((await readCatalogPage(database, { ...defaults, q: "UniqueIndexPro" })).ids.length, 0);
  await run("UPDATE declarations SET qualified_name = ?, is_primary = 1 WHERE id = ?", declaration.qualified_name, declaration.id);

  const claims = await all("SELECT * FROM verification_claims WHERE problem_revision_id = ?", record.id);
  await run("DELETE FROM verification_claims WHERE problem_revision_id = ?", record.id);
  await assertProjection();
  assert.equal((await readCatalogPage(database, { ...defaults, q: "UniqueIndexPro" })).ids.length, 0);
  for (const claim of claims) {
    await run("INSERT INTO verification_claims (id, problem_revision_id, claim_type, status, recorded_at) VALUES (?, ?, ?, ?, ?)",
      claim.id, record.id, claim.claim_type, claim.status, claim.recorded_at);
  }

  const [subject] = await all("SELECT * FROM catalog_subjects WHERE slug = 'computer-science'");
  await run("UPDATE catalog_subjects SET name = 'UniqueTaxonomyProbe' WHERE id = ?", subject.id);
  assert.ok((await readCatalogPage(database, { ...defaults, q: "UniqueTaxonomyProbe", subject: subject.slug })).ids.includes(record.id));
  await assertProjection();
  await run("UPDATE catalog_subjects SET name = ? WHERE id = ?", subject.name, subject.id);

  const [collection] = await all("SELECT * FROM catalog_collections WHERE tier = 'grand' LIMIT 1");
  await run("UPDATE catalog_collections SET visibility = 'private' WHERE id = ?", collection.id);
  await assertProjection();
  await run("UPDATE catalog_collections SET visibility = ? WHERE id = ?", collection.visibility, collection.id);
  await run("UPDATE problem_revisions SET title = ?, proof_state = ? WHERE id = ?", record.title, record.proof_state, record.id);
  await assertProjection();
});

test("new imports and cascading deletes maintain FTS and counts transactionally", async () => {
  const insert = async (table, row) => {
    const columns = Object.keys(row);
    await run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, ...Object.values(row));
  };
  const [template] = await all("SELECT * FROM problem_revisions WHERE slug = 'p-vs-np'");
  const [project] = await all("SELECT * FROM projects WHERE id = ?", template.project_id);
  await insert("projects", { ...project, id: "import:project", slug: "import-project" });
  await insert("problem_revisions", { ...template, id: "import:revision", project_id: "import:project", slug: "import-revision", title: "ImportLifecycleProbe" });
  await assertProjection();
  const [declaration] = await all("SELECT * FROM declarations WHERE problem_revision_id = ? LIMIT 1", template.id);
  await insert("declarations", { ...declaration, id: "import:declaration", problem_revision_id: "import:revision" });
  const [claim] = await all("SELECT * FROM verification_claims WHERE problem_revision_id = ? LIMIT 1", template.id);
  await insert("verification_claims", { ...claim, id: "import:claim", problem_revision_id: "import:revision" });
  assert.deepEqual((await readCatalogPage(database, { ...defaults, q: "ImportLifecycleProbe" })).ids, ["import:revision"]);
  const [membership] = await all("SELECT * FROM problem_subjects WHERE problem_revision_id = ? LIMIT 1", template.id);
  await insert("problem_subjects", { ...membership, problem_revision_id: "import:revision" });
  const [collection] = await all("SELECT * FROM catalog_collection_members WHERE problem_revision_id = ? LIMIT 1", template.id);
  await insert("catalog_collection_members", { ...collection, problem_revision_id: "import:revision", role: "milestone" });
  assert.deepEqual((await readCatalogPage(database, { ...defaults, q: "ImportLifecycleProbe", scope: "bounded" })).ids, ["import:revision"]);
  await assertProjection();
  await run("DELETE FROM catalog_collection_members WHERE problem_revision_id = 'import:revision'");
  await run("DELETE FROM problem_subjects WHERE problem_revision_id = 'import:revision'");
  await assertProjection();
  await run("DELETE FROM projects WHERE id = 'import:project'");
  assert.deepEqual((await readCatalogPage(database, { ...defaults, q: "ImportLifecycleProbe" })).ids, []);
  await assertProjection();
});

test("filters use public taxonomy and the same contribution/scope precedence as cards", async () => {
  for (const opportunity of ["formalize", "advance", "verified"]) {
    const page = await readCatalogPage(database, { ...defaults, opportunity });
    for (const id of page.ids) {
      assert.equal((await all("SELECT opportunity FROM catalog_browse WHERE id = ?", id))[0].opportunity, opportunity);
    }
  }
  for (const scope of ["bounded", "long-horizon"]) {
    const page = await readCatalogPage(database, { ...defaults, scope });
    assert.ok(page.ids.length);
    for (const id of page.ids) assert.equal((await all("SELECT scope FROM catalog_browse WHERE id = ?", id))[0].scope, scope);
  }
  assert.equal((await readCatalogPage(database, { ...defaults, subject: "does-not-exist" })).ids.length, 0);
  assert.ok((await readCatalogPage(database, { ...defaults, q: "Erdos" })).ids.length, "diacritics are normalized");
  assert.equal((await readCatalogPage(database, { ...defaults, q: "\" - + () %" })).ids.length, 0);
  assert.equal(catalogSearchExpression('Nat.add OR "x"*'), '"Nat"* AND "add"* AND "OR"* AND "x"*');
});

test("invalid or mismatched cursors are rejected instead of changing query semantics", async () => {
  for (const cursor of ["null", "{}", "not-json", "x".repeat(6001)]) {
    await assert.rejects(readCatalogPage(database, { ...defaults, cursor }), InvalidCatalogCursor);
  }
  const first = await readCatalogPage(database, defaults);
  await assert.rejects(readCatalogPage(database, { ...defaults, sort: "title", cursor: first.nextCursor }), InvalidCatalogCursor);
  assert.equal(parseCatalogQuery(new URLSearchParams({ q: "a".repeat(300), sort: "DROP TABLE" })).q.length, 200);
});

test("25,000 records keep page size bounded and deep pages use index seeks", async (t) => {
  await run(`WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 25000)
    INSERT INTO catalog_browse (id, kind, title, priority, subject_code, opportunity, scope, search_text)
    SELECT 'scale:' || printf('%06d', n), 'scale', 'Target ' || printf('%06d', n), n % 100,
      printf('%02d', n % 70), 'advance', 'program', 'ScaleSearchProbe ' || n FROM sequence`);
  const options = { ...defaults, kind: "scale" };
  const first = await readCatalogPage(database, options);
  assert.equal(first.ids.length, 10);
  const [deep] = await all("SELECT id, title, priority, subject_code FROM catalog_browse WHERE kind = 'scale' ORDER BY -priority, title, id LIMIT 1 OFFSET 20000");
  const cursor = JSON.stringify({ query: JSON.stringify(["scale", "", "all", "all", "all", "recommended"]),
    id: deep.id, title: deep.title, priority: deep.priority, subject: deep.subject_code });
  const statement = catalogPageStatement({ ...options, cursor });
  const plan = await all(`EXPLAIN QUERY PLAN ${statement.sql}`, ...statement.bindings);
  const detail = plan.map(row => row.detail).join("\n");
  assert.match(detail, /SEARCH browse USING INDEX catalog_browse_recommended_idx.*sort_priority/);
  assert.doesNotMatch(detail, /TEMP B-TREE/);
  const started = performance.now();
  const page = await readCatalogPage(database, { ...options, cursor });
  t.diagnostic(`local libSQL deep-page query (25k records): ${(performance.now() - started).toFixed(2)} ms`);
  assert.equal(page.ids.length, 10);
  assert.ok(!page.ids.includes(deep.id));
  const [next] = await all("SELECT id FROM catalog_browse WHERE kind = 'scale' ORDER BY -priority, title, id LIMIT 1 OFFSET 20001");
  assert.equal(page.ids[0], next.id);
  const search = catalogPageStatement({ ...options, q: "ScaleSearchPro" });
  const searchPlan = (await all(`EXPLAIN QUERY PLAN ${search.sql}`, ...search.bindings)).map(row => row.detail).join("\n");
  assert.match(searchPlan, /VIRTUAL TABLE INDEX.*M/);
  assert.equal((await readCatalogPage(database, { ...options, q: "ScaleSearchPro" })).ids.length, 10);
  assert.equal((await readCatalogMetadata(database, "scale")).total, 25000);
  await run("DELETE FROM catalog_browse WHERE kind = 'scale'");
});
