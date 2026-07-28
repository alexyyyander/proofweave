import { D1ProofweaveOAuthStore } from "../proofweave-identity/d1-oauth-store.mjs";
import { createOAuthAccessTokenAuthenticator } from "../proofweave-identity/oauth.mjs";
import { D1RemoteMcpGatewayStore } from "./d1-gateway-store.mjs";
import { D1RemoteMcpRateLimiter } from "./d1-rate-limiter.mjs";
import { D1RemoteMcpRunnerDispatcher } from "./runner-dispatch.mjs";
import { createRemoteMcpGateway } from "./worker.mjs";
import { CloudflareRunnerQueue } from "../lean-runner/cloudflare-queues.mjs";
import { D1RunnerLeaseQueue } from "../lean-runner/d1-runner-lease-queue.mjs";
import { PinnedRunnerImageRegistry } from "../lean-runner/runner-image-policy.mjs";
import { D1InlineArtifactStore } from "../artifacts/d1-inline-artifact-store.mjs";
import { D1ContributionReceiptCoordinator } from "../receipts/d1-contribution-receipt-coordinator.mjs";
import { HostedRunnerWakeClient } from "../lean-runner/hosted-runner-wake-client.mjs";
import {
  controlPlaneOperationMode,
  normalizeControlPlaneOperationMode,
} from "../database/control-plane-operation-mode.mjs";

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
 *
 * @param {{
 *   database: any,
 *   bucket?: any,
 *   resource: string,
 *   issuer: string,
 *   runnerQueue?: any,
 *   runnerQueueMode?: string | null,
 *   runnerApprovedImagesJson?: string | null,
 *   runnerControlPlaneKeyId?: string | null,
 *   runnerControlPlanePrivateKeyJwkJson?: string | null,
 *   runnerDefaultLimitsJson?: string | null,
 *   runnerWakeUrl?: string | null,
 *   runnerWakeToken?: string | null,
 *   runnerWakeHostAuthorizationToken?: string | null,
 *   receiptIssuerKeyId?: string | null,
 *   receiptIssuerPublicKey?: string | null,
 *   receiptIssuerPrivateKeyJwkJson?: string | null,
 *   receiptIssuerActivatedAt?: string | null,
 *   operationMode?: string | null,
 * }} options
 */
export function createD1RemoteMcpGatewayRuntime({
  database,
  bucket = null,
  resource,
  issuer,
  runnerQueue = null,
  runnerQueueMode = null,
  runnerApprovedImagesJson = null,
  runnerControlPlaneKeyId = null,
  runnerControlPlanePrivateKeyJwkJson = null,
  runnerDefaultLimitsJson = null,
  runnerWakeUrl = null,
  runnerWakeToken = null,
  runnerWakeHostAuthorizationToken = null,
  receiptIssuerKeyId = null,
  receiptIssuerPublicKey = null,
  receiptIssuerPrivateKeyJwkJson = null,
  receiptIssuerActivatedAt = null,
  operationMode = controlPlaneOperationMode.readWrite,
}) {
  if (!database || typeof database.prepare !== "function") {
    throw new RemoteMcpRuntimeConfigurationError("Remote MCP requires a D1 DB binding.");
  }
  requireAbsoluteUrl(resource, "MCP_RESOURCE_URL");
  requireAbsoluteUrl(issuer, "OAUTH_ISSUER_URL");
  let normalizedOperationMode;
  try {
    normalizedOperationMode = normalizeControlPlaneOperationMode(operationMode);
  } catch {
    throw new RemoteMcpRuntimeConfigurationError(
      "PROOFWEAVE_CONTROL_PLANE_MODE must be read_write or read_only.",
    );
  }
  const artifactStore = bucket
    ? null
    : new D1InlineArtifactStore({ database });
  const runnerDispatcher = createOptionalRunnerDispatcher({
    database,
    bucket,
    artifactStore,
    runnerQueue: selectRunnerQueue({ database, runnerQueue, runnerQueueMode }),
    runnerApprovedImagesJson,
    runnerControlPlaneKeyId,
    runnerControlPlanePrivateKeyJwkJson,
    runnerDefaultLimitsJson,
    runnerWake: createOptionalRunnerWakeClient({
      runnerWakeUrl,
      runnerWakeToken,
      runnerWakeHostAuthorizationToken,
    }),
  });
  const receiptCoordinator = createOptionalReceiptCoordinator({
    database,
    receiptIssuerKeyId,
    receiptIssuerPublicKey,
    receiptIssuerPrivateKeyJwkJson,
    receiptIssuerActivatedAt,
  });

  const oauthStore = new D1ProofweaveOAuthStore(database);
  return createRemoteMcpGateway({
    resource,
    issuer,
    identityProvider: createOAuthAccessTokenAuthenticator({ store: oauthStore, resource }),
    store: new D1RemoteMcpGatewayStore({ database, bucket, artifactStore, runnerDispatcher, receiptCoordinator }),
    rateLimiter: new D1RemoteMcpRateLimiter({ database }),
    operationMode: normalizedOperationMode,
  });
}

