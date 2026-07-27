export const controlPlaneAuthority = Object.freeze({
  turso: "turso",
  sitesD1: "sites_d1",
  missing: "missing",
});

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

function settingConfigured(value, name) {
  if (value === null || value === undefined || value === "") return false;
  if (typeof value !== "string") {
    throw new ControlPlaneAuthorityConfigurationError(`${name} must be a string when configured.`);
  }
  return true;
}
