import { createHash } from "node:crypto";

export const controlPlaneAuthority = Object.freeze({
  turso: "turso",
  sitesD1: "sites_d1",
  missing: "missing",
});

export const liveReleaseDiagnosticsSchemaVersion = "pw-live-release-diagnostics-v2";

const revisionPattern = /^[a-f0-9]{40,64}$/;
const publicVersionPattern = /^[A-Za-z0-9][A-Za-z0-9:._+/-]{0,191}$/;
const siteProjectIdPattern = /^appgprj_[a-f0-9]{32}$/;

export class ControlPlaneAuthorityConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ControlPlaneAuthorityConfigurationError";
  }
}

/**
 * Select exactly one control-plane authority without opening a connection.
 * A partially configured remote authority must never fall through to the
 * Sites-local D1 binding because that would split participant state across
 * two writable databases.
 *
 * @param {{
 *   tursoDatabaseUrl?: string | null,
 *   tursoAuthToken?: string | null,
 *   d1Database?: unknown,
 * }} [options]
 */
export function selectControlPlaneAuthority({
  tursoDatabaseUrl,
  tursoAuthToken,
  d1Database = null,
} = {}) {
  const urlConfigured = settingConfigured(tursoDatabaseUrl, "TURSO_DATABASE_URL");
  const tokenConfigured = settingConfigured(tursoAuthToken, "TURSO_AUTH_TOKEN");
  if (urlConfigured !== tokenConfigured) {
    throw new ControlPlaneAuthorityConfigurationError(
      "Turso control-plane URL and authentication token must be configured together.",
    );
  }
  if (urlConfigured) return controlPlaneAuthority.turso;
  if (d1Database) return controlPlaneAuthority.sitesD1;
  return controlPlaneAuthority.missing;
}

export function createDegradedControlPlaneDiagnostics({
  authority,
  databaseFingerprint = null,
  failureCode,
  releaseIdentity,
}) {
  const safeAuthority = ["turso", "sites_d1", "missing", "invalid"].includes(authority)
    ? authority
    : "invalid";
  const safeFingerprint = typeof databaseFingerprint === "string" &&
      /^[a-f0-9]{16}$/.test(databaseFingerprint)
    ? databaseFingerprint
    : null;
  const safeFailureCode = typeof failureCode === "string" &&
      /^[a-z][a-z0-9_]{2,63}$/.test(failureCode)
    ? failureCode
    : "control_plane_diagnostics_failed";
  const identity = normalizeReleaseIdentity(releaseIdentity);
  return Object.freeze({
    schemaVersion: liveReleaseDiagnosticsSchemaVersion,
    state: "degraded",
    authority: safeAuthority,
    databaseFingerprint: safeFingerprint,
    ledgerHead: null,
    sourceRevision: identity.sourceRevision,
    sitesVersion: identity.sitesVersion,
    siteProjectId: identity.siteProjectId,
    failureCode: safeFailureCode,
  });
}

export async function inspectLiveControlPlaneDiagnostics({
  authority,
  databaseUrl,
  database,
  verifyDatabase,
  releaseIdentity,
} = {}) {
  const identity = normalizeReleaseIdentity(releaseIdentity);
  if (!identity.ready) {
    return createDegradedControlPlaneDiagnostics({
      authority,
      releaseIdentity,
      failureCode: "release_identity_missing",
    });
  }
  if (authority !== controlPlaneAuthority.turso) {
    return createDegradedControlPlaneDiagnostics({
      authority,
      releaseIdentity: identity,
      failureCode: authority === controlPlaneAuthority.sitesD1
        ? "release_authority_not_turso"
        : "control_plane_authority_missing",
    });
  }
  let databaseFingerprint;
  try {
    databaseFingerprint = tursoDatabaseFingerprint(databaseUrl);
  } catch {
    return createDegradedControlPlaneDiagnostics({
      authority,
      releaseIdentity: identity,
      failureCode: "turso_configuration_invalid",
    });
  }
  if (
    !database ||
    typeof database.prepare !== "function" ||
    typeof verifyDatabase !== "function"
  ) {
    return createDegradedControlPlaneDiagnostics({
      authority,
      databaseFingerprint,
      releaseIdentity: identity,
      failureCode: "control_plane_connection_invalid",
    });
  }
  try {
    const verified = await verifyDatabase({ database });
    if (
      !verified ||
      !Number.isSafeInteger(verified.migrationCount) ||
      verified.migrationCount <= 0 ||
      typeof verified.latestMigration !== "string" ||
      verified.latestMigration.length > 128 ||
      !/^\d{4}_[a-z0-9_]+\.sql$/.test(verified.latestMigration)
    ) {
      throw new TypeError("invalid verification projection");
    }
    return Object.freeze({
      schemaVersion: liveReleaseDiagnosticsSchemaVersion,
      state: "ready",
      authority: controlPlaneAuthority.turso,
      databaseFingerprint,
      ledgerHead: verified.latestMigration,
      sourceRevision: identity.sourceRevision,
      sitesVersion: identity.sitesVersion,
      siteProjectId: identity.siteProjectId,
      failureCode: null,
    });
  } catch {
    return createDegradedControlPlaneDiagnostics({
      authority,
      databaseFingerprint,
      releaseIdentity: identity,
      failureCode: "control_plane_verification_failed",
    });
  }
}

export function normalizeReleaseIdentity(value) {
  const sourceRevision = revisionPattern.test(value?.sourceRevision ?? "")
    ? value.sourceRevision
    : null;
  const sitesVersion = publicVersionPattern.test(value?.sitesVersion ?? "")
    ? value.sitesVersion
    : null;
  const siteProjectId = siteProjectIdPattern.test(value?.siteProjectId ?? "")
    ? value.siteProjectId
    : null;
  return Object.freeze({
    sourceRevision,
    sitesVersion,
    siteProjectId,
    ready: Boolean(sourceRevision && sitesVersion && siteProjectId),
  });
}

export function tursoDatabaseFingerprint(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim() ||
    /[\s\0]/.test(value)
  ) {
    throw new ControlPlaneAuthorityConfigurationError("TURSO_DATABASE_URL must be bounded.");
  }
  let url;
  try {
    url = new URL(value);
  } catch (cause) {
    throw new ControlPlaneAuthorityConfigurationError("TURSO_DATABASE_URL is invalid.", { cause });
  }
  if (
    url.protocol !== "libsql:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    value !== `libsql://${url.host}`
  ) {
    throw new ControlPlaneAuthorityConfigurationError(
      "TURSO_DATABASE_URL must be the canonical credential-free libsql://host URL.",
    );
  }
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function settingConfigured(value, name) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value !== "string") {
    throw new ControlPlaneAuthorityConfigurationError(`${name} must be a string when configured.`);
  }
  return true;
}