function selectRunnerQueue({ database, runnerQueue, runnerQueueMode }) {
  if (!isConfigured(runnerQueueMode)) return runnerQueue;
  if (runnerQueueMode !== "d1") {
    throw new RemoteMcpRuntimeConfigurationError("RUNNER_QUEUE_MODE must be d1 when configured.");
  }
  if (isConfigured(runnerQueue)) {
    throw new RemoteMcpRuntimeConfigurationError("D1 Runner queue mode cannot be combined with a provider Queue binding.");
  }
  try {
    return new D1RunnerLeaseQueue({ database });
  } catch {
    throw new RemoteMcpRuntimeConfigurationError("D1 Runner queue mode requires the shared migrated control-plane database.");
  }
}

function createOptionalReceiptCoordinator({
  database,
  receiptIssuerKeyId,
  receiptIssuerPublicKey,
  receiptIssuerPrivateKeyJwkJson,
  receiptIssuerActivatedAt,
}) {
  const settings = [
    receiptIssuerKeyId,
    receiptIssuerPublicKey,
    receiptIssuerPrivateKeyJwkJson,
    receiptIssuerActivatedAt,
  ];
  const configured = settings.filter(isConfigured).length;
  if (configured === 0) return null;
  if (configured !== settings.length) {
    throw new RemoteMcpRuntimeConfigurationError("Receipt issuance configuration must include key id, public key, private JWK, and activation time together.");
  }
  try {
    return new D1ContributionReceiptCoordinator({
      database,
      issuer: {
        keyId: receiptIssuerKeyId,
        publicKey: receiptIssuerPublicKey,
        privateKeyJwk: parseDeploymentJson(receiptIssuerPrivateKeyJwkJson, "RECEIPT_ISSUER_PRIVATE_KEY_JWK"),
        activatedAt: receiptIssuerActivatedAt,
      },
    });
  } catch {
    throw new RemoteMcpRuntimeConfigurationError("Receipt issuance configuration is invalid.");
  }
}

function createOptionalRunnerDispatcher({
  database,
  bucket,
  artifactStore,
  runnerQueue,
  runnerApprovedImagesJson,
  runnerControlPlaneKeyId,
  runnerControlPlanePrivateKeyJwkJson,
  runnerDefaultLimitsJson,
  runnerWake,
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
  const runnerQueueAdapter = providerNeutralRunnerQueue(runnerQueue);
  try {
    return new D1RemoteMcpRunnerDispatcher({
      database,
      bucket,
      artifactStore,
      runnerQueue: runnerQueueAdapter,
      approvedImages: new PinnedRunnerImageRegistry({
        images: parseDeploymentJson(runnerApprovedImagesJson, "RUNNER_APPROVED_IMAGES_JSON"),
      }),
      controlPlaneKeyId: runnerControlPlaneKeyId,
      controlPlanePrivateKeyJwk: parseDeploymentJson(
        runnerControlPlanePrivateKeyJwkJson,
        "RUNNER_CONTROL_PLANE_PRIVATE_KEY_JWK",
      ),
      defaultLimits: parseDeploymentJson(runnerDefaultLimitsJson, "RUNNER_DEFAULT_LIMITS_JSON"),
      runnerWake,
    });
  } catch (error) {
    if (error instanceof RemoteMcpRuntimeConfigurationError) throw error;
    throw new RemoteMcpRuntimeConfigurationError("Runner dispatch configuration is invalid.");
  }
}

function createOptionalRunnerWakeClient({
  runnerWakeUrl,
  runnerWakeToken,
  runnerWakeHostAuthorizationToken,
}) {
  const required = [runnerWakeUrl, runnerWakeToken];
  const configured = required.filter(isConfigured).length;
  if (configured === 0) {
    if (isConfigured(runnerWakeHostAuthorizationToken)) {
      throw new RemoteMcpRuntimeConfigurationError("Runner host authorization cannot be configured without a wake URL and token.");
    }
    return null;
  }
  if (configured !== required.length) {
    throw new RemoteMcpRuntimeConfigurationError("Runner wake configuration must include URL and wake token together.");
  }
  try {
    return new HostedRunnerWakeClient({
      url: runnerWakeUrl,
      wakeToken: runnerWakeToken,
      hostAuthorizationToken: isConfigured(runnerWakeHostAuthorizationToken)
        ? runnerWakeHostAuthorizationToken
        : null,
    });
  } catch {
    throw new RemoteMcpRuntimeConfigurationError("Runner wake configuration is invalid.");
  }
}

function providerNeutralRunnerQueue(value) {
  if (value && typeof value.enqueue === "function") return value;
  if (value && typeof value.send === "function") return new CloudflareRunnerQueue({ queue: value });
  throw new RemoteMcpRuntimeConfigurationError("Runner dispatch requires a durable Queue adapter or Cloudflare Queue producer binding.");
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
