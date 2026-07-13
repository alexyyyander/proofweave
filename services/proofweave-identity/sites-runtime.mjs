import { createD1BrowserConsentResolver } from "./browser-consent.mjs";
import { D1ProofweaveOAuthStore } from "./d1-oauth-store.mjs";
import { createProofweaveOAuthProvider } from "./oauth.mjs";
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
 */
export function createD1SitesIdentityRuntime({ database, resource, issuer }) {
  if (!database || typeof database.prepare !== "function") {
    throw new SitesIdentityRuntimeConfigurationError("Proofweave OAuth requires a D1 DB binding.");
  }
  requireHttpsUrl(resource, "MCP_RESOURCE_URL");
  requireHttpsUrl(issuer, "OAuth issuer");

  const store = new D1ProofweaveOAuthStore(database);
  return createProofweaveIdentityService({
    issuer,
    identityProvider: createProofweaveOAuthProvider({
      resource,
      store,
      sessionResolver: createSitesChatGPTSessionResolver({ store }),
      consentResolver: createD1BrowserConsentResolver({ store }),
    }),
  });
}

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
