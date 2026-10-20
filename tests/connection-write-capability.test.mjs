import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import { connectionWriteCapability } from "../services/database/connection-write-capability.mjs";
import { connectionOperationState, applyControlPlaneOperationMode, ControlPlaneReadOnlyError } from "../services/database/control-plane-operation-mode.mjs";

test("connection lifecycle has its own switch and respects the global ceiling", () => {
  const values = { PROOFWEAVE_CONTROL_PLANE_MODE: "read_write", PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_only", PROOFWEAVE_CONNECTION_CONTROL_PLANE_MODE: "read_write" };
  assert.equal(connectionOperationState(values).writesEnabled, true);
  for (const mode of [undefined, "", "invalid", "read_only"]) {
    assert.equal(connectionOperationState({ ...values, PROOFWEAVE_CONNECTION_CONTROL_PLANE_MODE: mode }).writesEnabled, false);
    assert.equal(connectionOperationState({ ...values, PROOFWEAVE_CONTROL_PLANE_MODE: mode }).writesEnabled, false);
  }
  assert.equal(connectionOperationState({ PROOFWEAVE_CONTROL_PLANE_MODE: "read_write", PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE: "read_write" }).writesEnabled, true);
});

test("connection writes cannot alter research even when the global database is writable", async (t) => {
  const client = createClient({ url: "file::memory:" });
  t.after(() => client.close());
  const database = new LibsqlD1Database(client);
  await database.prepare("CREATE TABLE agents (id TEXT PRIMARY KEY, label TEXT)").run();
  await database.prepare("CREATE TABLE runs (id TEXT PRIMARY KEY)").run();
  const connection = connectionWriteCapability(database);
  await connection.batch([connection.prepare("INSERT INTO agents (id, label) VALUES (?, ?)").bind("agent:one", "test")]);
  assert.equal(await connection.prepare("SELECT COUNT(*) AS count FROM agents").first("count"), 1);
  for (const sql of [
    "INSERT INTO runs (id) VALUES ('run:unauthorized')", "UPDATE agent_attempts SET status='active'",
    "DELETE FROM contribution_receipts", "DELETE FROM agents.runs", "CREATE TABLE bypass (id TEXT)",
    "WITH x AS (SELECT 1) INSERT INTO runs (id) VALUES ('run:unauthorized')",
    "INSERT INTO agents (id) VALUES ('agent:two'); DELETE FROM runs",
    "UPDATE agents SET label='test' /* comment */", "PRAGMA writable_schema=ON",
  ]) assert.throws(() => connection.prepare(sql), ControlPlaneReadOnlyError);
  assert.throws(() => connection.exec("DELETE FROM runs"), ControlPlaneReadOnlyError);
  assert.throws(() => connection.batch([database.prepare("DELETE FROM runs")]), ControlPlaneReadOnlyError);
  const frozen = connectionWriteCapability(applyControlPlaneOperationMode(database, "read_only"));
  assert.throws(() => frozen.prepare("INSERT INTO agents (id) VALUES (?)"), ControlPlaneReadOnlyError);
  assert.equal(await database.prepare("SELECT COUNT(*) AS count FROM runs").first("count"), 0);
});
