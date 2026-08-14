import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  ProofweaveMigrationError,
  applyProofweaveMigrations,
  loadProofweaveMigrations,
  planProofweaveMigrations,
  proofweaveMigrationLedgerTable,
  verifyLiveProofweaveControlPlane,
  verifyProofweaveControlPlane,
} from "../services/database/libsql-migrations.mjs";

test("complete Proofweave migration history is atomically ledgered on libSQL", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  const migrations = await loadProofweaveMigrations();
  assert.equal(migrations[0].name, "0000_busy_lester.sql");
  assert.equal(migrations.at(-1).name, "0044_add_curated_research_registry.sql");

  const initial = await planProofweaveMigrations({ database, migrations });
  assert.equal(initial.fresh, true);
  assert.equal(initial.ledgerPresent, false);
  assert.equal(initial.pending.length, migrations.length);
  assert.equal(await tableExists(database, proofweaveMigrationLedgerTable), false, "plan must stay read-only");

  const result = await applyProofweaveMigrations({
    database,
    migrations,
    now: () => new Date("2026-07-16T00:00:00.000Z"),
  });
  assert.equal(result.applied.length, migrations.length);
  assert.equal(result.plan.pending.length, 0);
  assert.deepEqual(await verifyProofweaveControlPlane({ database, migrations }), {
    migrationCount: migrations.length,
    latestMigration: "0044_add_curated_research_registry.sql",
    requiredTables: [
      "persons",
      "artifact_bundles",
      "runs",
      "verification_attestations",
      "contribution_receipts",
      "receipt_credit_settlements",
      "receipt_credit_entries",
      "problem_proposals",
      "problem_proposal_events",
      "runner_queue_messages",
      "runner_queue_events",
    ],
  });
  assert.deepEqual(await verifyLiveProofweaveControlPlane({ database }), {
    migrationCount: migrations.length,
    latestMigration: "0044_add_curated_research_registry.sql",
    requiredTables: [
      "persons",
      "artifact_bundles",
      "runs",
      "verification_attestations",
      "contribution_receipts",
      "receipt_credit_settlements",
      "receipt_credit_entries",
      "problem_proposals",
      "problem_proposal_events",
      "runner_queue_messages",
      "runner_queue_events",
    ],
  });
});

test("pending migrations resume only from an immutable contiguous ledger prefix", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  const migrations = await loadProofweaveMigrations();
  await applyProofweaveMigrations({ database, migrations: migrations.slice(0, 3) });

  const plan = await planProofweaveMigrations({ database, migrations });
  assert.equal(plan.applied.length, 3);
  assert.equal(plan.pending[0].name, "0003_retire_static_mcp_tokens.sql");

  const tampered = migrations.map((migration, index) => index === 1
    ? Object.freeze({ ...migration, sha256: "0".repeat(64) })
    : migration);
  await assert.rejects(
    planProofweaveMigrations({ database, migrations: tampered }),
    /integrity mismatch/,
  );
});

test("the exact public-alpha 0039 ledger identity remains a bounded migration alias", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  const migrations = await loadProofweaveMigrations();
  await applyProofweaveMigrations({ database, migrations: migrations.slice(0, 40) });
  await database
    .prepare(`UPDATE ${proofweaveMigrationLedgerTable} SET sha256 = ?, statement_count = ? WHERE name = ?`)
    .bind(
      "03f7f5819c18255fb8264b8fe3c0c4c4d7458dd050b7bd1a6b8a8249cefe001c",
      12,
      "0039_decouple_attempt_authority.sql",
    )
    .run();

  const plan = await planProofweaveMigrations({ database, migrations });
  assert.equal(plan.applied.at(-1), "0039_decouple_attempt_authority.sql");
  assert.equal(plan.pending[0].name, "0040_add_cycle_double_cover_target.sql");

  await database
    .prepare(`UPDATE ${proofweaveMigrationLedgerTable} SET sha256 = ? WHERE name = ?`)
    .bind("0".repeat(64), "0039_decouple_attempt_authority.sql")
    .run();
  await assert.rejects(
    planProofweaveMigrations({ database, migrations }),
    /integrity mismatch for 0039/,
  );
});

test("non-empty unledgered databases fail closed instead of guessing a baseline", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  await database.prepare("CREATE TABLE existing_data (id TEXT PRIMARY KEY)").run();
  await assert.rejects(
    planProofweaveMigrations({ database, migrations: await loadProofweaveMigrations() }),
    ProofweaveMigrationError,
  );
});

test("live control-plane verification rejects malformed or non-contiguous ledger rows", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  const migrations = await loadProofweaveMigrations();
  await applyProofweaveMigrations({ database, migrations });
  await database
    .prepare(`UPDATE ${proofweaveMigrationLedgerTable} SET sha256 = ? WHERE name = ?`)
    .bind("not-a-sha", "0043_add_runner_queue_event_sequence.sql")
    .run();
  await assert.rejects(
    verifyLiveProofweaveControlPlane({ database }),
    /valid contiguous history/,
  );
});

test("a failed migration rolls back its SQL and does not receive a ledger entry", async (t) => {
  const database = memoryDatabase();
  t.after(() => database.close());
  const migrations = [Object.freeze({
    name: "0000_atomic_failure.sql",
    sha256: "a".repeat(64),
    statements: Object.freeze([
      "CREATE TABLE atomic_records (id TEXT PRIMARY KEY)",
      "INSERT INTO atomic_records (id) VALUES ('same')",
      "INSERT INTO atomic_records (id) VALUES ('same')",
    ]),
    statementCount: 3,
  })];
  await assert.rejects(applyProofweaveMigrations({ database, migrations }));
  assert.equal(await tableExists(database, "atomic_records"), false);
  assert.equal(
    await database.prepare(`SELECT COUNT(*) AS count FROM ${proofweaveMigrationLedgerTable}`).first("count"),
    0,
  );
});

async function tableExists(database, name) {
  return Boolean(await database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).bind(name).first("name"));
}

function memoryDatabase() {
  return new LibsqlD1Database(createClient({ url: "file::memory:" }));
}
