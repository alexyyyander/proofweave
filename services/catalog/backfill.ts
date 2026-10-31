// Run separately from schema migrations. A restart resumes safely: existing
// entries are left to the source-table triggers, which maintain their current state.
type Database = {
  prepare(sql: string): {
    bind(...values: (string | number)[]): {
      all<T>(): Promise<{ results?: T[] }>;
      run(): Promise<unknown>;
    };
  };
};

export async function backfillCatalogBrowseBatch(database: Database, afterId = "", batchSize = 100) {
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new RangeError("Backfill batch size must be between 1 and 100");
  }
  const { results = [] } = await database.prepare(`SELECT id FROM problem_revisions
    WHERE id > ? ORDER BY id ASC LIMIT ?`).bind(afterId, batchSize).all<{ id: string }>();
  if (!results.length) return { nextId: null, scanned: 0 };
  await database.prepare(`INSERT INTO catalog_browse
    (id, kind, title, priority, subject_code, opportunity, scope, search_text)
    SELECT id, kind, title, priority, subject_code, opportunity, scope, search_text
    FROM catalog_browse_source WHERE id IN (${results.map(() => "?").join(", ")})
    ON CONFLICT(id) DO NOTHING`).bind(...results.map(row => row.id)).run();
  return { nextId: results[results.length - 1].id, scanned: results.length };
}
