import { D1ProofweaveOAuthStore } from "../proofweave-identity/d1-oauth-store.mjs";
import { createOAuthAccessTokenAuthenticator } from "../proofweave-identity/oauth.mjs";
import { D1RemoteMcpGatewayStore } from "./d1-gateway-store.mjs";
import { D1RemoteMcpRateLimiter } from "./d1-rate-limiter.mjs";
import { D1RemoteMcpRunnerDispatcher } from "./runner-dispatch.mjs";
import { createRemoteMcpGateway } from "./worker.mjs";
import { CloudflareRunnerQueue } from "../lean-runner/cloudflare-queues.mjs";
import { PinnedRunnerImageRegistry } from "../lean-runner/runner-image-policy.mjs";

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
export function createD1RemoteMcpGatewayRuntime({
  database,
  bucket,
  resource,
  issuer,
  runnerQueue = null,
  runnerApprovedImagesJson = null,
  runnerControlPlaneKeyId = null,
  runnerControlPlanePrivateKeyJwkJson = null,
  runnerDefaultLimitsJson = null,
}) {
  if (!database || typeof database.prepare !== "function") {
    throw new RemoteMcpRuntimeConfigurationError("Remote MCP requires a D1 DB binding.");
  }
  if (!bucket || typeof bucket.head !== "function") {
    throw new RemoteMcpRuntimeConfigurationError("Remote MCP requires an R2 ARTIFACTS binding.");
  }
  requireAbsoluteUrl(resource, "MCP_RESOURCE_URL");
  requireAbsoluteUrl(issuer, "OAUTH_ISSUER_URL");
  const runnerDispatcher = createOptionalRunnerDispatcher({
    database,
    bucket,
    runnerQueue,
    runnerApprovedImagesJson,
    runnerControlPlaneKeyId,
    runnerControlPlanePrivateKeyJwkJson,
    runnerDefaultLimitsJson,
  });

  const oauthStore = new D1ProofweaveOAuthStore(database);
  return createRemoteMcpGateway({
    resource,
    issuer,
    identityProvider: createOAuthAccessTokenAuthenticator({ store: oauthStore, resource }),
    store: new D1RemoteMcpGatewayStore({ database, bucket, runnerDispatcher }),
    rateLimiter: new D1RemoteMcpRateLimiter({ database }),
  });
}

function createOptionalRunnerDispatcher({
  database,
  bucket,
  runnerQueue,
  runnerApprovedImagesJson,
  runnerControlPlaneKeyId,
  runnerControlPlanePrivateKeyJwkJson,
  runnerDefaultLimitsJson,
}) {
  const settings = [
    runnerQueue,
    runnerApprovedImagesJson,
    runnerControlPlaneKeyId,
    runnerControlPlanePrivateKeyJwkJson,
    runnerDefaultLimitsJson,
  ];
  const configured = settings.filter(isConfigured).length;
  if (configured === 0) return null;
  if (configured !== settings.length) {
    throw new RemoteMcpRuntimeConfigurationError("Runner dispatch configuration must include Queue, image registry, limits, and control-plane signing material together.");
  }
  if (!runnerQueue || typeof runnerQueue.send !== "function") {
    throw new RemoteMcpRuntimeConfigurationError("Runner dispatch requires a Cloudflare Queue producer binding.");
  }
  try {
    return new D1RemoteMcpRunnerDispatcher({
      database,
      bucket,
      runnerQueue: new CloudflareRunnerQueue({ queue: runnerQueue }),
      approvedImages: new PinnedRunnerImageRegistry({
        images: parseDeploymentJson(runnerApprovedImagesJson, "RUNNER_APPROVED_IMAGES_JSON"),
      }),
      controlPlaneKeyId: runnerControlPlaneKeyId,
      controlPlanePrivateKeyJwk: parseDeploymentJson(
        runnerControlPlanePrivateKeyJwkJson,
        "RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK",
      ),
      defaultLimits: parseDeploymentJson(runnerDefaultLimitsJson, "RUNNER_DEFAULT_LIMITS_JSON"),
    });
  } catch (error) {
    if (error instanceof RemoteMcpRuntimeConfigurationError) throw error;
    throw new RemoteMcpRuntimeConfigurationError("Runner dispatch configuration is invalid.");
  }
}

function parseDeploymentJson(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 32_768) {
    throw new RemoteMcpRuntimeConfigurationError(`${label} must be a bounded JSON deployment value.`);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new RemoteMcpRuntimeConfigurationError(`${label} must be valid JSON.`);
  }
}

function isConfigured(value) {
  return value !== null && value !== undefined && value !== "";
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
