import { env } from "cloudflare:workers";
import hostingConfiguration from "../.openai/hosting.json";
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
import {
  applyControlPlaneOperationMode,
  controlPlaneOperationState,
  controlPlaneSurfaceOperationState,
} from "@/services/database/control-plane-operation-mode.mjs";
import { verifyLiveProofweaveControlPlane } from "@/services/database/libsql-migrations.mjs";
import { createD1OAuthRefreshRotationCapability } from "@/services/proofweave-identity/d1-oauth-store.mjs";
import * as schema from "./schema";

let remoteDatabase: AnyD1Database | null = null;
let controlPlaneDiagnostics: Promise<LiveControlPlaneDiagnostics> | null = null;

export type LiveControlPlaneDiagnostics = Readonly<{
  schemaVersion: "pw-live-release-diagnostics-v2";
  state: "ready" | "degraded";
  authority: "turso" | "sites_d1" | "missing" | "invalid";
  databaseFingerprint: string | null;
  ledgerHead: string | null;
  sourceRevision: string | null;
  sitesVersion: string | null;
  siteProjectId: string | null;
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
  return applyControlPlaneOperationMode(
    getConfiguredControlPlaneDatabase(values),
    getParticipantOperationState(values).mode,
  ) as unknown as AnyD1Database;
}

/**
 * Return the shared control plane fenced by the independently configured MCP
 * write mode. Browser/Sites handlers must continue to use getD1().
 */
export function getMcpD1(): AnyD1Database {
  const values = env as unknown as Record<string, string | undefined>;
  return applyControlPlaneOperationMode(
    getConfiguredControlPlaneDatabase(values),
    getMcpOperationState(values).mode,
  ) as unknown as AnyD1Database;
}

/**
 * Return a deliberately non-database capability for rotating an already
 * issued OAuth refresh token during a research write freeze. The object has no
 * prepare(), batch(), or database property, so callers cannot use this narrow
 * maintenance exception for research, Agent, review, Receipt, or Credit writes.
 */
export function getOAuthRefreshRotationCapability() {
  const values = env as unknown as Record<string, string | undefined>;
  return createD1OAuthRefreshRotationCapability(
    getConfiguredControlPlaneDatabase(values),
  );
}

function getConfiguredControlPlaneDatabase(
  values: Record<string, string | undefined>,
): AnyD1Database {
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
  if (authority === controlPlaneAuthority.sitesD1) {
    return env.DB as unknown as AnyD1Database;
  }
  throw new MissingDatabaseBindingError();
}

export function getControlPlaneOperationState() {
  const values = env as unknown as Record<string, string | undefined>;
  return controlPlaneOperationState(values.PROOFWEAVE_CONTROL_PLANE_MODE);
}

export function getParticipantOperationState(
  values = env as unknown as Record<string, string | undefined>,
) {
  return controlPlaneSurfaceOperationState({
    globalValue: values.PROOFWEAVE_CONTROL_PLANE_MODE,
    surfaceValue: values.PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE,
    surface: "participant",
  });
}

export function getMcpOperationState(
  values = env as unknown as Record<string, string | undefined>,
) {
  return controlPlaneSurfaceOperationState({
    globalValue: values.PROOFWEAVE_CONTROL_PLANE_MODE,
    surfaceValue: values.PROOFWEAVE_MCP_CONTROL_PLANE_MODE,
    surface: "mcp",
  });
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
  const releaseIdentity = {
    sourceRevision: values.PROOFWEAVE_RELEASE_SITES_COMMIT_SHA,
    sitesVersion: values.PROOFWEAVE_RELEASE_SITES_VERSION,
    siteProjectId: hostingConfiguration.project_id,
  };
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
      releaseIdentity,
      failureCode: "control_plane_configuration_invalid",
    }) as LiveControlPlaneDiagnostics;
  }
  if (authority !== controlPlaneAuthority.turso) {
    return inspectLiveControlPlaneDiagnostics({
      authority,
      releaseIdentity,
    }) as Promise<LiveControlPlaneDiagnostics>;
  }
  let database: AnyD1Database;
  try {
    database = getRemoteDatabase(values.TURSO_DATABASE_URL, values.TURSO_AUTH_TOKEN);
  } catch {
    return createDegradedControlPlaneDiagnostics({
      authority,
      releaseIdentity,
      failureCode: "turso_configuration_invalid",
    }) as LiveControlPlaneDiagnostics;
  }
  return inspectLiveControlPlaneDiagnostics({
    authority,
    databaseUrl: values.TURSO_DATABASE_URL,
    database,
    verifyDatabase: verifyLiveProofweaveControlPlane,
    releaseIdentity,
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
