import { createClient } from "@libsql/client";

const statementOwner = Symbol("proofweave.libsql-d1-owner");
const statementSql = Symbol("proofweave.libsql-d1-sql");
const statementArgs = Symbol("proofweave.libsql-d1-args");

export class LibsqlD1AdapterConfigurationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "LibsqlD1AdapterConfigurationError";
  }
}

/**
 * Small compatibility boundary that lets the existing, SQLite-native D1
 * stores run against a remote libSQL database. It deliberately implements
 * only the D1 surface Proofweave uses: prepare/bind/first/all/run/raw/batch.
 *
 * The signed protocol and store code remain unchanged; only the database
 * transport moves outside Cloudflare. libSQL batch calls use an implicit
 * write transaction, preserving the atomic multi-statement gates used for
 * OAuth consumption, Run transitions, review admission, and Receipt issue.
 */
export class LibsqlD1Database {
  constructor(client, { clientFactory = null } = {}) {
    const hasClient = client
      && typeof client.execute === "function"
      && typeof client.batch === "function";
    if (!hasClient && typeof clientFactory !== "function") {
      throw new LibsqlD1AdapterConfigurationError("libSQL D1 adapter requires a client with execute() and batch().");
    }
    this.client = hasClient ? client : null;
    this.clientFactory = typeof clientFactory === "function" ? clientFactory : null;
    this.owner = Object.freeze({});
  }

  prepare(sql) {
    return new LibsqlD1PreparedStatement({
      database: this,
      sql: requireSql(sql),
      args: [],
    });
  }

  async batch(statements) {
    if (!Array.isArray(statements) || statements.length === 0 || statements.length > 100) {
      throw new LibsqlD1AdapterConfigurationError("libSQL D1 batch must contain between one and one hundred statements.");
    }
    const queries = statements.map((statement) => {
      if (!(statement instanceof LibsqlD1PreparedStatement) || statement[statementOwner] !== this.owner) {
        throw new LibsqlD1AdapterConfigurationError("libSQL D1 batch received a statement from another database.");
      }
      return { sql: statement[statementSql], args: statement[statementArgs] };
    });
    const results = await this.withClient((client) => client.batch(queries, "write"));
    if (!Array.isArray(results) || results.length !== queries.length) {
      throw new LibsqlD1AdapterConfigurationError("libSQL returned an incomplete batch result.");
    }
    return results.map(toD1Result);
  }

  close() {
    this.client?.close?.();
  }

  async execute(sql, args) {
    return this.withClient((client) => client.execute({ sql, args }));
  }

  async withClient(operation) {
    const client = this.client ?? this.clientFactory?.();
    if (!client || typeof client.execute !== "function" || typeof client.batch !== "function") {
      throw new LibsqlD1AdapterConfigurationError("libSQL client factory returned an invalid client.");
    }
    try {
      return await operation(client);
    } finally {
      if (this.client === null) {
        try {
          await client.close?.();
        } catch {
          // A failed close must not hide the database operation's result.
        }
      }
    }
  }
}

export class LibsqlD1PreparedStatement {
  constructor({ database, sql, args }) {
    this.database = database;
    this[statementOwner] = database.owner;
    this[statementSql] = sql;
    this[statementArgs] = Object.freeze([...args]);
  }

  bind(...args) {
    return new LibsqlD1PreparedStatement({
      database: this.database,
      sql: this[statementSql],
      args: args.map(normalizeArgument),
    });
  }

  async first(columnName) {
    const result = await this.execute();
    const rows = rowsFromResult(result);
    if (rows.length === 0) return null;
    if (columnName === undefined) return rows[0];
    if (typeof columnName !== "string" || !columnName || !Object.hasOwn(rows[0], columnName)) {
      throw new LibsqlD1AdapterConfigurationError("Requested first() column is not present in the libSQL result.");
    }
    return rows[0][columnName];
  }

  async all() {
    return toD1Result(await this.execute());
  }

  async run() {
    return toD1Result(await this.execute());
  }

