export const controlPlaneOperationMode = Object.freeze({
  readWrite: "read_write",
  readOnly: "read_only",
});

const mutatingSqlPattern =
  /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|VACUUM|ATTACH|DETACH|REINDEX|ANALYZE|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
const readableSqlPrefixPattern = /^(?:SELECT|WITH|EXPLAIN)\b/i;

export class ControlPlaneOperationModeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ControlPlaneOperationModeError";
  }
}

export class ControlPlaneReadOnlyError extends Error {
  constructor() {
    super("The Proofweave control plane is temporarily read-only.");
    this.name = "ControlPlaneReadOnlyError";
    this.code = "control_plane_read_only";
  }
}

export function normalizeControlPlaneOperationMode(value) {
  if (value === undefined || value === null || value === "") {
    return controlPlaneOperationMode.readWrite;
  }
  if (
    value !== controlPlaneOperationMode.readWrite
    && value !== controlPlaneOperationMode.readOnly
  ) {
    throw new ControlPlaneOperationModeError(
      "PROOFWEAVE_CONTROL_PLANE_MODE must be read_write or read_only.",
    );
  }
  return value;
}

export function controlPlaneOperationState(value) {
  try {
    const mode = normalizeControlPlaneOperationMode(value);
    return Object.freeze({
      schemaVersion: "pw-control-plane-operation-state-v1",
      mode,
      writesEnabled: mode === controlPlaneOperationMode.readWrite,
      explicitlyConfigured: value !== undefined && value !== null && value !== "",
    });
  } catch {
    return Object.freeze({
      schemaVersion: "pw-control-plane-operation-state-v1",
      mode: "invalid",
      writesEnabled: false,
      explicitlyConfigured: true,
    });
  }
}

/**
 * Wrap the small D1-compatible surface Proofweave uses. In read-only mode,
 * only bounded query statements can be prepared and only statements prepared
 * through this wrapper can enter a batch. This makes the provider-level switch
 * a final write fence even when an individual HTTP handler misses a route guard.
 */
export function applyControlPlaneOperationMode(database, value) {
  if (!database || typeof database.prepare !== "function") {
    throw new ControlPlaneOperationModeError(
      "Control-plane operation mode requires a D1-compatible database.",
    );
  }
  const mode = normalizeControlPlaneOperationMode(value);
  if (mode === controlPlaneOperationMode.readWrite) return database;

  const preparedStatements = new WeakMap();

  const wrapStatement = (statement) => {
    if (!statement || typeof statement !== "object") {
      throw new ControlPlaneOperationModeError(
        "D1 prepare() returned an invalid statement.",
      );
    }
    const wrapped = new Proxy(statement, {
      get(target, property) {
        if (property === "bind") {
          return (...args) => wrapStatement(target.bind(...args));
        }
        const member = Reflect.get(target, property, target);
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    preparedStatements.set(wrapped, statement);
    return wrapped;
  };

  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => {
          assertReadOnlySql(sql);
          return wrapStatement(target.prepare(sql));
        };
      }
      if (property === "batch") {
        return (statements) => {
          if (!Array.isArray(statements) || statements.length === 0) {
            throw new ControlPlaneReadOnlyError();
          }
          const unwrapped = statements.map((statement) => {
            const prepared = preparedStatements.get(statement);
            if (!prepared) throw new ControlPlaneReadOnlyError();
            return prepared;
          });
          return target.batch(unwrapped);
        };
      }
      if (property === "exec") {
        return () => {
          throw new ControlPlaneReadOnlyError();
        };
      }
      const member = Reflect.get(target, property, target);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}

function assertReadOnlySql(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 1_000_000
    || value.includes("\0")
  ) {
    throw new ControlPlaneReadOnlyError();
  }
  const inspected = stripSqlCommentsAndLiterals(value).trim();
  if (
    !readableSqlPrefixPattern.test(inspected)
    || mutatingSqlPattern.test(inspected)
  ) {
    throw new ControlPlaneReadOnlyError();
  }
}

function stripSqlCommentsAndLiterals(value) {
  return value
    .replace(/'(?:''|[^'])*'/gs, "''")
    .replace(/--[^\r\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
}
