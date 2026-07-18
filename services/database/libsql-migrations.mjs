import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

export const proofweaveMigrationLedgerTable = "_proofweave_migrations";

const migrationFilenamePattern = /^(\d{4})_[a-z0-9_]+\.sql$/;
const requiredControlPlaneTables = Object.freeze([
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
]);

const createLedgerSql = `CREATE TABLE IF NOT EXISTS ${proofweaveMigrationLedgerTable} (
  name TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  statement_count INTEGER NOT NULL CHECK (statement_count > 0)
)`;

export class ProofweaveMigrationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ProofweaveMigrationError";
  }
}

/** Load, hash, and validate the immutable SQL history shipped by Proofweave. */
export async function loadProofweaveMigrations({
  migrationsRoot = new URL("../../drizzle/", import.meta.url),
} = {}) {
  const filenames = (await readdir(migrationsRoot))
    .filter((name) => migrationFilenamePattern.test(name))
    .sort();
  if (filenames.length === 0) throw new ProofweaveMigrationError("Proofweave migration history is empty.");

  const migrations = [];
  for (const [index, name] of filenames.entries()) {
    const match = migrationFilenamePattern.exec(name);
    if (Number(match[1]) !== index) {
      throw new ProofweaveMigrationError(`Migration history must be contiguous from 0000; found ${name} at position ${index}.`);
    }
    const source = await readFile(new URL(name, migrationsRoot), "utf8");
    if (source.includes("\0")) throw new ProofweaveMigrationError(`Migration ${name} contains a null byte.`);
    const statements = source
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean);
    if (statements.length === 0) throw new ProofweaveMigrationError(`Migration ${name} contains no SQL statements.`);
    if (statements.length >= 100) {
      throw new ProofweaveMigrationError(`Migration ${name} exceeds the atomic libSQL batch limit after its ledger write.`);
    }
    migrations.push(Object.freeze({
      name,
      sha256: createHash("sha256").update(source).digest("hex"),
      statements: Object.freeze(statements),
      statementCount: statements.length,
    }));
  }
  return Object.freeze(migrations);
}

/**
 * Inspect without mutating. A database with Proofweave tables but no ledger is
 * deliberately rejected because silently guessing a baseline can corrupt an
 * existing Sites or manually managed database.
 */
export async function planProofweaveMigrations({ database, migrations } = {}) {
  requireDatabase(database);
  const history = requireMigrationHistory(migrations);
  await database.prepare("SELECT 1 AS reachable").first("reachable");
  const tables = await listApplicationTables(database);
  const ledgerPresent = tables.includes(proofweaveMigrationLedgerTable);

  if (!ledgerPresent) {
    if (tables.length > 0) {
      throw new ProofweaveMigrationError(
        `Refusing to infer migration state for a non-empty database without ${proofweaveMigrationLedgerTable}. Use a new Turso database or perform an operator-reviewed import.`,
      );
    }
    return freezePlan({ history, applied: [], ledgerPresent: false, fresh: true });
  }

  await validateLedgerSchema(database);
  const rows = (await database.prepare(
    `SELECT name, sha256, applied_at, statement_count FROM ${proofweaveMigrationLedgerTable} ORDER BY name`,
  ).all()).results;
  const applied = validateAppliedRows(rows, history);
  return freezePlan({ history, applied, ledgerPresent: true, fresh: false });
}

/** Apply each migration and its ledger entry in one atomic libSQL batch. */
export async function applyProofweaveMigrations({
  database,
  migrations,
  now = () => new Date(),
  onApplied = null,
} = {}) {
  requireDatabase(database);
  const history = requireMigrationHistory(migrations);
  let plan = await planProofweaveMigrations({ database, migrations: history });
  if (!plan.ledgerPresent) {
    await database.prepare(createLedgerSql).run();
    plan = await planProofweaveMigrations({ database, migrations: history });
  }

  const applied = [];
  for (const migration of plan.pending) {
    const appliedAt = normalizeTimestamp(now());
    const statements = migration.statements.map((sql) => database.prepare(sql));
    statements.push(database.prepare(
      `INSERT INTO ${proofweaveMigrationLedgerTable} (name, sha256, applied_at, statement_count) VALUES (?, ?, ?, ?)`,
    ).bind(migration.name, migration.sha256, appliedAt, migration.statementCount));
    await database.batch(statements);
    applied.push(migration.name);
    await onApplied?.(migration);
  }

  const finalPlan = await planProofweaveMigrations({ database, migrations: history });
  if (finalPlan.pending.length > 0) {
    throw new ProofweaveMigrationError("Migration application ended with pending migrations.");
  }
  return Object.freeze({ applied: Object.freeze(applied), plan: finalPlan });
}