  async raw(options = {}) {
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw new LibsqlD1AdapterConfigurationError("raw() options must be an object.");
    }
    const result = await this.execute();
    const columns = normalizedColumns(result.columns);
    const values = result.rows.map((row) => columns.map((column, index) => normalizeValue(rowValue(row, column, index))));
    return options.columnNames === true ? [columns, ...values] : values;
  }

  execute() {
    return this.database.execute(this[statementSql], this[statementArgs]);
  }
}

/**
 * @param {{
 *   url?: string,
 *   authToken?: string,
 *   clientFactory?: typeof createClient,
 *   allowLocal?: boolean,
 * }} [options]
 */
export function createRemoteLibsqlD1Database({
  url,
  authToken,
  clientFactory = createClient,
  allowLocal = false,
} = {}) {
  const normalizedUrl = requireDatabaseUrl(url, { allowLocal });
  if (typeof clientFactory !== "function") {
    throw new LibsqlD1AdapterConfigurationError("libSQL client factory must be a function.");
  }
  if (!allowLocal && (typeof authToken !== "string" || authToken.length < 16 || authToken.length > 16_384)) {
    throw new LibsqlD1AdapterConfigurationError("Remote libSQL requires a bounded authentication token.");
  }
  return new LibsqlD1Database(null, {
    clientFactory: () => clientFactory({
      url: normalizedUrl,
      ...(authToken ? { authToken } : {}),
    }),
  });
}

function requireDatabaseUrl(value, { allowLocal }) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) {
    throw new LibsqlD1AdapterConfigurationError("libSQL database URL must be bounded.");
  }
  if (allowLocal && (value === ":memory:" || value === "file::memory:" || value.startsWith("file:"))) return value;
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new LibsqlD1AdapterConfigurationError("libSQL database URL is invalid.", { cause });
  }
  if (url.protocol !== "libsql:" || url.username || url.password || url.hash) {
    throw new LibsqlD1AdapterConfigurationError("Remote libSQL database URL must use libsql:// without embedded credentials or fragments.");
  }
  return url.toString();
}

function requireSql(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 1_000_000 || value.includes("\0")) {
    throw new LibsqlD1AdapterConfigurationError("Prepared SQL must be a bounded non-empty string.");
  }
  return value;
}

function normalizeArgument(value) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new LibsqlD1AdapterConfigurationError("libSQL D1 bind accepts only SQLite scalar or byte values.");
}

function toD1Result(result) {
  const rows = rowsFromResult(result);
  const changes = integer(result.rowsAffected ?? 0, "rowsAffected");
  const lastRowId = result.lastInsertRowid === undefined
    ? undefined
    : integer(result.lastInsertRowid, "lastInsertRowid");
  return Object.freeze({
    results: Object.freeze(rows),
    success: true,
    meta: Object.freeze({
      duration: 0,
      changes,
      changed_db: changes > 0,
      last_row_id: lastRowId,
      rows_read: rows.length,
      rows_written: changes,
      size_after: null,
    }),
  });
}

function rowsFromResult(result) {
  if (!result || !Array.isArray(result.rows)) {
    throw new LibsqlD1AdapterConfigurationError("libSQL returned an invalid result set.");
  }
  const columns = normalizedColumns(result.columns);
  return result.rows.map((row) => Object.freeze(Object.fromEntries(
    columns.map((column, index) => [column, normalizeValue(rowValue(row, column, index))]),
  )));
}

function normalizedColumns(columns) {
  if (!Array.isArray(columns) || columns.some((column) => typeof column !== "string" || !column)) {
    throw new LibsqlD1AdapterConfigurationError("libSQL returned invalid result columns.");
  }
  return [...columns];
}

function rowValue(row, column, index) {
  if (Array.isArray(row)) return row[index];
  if (row && typeof row === "object") return row[column];
  throw new LibsqlD1AdapterConfigurationError("libSQL returned an invalid result row.");
}

function normalizeValue(value) {
  if (typeof value !== "bigint") return value;
  return integer(value, "integer result");
}

function integer(value, label) {
  const normalized = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(normalized)) {
    throw new LibsqlD1AdapterConfigurationError(`libSQL ${label} exceeds JavaScript's safe integer range.`);
  }
  return normalized;
}
