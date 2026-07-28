import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import {
  LibsqlD1AdapterConfigurationError,
  LibsqlD1Database,
  createRemoteLibsqlD1Database,
} from "../services/database/libsql-d1-adapter.mjs";
import {
  controlPlaneAuthority,
  ControlPlaneAuthorityConfigurationError,
  selectControlPlaneAuthority,
} from "../db/control-plane-authority.mjs";

test("libSQL adapter preserves the D1 prepare/bind/result contract", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  await database.prepare("CREATE TABLE records (id TEXT PRIMARY KEY, count INTEGER NOT NULL, payload BLOB NOT NULL)").run();

  const inserted = await database
    .prepare("INSERT INTO records (id, count, payload) VALUES (?, ?, ?)")
    .bind("record:1", 7, new Uint8Array([1, 2, 3]))
    .run();
  assert.equal(inserted.success, true);
  assert.equal(inserted.meta.changes, 1);

  const row = await database.prepare("SELECT * FROM records WHERE id = ?").bind("record:1").first();
  assert.equal(row.id, "record:1");
  assert.equal(row.count, 7);
  assert.deepEqual([...new Uint8Array(row.payload)], [1, 2, 3]);
  assert.equal(await database.prepare("SELECT count FROM records WHERE id = ?").bind("record:1").first("count"), 7);

  const all = await database.prepare("SELECT id, count FROM records ORDER BY id").all();
  assert.deepEqual(all.results, [{ id: "record:1", count: 7 }]);
  assert.deepEqual(
    await database.prepare("SELECT id, count FROM records ORDER BY id").raw({ columnNames: true }),
    [["id", "count"], ["record:1", 7]],
  );
});

test("libSQL adapter maps D1 batch to one atomic write transaction", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  await database.prepare("CREATE TABLE records (id TEXT PRIMARY KEY)").run();

  await assert.rejects(database.batch([
    database.prepare("INSERT INTO records (id) VALUES (?)").bind("record:1"),
    database.prepare("INSERT INTO records (id) VALUES (?)").bind("record:1"),
  ]));
  const count = await database.prepare("SELECT COUNT(*) AS count FROM records").first("count");
  assert.equal(count, 0);
});

test("the complete D1 migration history applies unchanged to local libSQL", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  const drizzle = join(dirname(fileURLToPath(import.meta.url)), "..", "drizzle");
  const migrations = (await readdir(drizzle)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  for (const name of migrations) {
    const source = await readFile(join(drizzle, name), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await database.prepare(statement).run();
    }
  }
  const inlineTable = await database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'inline_artifact_bytes'")
    .first("name");
  assert.equal(inlineTable, "inline_artifact_bytes");
  const tableCount = await database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").first("count");
  assert.ok(tableCount >= 25);
});

test("remote libSQL configuration fails closed without a remote URL and token", () => {
  assert.throws(
    () => createRemoteLibsqlD1Database({ url: "https://example.com/db", authToken: "x".repeat(32) }),
    /must use libsql/,
  );
  assert.throws(
    () => createRemoteLibsqlD1Database({ url: "libsql://proofweave.example", authToken: "short" }),
    /authentication token/,
  );
  assert.throws(
    () => new LibsqlD1Database({ execute() {} }),
    LibsqlD1AdapterConfigurationError,
  );
});

test("control-plane authority selects Turso only when both remote settings exist", () => {
  const d1Database = { prepare() {} };
  assert.equal(selectControlPlaneAuthority({
    tursoDatabaseUrl: "libsql://proofweave.example",
    tursoAuthToken: "token",
    d1Database,
  }), controlPlaneAuthority.turso);
  assert.equal(selectControlPlaneAuthority({
    d1Database,
  }), controlPlaneAuthority.sitesD1);
  assert.equal(selectControlPlaneAuthority(), controlPlaneAuthority.missing);
});

test("partial Turso configuration fails closed instead of falling back to Sites D1", () => {
  const d1Database = { prepare() {} };
  assert.throws(
    () => selectControlPlaneAuthority({
      tursoDatabaseUrl: "libsql://proofweave.example",
      d1Database,
    }),
    ControlPlaneAuthorityConfigurationError,
  );
  assert.throws(
    () => selectControlPlaneAuthority({
      tursoAuthToken: "token",
      d1Database,
    }),
    ControlPlaneAuthorityConfigurationError,
  );
});

function memoryDatabase() {
  return new LibsqlD1Database(createClient({ url: "file::memory:" }));
}