/** Verify connectivity, immutable history, and the tables needed by the alpha. */
export async function verifyProofweaveControlPlane({ database, migrations } = {}) {
  const plan = await planProofweaveMigrations({ database, migrations });
  if (!plan.ledgerPresent || plan.pending.length > 0) {
    throw new ProofweaveMigrationError(
      `Turso control plane is not current: ${plan.applied.length} applied, ${plan.pending.length} pending.`,
    );
  }
  const tables = await listApplicationTables(database);
  const missingTables = requiredControlPlaneTables.filter((name) => !tables.includes(name));
  if (missingTables.length > 0) {
    throw new ProofweaveMigrationError(`Turso control plane is missing required tables: ${missingTables.join(", ")}.`);
  }
  return Object.freeze({
    migrationCount: plan.applied.length,
    latestMigration: plan.latestApplied,
    requiredTables: requiredControlPlaneTables,
  });
}

function freezePlan({ history, applied, ledgerPresent, fresh }) {
  const pending = history.slice(applied.length);
  return Object.freeze({
    fresh,
    ledgerPresent,
    total: history.length,
    applied: Object.freeze(applied.map((migration) => migration.name)),
    pending: Object.freeze(pending),
    latestAvailable: history.at(-1).name,
    latestApplied: applied.at(-1)?.name ?? null,
  });
}

function validateAppliedRows(rows, history) {
  if (!Array.isArray(rows) || rows.length > history.length) {
    throw new ProofweaveMigrationError("Migration ledger contains an unsupported history length.");
  }
  const applied = [];
  for (const [index, row] of rows.entries()) {
    const expected = history[index];
    if (!row || row.name !== expected?.name) {
      throw new ProofweaveMigrationError(
        `Migration ledger is not a contiguous prefix; expected ${expected?.name ?? "no further migration"}.`,
      );
    }
    if (row.sha256 !== expected.sha256 || row.statement_count !== expected.statementCount) {
      throw new ProofweaveMigrationError(`Migration ledger integrity mismatch for ${row.name}.`);
    }
    if (typeof row.applied_at !== "string" || !Number.isFinite(Date.parse(row.applied_at))) {
      throw new ProofweaveMigrationError(`Migration ledger timestamp is invalid for ${row.name}.`);
    }
    applied.push(expected);
  }
  return applied;
}

async function listApplicationTables(database) {
  const rows = (await database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all()).results;
  if (!Array.isArray(rows) || rows.some((row) => typeof row?.name !== "string")) {
    throw new ProofweaveMigrationError("Database returned an invalid table catalog.");
  }
  return rows.map((row) => row.name);
}

async function validateLedgerSchema(database) {
  const rows = (await database.prepare(`PRAGMA table_info(${proofweaveMigrationLedgerTable})`).all()).results;
  const expected = ["name", "sha256", "applied_at", "statement_count"];
  if (rows.length !== expected.length || rows.some((row, index) => row.name !== expected[index])) {
    throw new ProofweaveMigrationError(`${proofweaveMigrationLedgerTable} has an unsupported schema.`);
  }
}

function requireDatabase(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw new ProofweaveMigrationError("Migration runner requires a D1-compatible libSQL database.");
  }
}

function requireMigrationHistory(migrations) {
  if (!Array.isArray(migrations) || migrations.length === 0) {
    throw new ProofweaveMigrationError("A non-empty, validated migration history is required.");
  }
  for (const [index, migration] of migrations.entries()) {
    const expectedPrefix = String(index).padStart(4, "0");
    if (!migration || typeof migration !== "object" || !migrationFilenamePattern.test(migration.name) || !migration.name.startsWith(`${expectedPrefix}_`)) {
      throw new ProofweaveMigrationError(`Migration history entry ${index} has an invalid or non-contiguous filename.`);
    }
    if (typeof migration.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(migration.sha256)) {
      throw new ProofweaveMigrationError(`Migration ${migration.name} has an invalid SHA-256 digest.`);
    }
    if (!Array.isArray(migration.statements) || migration.statements.length === 0 || migration.statements.length >= 100 || migration.statementCount !== migration.statements.length) {
      throw new ProofweaveMigrationError(`Migration ${migration.name} has an invalid atomic statement set.`);
    }
    if (migration.statements.some((statement) => typeof statement !== "string" || !statement.trim() || statement.length > 1_000_000 || /^(?:BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(statement.trim()))) {
      throw new ProofweaveMigrationError(`Migration ${migration.name} contains an unsupported statement.`);
    }
  }
  return migrations;
}

function normalizeTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ProofweaveMigrationError("Migration timestamp is invalid.");
  return date.toISOString();
}
