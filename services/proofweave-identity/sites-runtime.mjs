import { createD1BrowserConsentResolver } from "./browser-consent.mjs";
import { D1ProofweaveOAuthStore } from "./d1-oauth-store.mjs";
import {
  createAllowlistedClientRegistrationPolicy,
  createProofweaveOAuthProvider,
} from "./oauth.mjs";
import { createSitesChatGPTSessionResolver } from "./sites-session.mjs";
import { createProofweaveIdentityService } from "./worker.mjs";
import {
  controlPlaneOperationMode,
  normalizeControlPlaneOperationMode,
} from "../database/control-plane-operation-mode.mjs";

export class SitesIdentityRuntimeConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SitesIdentityRuntimeConfigurationError";
  }
}

/**
 * Compose the owner-only Sites browser session with the remote OAuth protocol.
 * It is a closed-alpha convenience adapter, not the public Proofweave identity
 * system planned for participant onboarding.
 *
 * @param {{
 *   database: any,
 *   resource?: string,
 *   issuer?: string,
 *   clientRegistrationAllowlistJson?: string | null,
 *   operationMode?: string | null,
 *   refreshTokenRotator?: {
 *     rotateExistingRefreshToken(record: Record<string, string>): Promise<object | null>
 *   } | null,
 * }} options
 */
export function createD1SitesIdentityRuntime({
  database,
  resource,
  issuer,
  clientRegistrationAllowlistJson = null,
  operationMode = controlPlaneOperationMode.readWrite,
  refreshTokenRotator = null,
}) {
  if (!database || typeof database.prepare !== "function") {
    throw new SitesIdentityRuntimeConfigurationError("Proofweave OAuth requires a D1 DB binding.");
  }
  requireHttpsEndpointUrl(resource, "MCP_RESOURCE_URL");
  requireHttpsOrigin(issuer, "OAuth issuer");
  const clientRegistrationPolicy = parseClientRegistrationAllowlist(clientRegistrationAllowlistJson);
  let normalizedOperationMode;
  try {
    normalizedOperationMode = normalizeControlPlaneOperationMode(operationMode);
  } catch {
    throw new SitesIdentityRuntimeConfigurationError(
      "PROOFWEAVE_CONTROL_PLANE_MODE must be read_write or read_only.",
    );
  }
  if (refreshTokenRotator !== null && (
    typeof refreshTokenRotator !== "object"
    || typeof refreshTokenRotator.rotateExistingRefreshToken !== "function"
  )) {
    throw new SitesIdentityRuntimeConfigurationError(
      "Read-only OAuth token refresh requires a bounded rotation capability.",
    );
  }

  return createIdentityService({
    database,
    resource,
    issuer,
    clientRegistrationPolicy,
    operationMode: normalizedOperationMode,
    refreshTokenRotator:
      normalizedOperationMode === controlPlaneOperationMode.readOnly
        ? refreshTokenRotator
        : null,
  });
}

function createIdentityService({
  database,
  resource,
  issuer,
  clientRegistrationPolicy,
  operationMode,
  refreshTokenRotator,
}) {
  const store = new D1ProofweaveOAuthStore(database);
  return createProofweaveIdentityService({
    issuer,
    identityProvider: createProofweaveOAuthProvider({
      resource,
      store,
      sessionResolver: createSitesChatGPTSessionResolver({ store }),
      consentResolver: createD1BrowserConsentResolver({ store }),
      operationMode,
      refreshTokenRotator,
      ...(clientRegistrationPolicy ? { clientRegistrationPolicy } : {}),
    }),
  });
}

function parseClientRegistrationAllowlist(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 32_768) {
    throw new SitesIdentityRuntimeConfigurationError("OAuth client-registration allowlist must be a bounded JSON string.");
  }
  let clients;
  try {
    clients = JSON.parse(value);
  } catch {
    throw new SitesIdentityRuntimeConfigurationError("OAuth client-registration allowlist is not valid JSON.");
  }
  try {
    return createAllowlistedClientRegistrationPolicy({ clients });
  } catch {
    throw new SitesIdentityRuntimeConfigurationError("OAuth client-registration allowlist is invalid.");
  }
}

/** @param {unknown} value @param {string} label */
function requireHttpsEndpointUrl(value, label) {
  if (typeof value !== "string") throw new SitesIdentityRuntimeConfigurationError(`${label} must be an HTTPS URL.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SitesIdentityRuntimeConfigurationError(`${label} must be an HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new SitesIdentityRuntimeConfigurationError(`${label} must be an HTTPS URL.`);
  }
}

/** @param {unknown} value @param {string} label */
function requireHttpsOrigin(value, label) {
  requireHttpsEndpointUrl(value, label);
  const url = new URL(value);
  if (url.pathname !== "/") {
    throw new SitesIdentityRuntimeConfigurationError(`${label} must be an HTTPS origin.`);
  }
}
