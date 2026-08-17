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
  inspectLiveControlPlaneDiagnostics,
  selectControlPlaneAuthority,
  tursoDatabaseFingerprint,
} from "../db/control-plane-authority.mjs";
import {
  applyControlPlaneOperationMode,
  controlPlaneOperationMode,
  controlPlaneOperationState,
  controlPlaneSurfaceOperationState,
  ControlPlaneOperationModeError,
  ControlPlaneReadOnlyError,
} from "../services/database/control-plane-operation-mode.mjs";

const releaseIdentity = Object.freeze({
  sourceRevision: "a".repeat(40),
  sitesVersion: "release-140",
  siteProjectId: `appgprj_${"f".repeat(32)}`,
});

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

test("provider-controlled read-only mode preserves queries and fences every write surface", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  await database.prepare("CREATE TABLE records (id TEXT PRIMARY KEY)").run();
  await database.prepare("INSERT INTO records (id) VALUES (?)").bind("record:1").run();

  const readOnly = applyControlPlaneOperationMode(
    database,
    controlPlaneOperationMode.readOnly,
  );
  assert.equal(
    await readOnly.prepare("SELECT id FROM records WHERE id = ?").bind("record:1").first("id"),
    "record:1",
  );
  assert.equal(
    await readOnly.prepare("WITH current AS (SELECT id FROM records) SELECT COUNT(*) AS count FROM current")
      .first("count"),
    1,
  );
  assert.deepEqual(
    (await readOnly.batch([
      readOnly.prepare("SELECT id FROM records WHERE id = ?").bind("record:1"),
      readOnly.prepare("SELECT COUNT(*) AS count FROM records"),
    ])).map((result) => result.results),
    [[{ id: "record:1" }], [{ count: 1 }]],
  );

  for (const sql of [
    "INSERT INTO records (id) VALUES ('record:2')",
    "/* read-looking */ DELETE FROM records",
    "WITH removed AS (DELETE FROM records RETURNING id) SELECT id FROM removed",
    "SELECT 1; UPDATE records SET id = 'record:2'",
    "PRAGMA writable_schema = ON",
  ]) {
    assert.throws(
      () => readOnly.prepare(sql),
      ControlPlaneReadOnlyError,
    );
  }
  assert.throws(() => readOnly.exec("SELECT 1"), ControlPlaneReadOnlyError);
  assert.throws(
    () => readOnly.batch([database.prepare("SELECT id FROM records")]),
    ControlPlaneReadOnlyError,
  );
  assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM records").first("count"), 1);
});

test("control-plane operation mode is observable and invalid provider values fail closed", () => {
  assert.deepEqual(controlPlaneOperationState("read_only"), {
    schemaVersion: "pw-control-plane-operation-state-v1",
    mode: "read_only",
    writesEnabled: false,
    explicitlyConfigured: true,
    failureCode: null,
  });
  assert.deepEqual(controlPlaneOperationState(), {
    schemaVersion: "pw-control-plane-operation-state-v1",
    mode: "read_only",
    writesEnabled: false,
    explicitlyConfigured: false,
    failureCode: "operation_mode_missing",
  });
  assert.deepEqual(controlPlaneOperationState("typo"), {
    schemaVersion: "pw-control-plane-operation-state-v1",
    mode: "invalid",
    writesEnabled: false,
    explicitlyConfigured: true,
    failureCode: "operation_mode_invalid",
  });
  assert.throws(
    () => applyControlPlaneOperationMode(memoryDatabase(), "typo"),
    ControlPlaneOperationModeError,
  );
});

