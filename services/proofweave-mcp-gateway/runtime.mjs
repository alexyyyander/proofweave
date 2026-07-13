import { D1ProofweaveOAuthStore } from "../proofweave-identity/d1-oauth-store.mjs";
import { createOAuthAccessTokenAuthenticator } from "../proofweave-identity/oauth.mjs";
import { D1RemoteMcpGatewayStore } from "./d1-gateway-store.mjs";
import { createRemoteMcpGateway } from "./worker.mjs";

export class RemoteMcpRuntimeConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "RemoteMcpRuntimeConfigurationError";
  }
}

/**
 * Compose the deployable resource server from only Worker bindings. The
 * authorization server remains a separate service: it writes opaque token
 * hashes to the same D1 database, while this resource server rechecks every
 * bearer token and selected Agent installation on each MCP request.
 */
export function createD1RemoteMcpGatewayRuntime({ database, bucket, resource, issuer }) {
  if (!database || typeof database.prepare !== "function") {
    throw new RemoteMcpRuntimeConfigurationError("Remote MCP requires a D1 DB binding.");
  }
  if (!bucket || typeof bucket.head !== "function") {
    throw new RemoteMcpRuntimeConfigurationError("Remote MCP requires an R2 ARTIFACTS binding.");
  }
  requireAbsoluteUrl(resource, "MCP_RESOURCE_URL");
  requireAbsoluteUrl(issuer, "OAUTH_ISSUER_URL");

  const oauthStore = new D1ProofweaveOAuthStore(database);
  return createRemoteMcpGateway({
    resource,
    issuer,
    identityProvider: createOAuthAccessTokenAuthenticator({ store: oauthStore, resource }),
    store: new D1RemoteMcpGatewayStore({ database, bucket }),
  });
}

function requireAbsoluteUrl(value, label) {
  if (typeof value !== "string") {
    throw new RemoteMcpRuntimeConfigurationError(`${label} must be an absolute HTTPS URL.`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new RemoteMcpRuntimeConfigurationError(`${label} must be an absolute HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new RemoteMcpRuntimeConfigurationError(`${label} must be an absolute HTTPS URL.`);
  }
}
