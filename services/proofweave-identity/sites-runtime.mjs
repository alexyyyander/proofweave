import { createD1BrowserConsentResolver } from "./browser-consent.mjs";
import { D1ProofweaveOAuthStore } from "./d1-oauth-store.mjs";
import {
  createAllowlistedClientRegistrationPolicy,
  createProofweaveOAuthProvider,
} from "./oauth.mjs";
import { createSitesChatGPTSessionResolver } from "./sites-session.mjs";
import { createProofweaveIdentityService } from "./worker.mjs";

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
 * }} options
 */
export function createD1SitesIdentityRuntime({
  database,
  resource,
  issuer,
  clientRegistrationAllowlistJson = null,
}) {
  if (!database || typeof database.prepare !== "function") {
    throw new SitesIdentityRuntimeConfigurationError("Proofweave OAuth requires a D1 DB binding.");
  }
  requireHttpsUrl(resource, "MCP_RESOURCE_URL");
  requireHttpsUrl(issuer, "OAuth issuer");
  const clientRegistrationPolicy = parseClientRegistrationAllowlist(clientRegistrationAllowlistJson);

  const store = new D1ProofweaveOAuthStore(database);
  return createProofweaveIdentityService({
    issuer,
    identityProvider: createProofweaveOAuthProvider({
      resource,
      store,
      sessionResolver: createSitesChatGPTSessionResolver({ store }),
      consentResolver: createD1BrowserConsentResolver({ store }),
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
function requireHttpsUrl(value, label) {
  if (typeof value !== "string") throw new SitesIdentityRuntimeConfigurationError(`${label} must be an HTTPS URL.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SitesIdentityRuntimeConfigurationError(`${label} must be an HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.pathname !== "/" || url.search) {
    throw new SitesIdentityRuntimeConfigurationError(`${label} must be an HTTPS origin.`);
  }
}
