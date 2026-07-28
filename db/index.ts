import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { createRemoteLibsqlD1Database } from "@/services/database/libsql-d1-adapter.mjs";
import {
  controlPlaneAuthority,
  ControlPlaneAuthorityConfigurationError,
  selectControlPlaneAuthority,
} from "./control-plane-authority.mjs";
import * as schema from "./schema";

let remoteDatabase: AnyD1Database | null = null;

export { ControlPlaneAuthorityConfigurationError };

export class MissingDatabaseBindingError extends Error {
  constructor() {
    super(
      "Cloudflare D1 binding `DB` is unavailable. Apply the catalog migrations and run this route with the Proofweave D1 binding.",
    );
    this.name = "MissingDatabaseBindingError";
  }
}

export function getD1(): AnyD1Database {
  const values = env as unknown as Record<string, string | undefined>;
  // A configured Turso database is the shared participant control plane. MCP,
  // OAuth, browser writes, Runner leases, reviews, Receipts, and Credit must
  // observe the same rows; silently preferring the Sites-local D1 split those
  // trust boundaries and left externally queued Runs invisible to E2B.
  const authority = selectControlPlaneAuthority({
    tursoDatabaseUrl: values.TURSO_DATABASE_URL,
    tursoAuthToken: values.TURSO_AUTH_TOKEN,
    d1Database: env.DB,
  });
  if (authority === controlPlaneAuthority.turso) {
    return getRemoteDatabase(values.TURSO_DATABASE_URL, values.TURSO_AUTH_TOKEN);
  }
  if (authority === controlPlaneAuthority.sitesD1) return env.DB;
  throw new MissingDatabaseBindingError();
}

/**
 * Read the same cross-runtime control plane used by browser, MCP, Runner,
 * review, Receipt, and Credit paths. The explicit name documents that callers
 * are crossing process boundaries even though the backing database is shared.
 */
export function getSharedResearchD1(): AnyD1Database {
  return getD1();
}

function getRemoteDatabase(url: string | undefined, authToken: string | undefined): AnyD1Database {
  if (!url || !authToken) {
    throw new ControlPlaneAuthorityConfigurationError(
      "Turso control-plane URL and authentication token must be configured together.",
    );
  }
  remoteDatabase ??= createRemoteLibsqlD1Database({
    url,
    authToken,
  }) as unknown as AnyD1Database;
  return remoteDatabase;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}
