import type { CatalogBrowseOptions, CatalogMetadata } from "../../packages/domain/catalog-browser";
import { catalogPageSize } from "../../packages/domain/catalog-browser.ts";

// A small database interface keeps the query path testable on both D1 and libSQL.
type Database = {
  prepare(sql: string): {
    bind(...values: (string | number)[]): {
      all<T>(): Promise<{ results?: T[] }>;
    };
  };
};
type BrowseRow = { id: string; priority: number; title: string; subject_code: string };
type Cursor = { query: string; id: string; priority: number; title: string; subject: string };

export class InvalidCatalogCursor extends Error {}

function queryIdentity(options: CatalogBrowseOptions) {
  return JSON.stringify([options.kind, options.q, options.opportunity, options.scope, options.subject, options.sort]);
}

function readCursor(options: CatalogBrowseOptions): Cursor | null {
  if (!options.cursor) return null;
  try {
    if (options.cursor.length > 6000) throw new Error();
    const cursor = JSON.parse(options.cursor) as Cursor;
    if (cursor.query !== queryIdentity(options) || typeof cursor.id !== "string" || cursor.id.length > 500 ||
        typeof cursor.title !== "string" || cursor.title.length > 2000 || typeof cursor.subject !== "string" ||
        cursor.subject.length > 100 || !Number.isSafeInteger(cursor.priority)) throw new Error();
    return cursor;
  } catch {
    throw new InvalidCatalogCursor("Invalid catalog cursor. Restart from the first page.");
  }
}

// Treat input as literal word prefixes, never as executable FTS syntax. Splitting
// punctuation also makes qualified Lean names searchable (Nat.add -> Nat + add).
export function catalogSearchExpression(query: string): string | null {
  const words = query.normalize("NFC").match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.length ? words.map((word) => `"${word}"*`).join(" AND ") : null;
}

export function catalogPageStatement(options: CatalogBrowseOptions) {
  const cursor = readCursor(options);
  const conditions = ["browse.kind = ?"];
  const bindings: (string | number)[] = [options.kind];
  if (options.opportunity !== "all") {
    conditions.push("browse.opportunity = ?");
    bindings.push(options.opportunity);
  }
  if (options.scope !== "all") {
    conditions.push("browse.scope = ?");
    bindings.push(options.scope);
  }
  if (options.subject !== "all") {
    conditions.push(`browse.id IN (SELECT membership.problem_revision_id FROM problem_subjects AS membership
      INNER JOIN catalog_subjects AS subject ON subject.id = membership.subject_id
      WHERE subject.slug = ?)`);
    bindings.push(options.subject);
  }
  if (options.q) {
    const expression = catalogSearchExpression(options.q);
    conditions.push(expression ? `browse.rowid IN (
      SELECT rowid FROM catalog_browse_fts WHERE catalog_browse_fts MATCH ?
    )` : "0");
    if (expression) bindings.push(expression);
  }
  const order = options.sort === "recommended" ? "browse.sort_priority ASC, browse.title ASC, browse.id ASC"
    : options.sort === "subject" ? "browse.subject_code ASC, browse.title ASC, browse.id ASC"
      : "browse.title ASC, browse.id ASC";
  if (cursor) {
    // Tuple seeks avoid OFFSET's increasing cost on deep pages. Negated priority
    // is stored in an indexed generated column for an ascending tuple seek.
    if (options.sort === "recommended") {
      conditions.push("(browse.sort_priority, browse.title, browse.id) > (?, ?, ?)");
      bindings.push(-cursor.priority, cursor.title, cursor.id);
    } else if (options.sort === "subject") {
      conditions.push("(browse.subject_code, browse.title, browse.id) > (?, ?, ?)");
      bindings.push(cursor.subject, cursor.title, cursor.id);
    } else {
      conditions.push("(browse.title, browse.id) > (?, ?)");
      bindings.push(cursor.title, cursor.id);
    }
  }
  bindings.push(catalogPageSize + 1);
  return {
    sql: `SELECT browse.id, browse.priority, browse.title, browse.subject_code
      FROM catalog_browse AS browse WHERE ${conditions.join(" AND ")}
      ORDER BY ${order} LIMIT ?`,
    bindings,
  };
}

export async function readCatalogPage(database: Database, options: CatalogBrowseOptions) {
  const statement = catalogPageStatement(options);
  const { results = [] } = await database.prepare(statement.sql).bind(...statement.bindings).all<BrowseRow>();
  const rows = results.slice(0, catalogPageSize);
  const last = rows.at(-1);
  return {
    ids: rows.map((row) => row.id),
    nextCursor: results.length > catalogPageSize && last ? JSON.stringify({
      query: queryIdentity(options), id: last.id, priority: last.priority, title: last.title, subject: last.subject_code,
    } satisfies Cursor) : null,
  };
}

export async function readCatalogMetadata(database: Database, kind: string): Promise<CatalogMetadata> {
  const [counts, subjects] = await Promise.all([
    database.prepare("SELECT total, bounded, advance, formalize, verified FROM catalog_browse_counts WHERE kind = ?")
      .bind(kind).all<{ total: number; bounded: number; advance: number; formalize: number; verified: number }>(),
    database.prepare(`SELECT subject.id, subject.slug, subject.name, subject.ams_code AS amsCode
      FROM catalog_subjects AS subject WHERE EXISTS (
        SELECT 1 FROM problem_subjects AS membership
        INNER JOIN catalog_browse AS browse ON browse.id = membership.problem_revision_id
        WHERE membership.subject_id = subject.id AND browse.kind = ?
      ) ORDER BY subject.ams_code ASC`).bind(kind).all<CatalogMetadata["subjects"][number]>(),
  ]);
  const row = counts.results?.[0];
  return {
    total: row?.total ?? 0, bounded: row?.bounded ?? 0,
    opportunities: { advance: row?.advance ?? 0, formalize: row?.formalize ?? 0, verified: row?.verified ?? 0 },
    subjects: subjects.results ?? [],
  };
}