test("MCP and participant operation modes are independently observable and fail closed", () => {
  assert.deepEqual(
    controlPlaneSurfaceOperationState({
      globalValue: "read_write",
      surfaceValue: "read_write",
      surface: "mcp",
    }),
    {
      schemaVersion: "pw-control-plane-surface-operation-state-v1",
      surface: "mcp",
      mode: "read_write",
      writesEnabled: true,
      failureCodes: [],
      global: controlPlaneOperationState("read_write"),
      configuration: controlPlaneOperationState("read_write"),
    },
  );
  const missingParticipant = controlPlaneSurfaceOperationState({
    globalValue: "read_write",
    surfaceValue: undefined,
    surface: "participant",
  });
  assert.equal(missingParticipant.mode, "read_only");
  assert.equal(missingParticipant.writesEnabled, false);
  assert.deepEqual(
    missingParticipant.failureCodes,
    ["participant_operation_mode_missing"],
  );

  const invalidMcp = controlPlaneSurfaceOperationState({
    globalValue: "read_write",
    surfaceValue: "typo",
    surface: "mcp",
  });
  assert.equal(invalidMcp.mode, "read_only");
  assert.equal(invalidMcp.writesEnabled, false);
  assert.deepEqual(invalidMcp.failureCodes, ["mcp_operation_mode_invalid"]);

  const globallyFrozenParticipant = controlPlaneSurfaceOperationState({
    globalValue: "read_only",
    surfaceValue: "read_write",
    surface: "participant",
  });
  assert.equal(globallyFrozenParticipant.writesEnabled, false);
  assert.deepEqual(
    globallyFrozenParticipant.failureCodes,
    ["global_operation_mode_read_only"],
  );
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

test("remote libSQL adapter isolates each operation in a fresh client", async () => {
  const clients = [];
  const database = new LibsqlD1Database(null, {
    clientFactory: () => {
      const client = {
        async execute({ args }) {
          return { columns: ["value"], rows: [[args[0]]] };
        },
        async batch() {
          return [];
        },
        close() {
          client.closed = true;
        },
        closed: false,
      };
      clients.push(client);
      return client;
    },
  });

  assert.equal(await database.prepare("SELECT ? AS value").bind("first").first("value"), "first");
  assert.equal(await database.prepare("SELECT ? AS value").bind("second").first("value"), "second");
  assert.equal(clients.length, 2);
  assert.ok(clients.every((client) => client.closed));
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

test("live control-plane diagnostics expose only verified bounded release evidence", async () => {
  const databaseUrl = "libsql://proofweave-live.example";
  const diagnostics = await inspectLiveControlPlaneDiagnostics({
    authority: controlPlaneAuthority.turso,
    databaseUrl,
    database: { prepare() {} },
    releaseIdentity,
    verifyDatabase: async () => ({
      migrationCount: 44,
      latestMigration: "0043_add_runner_queue_event_sequence.sql",
    }),
  });
  assert.deepEqual(diagnostics, {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "ready",
    authority: "turso",
    databaseFingerprint: tursoDatabaseFingerprint(databaseUrl),
    ledgerHead: "0043_add_runner_queue_event_sequence.sql",
    ...releaseIdentity,
    failureCode: null,
  });
  const rendered = JSON.stringify({ diagnostics });
  assert.doesNotMatch(rendered, /proofweave-live\.example|private-auth-token-sentinel/);
  assert.deepEqual(Object.keys(diagnostics).sort(), [
    "authority",
    "databaseFingerprint",
    "failureCode",
    "ledgerHead",
    "schemaVersion",
    "siteProjectId",
    "sitesVersion",
    "sourceRevision",
    "state",
  ]);
});

test("live control-plane diagnostics fail closed for fallback, invalid URLs, and ledger failure", async () => {
  assert.deepEqual(await inspectLiveControlPlaneDiagnostics({
    authority: controlPlaneAuthority.turso,
    databaseUrl: "libsql://proofweave-live.example",
    database: { prepare() {} },
    verifyDatabase: async () => ({
      migrationCount: 44,
      latestMigration: "0043_add_runner_queue_event_sequence.sql",
    }),
  }), {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "degraded",
    authority: "turso",
    databaseFingerprint: null,
    ledgerHead: null,
    sourceRevision: null,
    sitesVersion: null,
    siteProjectId: null,
    failureCode: "release_identity_missing",
  });

  assert.deepEqual(await inspectLiveControlPlaneDiagnostics({
    authority: controlPlaneAuthority.sitesD1,
    releaseIdentity,
  }), {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "degraded",
    authority: "sites_d1",
    databaseFingerprint: null,
    ledgerHead: null,
    ...releaseIdentity,
    failureCode: "release_authority_not_turso",
  });

  assert.deepEqual(await inspectLiveControlPlaneDiagnostics({
    authority: controlPlaneAuthority.turso,
    databaseUrl: "libsql://proofweave-live.example?credential=forbidden",
    database: { prepare() {} },
    releaseIdentity,
    verifyDatabase: async () => ({
      migrationCount: 44,
      latestMigration: "0043_add_runner_queue_event_sequence.sql",
    }),
  }), {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "degraded",
    authority: "turso",
    databaseFingerprint: null,
    ledgerHead: null,
    ...releaseIdentity,
    failureCode: "turso_configuration_invalid",
  });

  const databaseUrl = "libsql://proofweave-live.example";
  assert.deepEqual(await inspectLiveControlPlaneDiagnostics({
    authority: controlPlaneAuthority.turso,
    databaseUrl,
    database: { prepare() {} },
    releaseIdentity,
    verifyDatabase: async () => {
      throw new Error("private database failure text");
    },
  }), {
    schemaVersion: "pw-live-release-diagnostics-v2",
    state: "degraded",
    authority: "turso",
    databaseFingerprint: tursoDatabaseFingerprint(databaseUrl),
    ledgerHead: null,
    ...releaseIdentity,
    failureCode: "control_plane_verification_failed",
  });
});

function memoryDatabase() {
  return new LibsqlD1Database(createClient({ url: "file::memory:" }));
}
