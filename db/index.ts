import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import type { AnyD1Database } from "drizzle-orm/d1";
import { createRemoteLibsqlD1Database } from "@/services/database/libsql-d1-adapter.mjs";
import {
  controlPlaneAuthority,
  createDegradedControlPlaneDiagnostics,
  ControlPlaneAuthorityConfigurationError,
  inspectLiveControlPlaneDiagnostics,
  selectControlPlaneAuthority,
} from "./control-plane-authority.mjs";
import { verifyLiveProofweaveControlPlane } from "@/services/database/libsql-migrations.mjs";
import * as schema from "./schema";

let remoteDatabase: AnyD1Database | null = null;
let controlPlaneDiagnostics: Promise<LiveControlPlaneDiagnostics> | null = null;

export type LiveControlPlaneDiagnostics = Readonly<{
  schemaVersion: "pw-live-release-diagnostics-v1";
  state: "ready" | "degraded";
  authority: "turso" | "sites_d1" | "missing" | "invalid";
  databaseFingerprint: string | null;
  ledgerHead: string | null;
  failureCode: string | null;
}>;

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

/**
 * Cache one live verification per Worker isolate. This projection is derived
 * only from the selected runtime authority and the authority's immutable
 * migration ledger; release evidence environment variables are never read.
 */
export function getLiveControlPlaneDiagnostics(): Promise<LiveControlPlaneDiagnostics> {
  controlPlaneDiagnostics ??= inspectConfiguredControlPlane();
  return controlPlaneDiagnostics;
}

async function inspectConfiguredControlPlane(): Promise<LiveControlPlaneDiagnostics> {
  const values = env as unknown as Record<string, string | undefined>;
  let authority: "turso" | "sites_d1" | "missing";
  try {
    authority = selectControlPlaneAuthority({
      tursoDatabaseUrl: values.TURSO_DATABASE_URL,
      tursoAuthToken: values.TURSO_AUTH_TOKEN,
      d1Database: env.DB,
    });
  } catch {
    return createDegradedControlPlaneDiagnostics({
      authority: "invalid",
      failureCode: "control_plane_configuration_invalid",
    }) as LiveControlPlaneDiagnostics;
  }
  if (authority !== controlPlaneAuthority.turso) {
    return inspectLiveControlPlaneDiagnostics({ authority }) as Promise<LiveControlPlaneDiagnostics>;
  }
  let database: AnyD1Database;
  try {
    database = getRemoteDatabase(values.TURSO_DATABASE_URL, values.TURSO_AUTH_TOKEN);
  } catch {
    return createDegradedControlPlaneDiagnostics({
      authority,
      failureCode: "turso_configuration_invalid",
    }) as LiveControlPlaneDiagnostics;
  }
  return inspectLiveControlPlaneDiagnostics({
    authority,
    databaseUrl: values.TURSO_DATABASE_URL,
    database,
    verifyDatabase: verifyLiveProofweaveControlPlane,
  }) as Promise<LiveControlPlaneDiagnostics>;
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
