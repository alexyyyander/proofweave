import { assertReadOnlySql, ControlPlaneReadOnlyError } from "./control-plane-operation-mode.mjs";

const connectionTables = new Set([
  "agents", "person_keys", "person_key_revocations", "person_key_proof_challenges",
  "person_key_proof_events", "delegation_certificates", "delegation_revocations",
  "agent_installations", "agent_installation_revocations", "local_codex_pairing_sessions",
  "oauth_clients", "oauth_authorization_codes", "oauth_access_tokens", "oauth_refresh_tokens",
  "remote_mcp_rate_limit_buckets",
]);

/** A connection repository has no capability to mutate research tables. */
export function connectionWriteCapability(database) {
  const statements = new WeakMap();
  function wrap(statement) {
    const wrapped = Object.freeze({
      bind: (...args) => wrap(statement.bind(...args)),
      first: (...args) => statement.first(...args),
      all: (...args) => statement.all(...args),
      run: (...args) => statement.run(...args),
      raw: (...args) => statement.raw(...args),
    });
    statements.set(wrapped, statement);
    return wrapped;
  }
  return Object.freeze({
    prepare(sql) {
      assertConnectionSql(sql);
      return wrap(database.prepare(sql));
    },
    batch(batch) {
      if (!Array.isArray(batch) || !batch.length) throw new ControlPlaneReadOnlyError();
      return database.batch(batch.map((statement) => {
        const original = statements.get(statement);
        if (!original) throw new ControlPlaneReadOnlyError();
        return original;
      }));
    },
    exec() { throw new ControlPlaneReadOnlyError(); },
  });
}

function assertConnectionSql(sql) {
  try {
    assertReadOnlySql(sql);
    return;
  } catch (error) {
    if (!(error instanceof ControlPlaneReadOnlyError)) throw error;
  }
  // Connection writes are parameterized, single statements targeting known
  // identity tables. Reject schema operations, CTE mutations and SQL stacking.
  if (typeof sql !== "string" || sql.length > 1_000_000 || /;|--|\/\*|\0/.test(sql)) {
    throw new ControlPlaneReadOnlyError();
  }
  const target = /^\s*(?:INSERT(?:\s+OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK))?\s+INTO|UPDATE|DELETE\s+FROM)\s+([a-z][a-z0-9_]*)(?=\s|\(|$)/i.exec(sql)?.[1]?.toLowerCase();
  if (!connectionTables.has(target)) throw new ControlPlaneReadOnlyError();
}
