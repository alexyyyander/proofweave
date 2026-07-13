import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { remoteMcpScopes } from "../packages/protocol/remote-mcp-scopes.mjs";
import { validateMcpControlPlaneManifest } from "./preflight-mcp-control-plane.mjs";

export class McpControlPlaneDeploymentVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = "McpControlPlaneDeploymentVerificationError";
  }
}

/**
 * Read-only live deployment verification for the public OAuth discovery path.
 * It intentionally does not create a Person, client, Agent installation, or
 * bearer token; those must be exercised separately in an approved alpha.
 */
export async function verifyMcpControlPlaneDeployment(manifest, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") {
    throw new McpControlPlaneDeploymentVerificationError("A Fetch-compatible implementation is required for deployment verification.");
  }
  const config = validateMcpControlPlaneManifest(manifest);
  const resourceMetadataUrl = new URL(
    "/.well-known/oauth-protected-resource",
    config.gateway.resourceUrl,
  ).toString();
  const authorizationMetadataUrl = new URL(
    "/.well-known/oauth-authorization-server",
    config.identity.issuerUrl,
  ).toString();

  const resourceMetadata = await fetchJson(fetchImpl, resourceMetadataUrl, "Protected-resource metadata");
  assertString(resourceMetadata.resource, "Protected-resource metadata resource");
  if (resourceMetadata.resource !== config.gateway.resourceUrl) {
    throw new McpControlPlaneDeploymentVerificationError("Protected-resource metadata does not advertise the configured MCP resource URL.");
  }
  assertExactStringSet(
    resourceMetadata.authorization_servers,
    [config.identity.issuerUrl],
    "Protected-resource metadata authorization_servers",
  );
  assertExactStringSet(resourceMetadata.scopes_supported, remoteMcpScopes, "Protected-resource metadata scopes_supported");

  const authorizationMetadata = await fetchJson(fetchImpl, authorizationMetadataUrl, "Authorization-server metadata");
  assertString(authorizationMetadata.issuer, "Authorization-server metadata issuer");
  if (authorizationMetadata.issuer !== config.identity.issuerUrl) {
    throw new McpControlPlaneDeploymentVerificationError("Authorization-server metadata does not advertise the configured issuer URL.");
  }
  assertString(authorizationMetadata.authorization_endpoint, "Authorization-server metadata authorization_endpoint");
  assertString(authorizationMetadata.token_endpoint, "Authorization-server metadata token_endpoint");
  if (
    authorizationMetadata.authorization_endpoint !== new URL("/authorize", config.identity.issuerUrl).toString() ||
    authorizationMetadata.token_endpoint !== new URL("/token", config.identity.issuerUrl).toString()
  ) {
    throw new McpControlPlaneDeploymentVerificationError("Authorization-server metadata endpoints do not belong to the configured issuer.");
  }
  assertIncludes(authorizationMetadata.response_types_supported, "code", "Authorization-server metadata response_types_supported");
  assertIncludes(authorizationMetadata.grant_types_supported, "authorization_code", "Authorization-server metadata grant_types_supported");
  assertIncludes(authorizationMetadata.grant_types_supported, "refresh_token", "Authorization-server metadata grant_types_supported");
  assertIncludes(authorizationMetadata.token_endpoint_auth_methods_supported, "none", "Authorization-server metadata token_endpoint_auth_methods_supported");
  assertIncludes(authorizationMetadata.code_challenge_methods_supported, "S256", "Authorization-server metadata code_challenge_methods_supported");
  assertExactStringSet(authorizationMetadata.scopes_supported, remoteMcpScopes, "Authorization-server metadata scopes_supported");

  const challenge = await fetchImpl(config.gateway.resourceUrl, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "proofweave-deployment-verifier",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "proofweave-deployment-verifier", version: "1" },
      },
    }),
    redirect: "error",
  });
  if (!(challenge instanceof Response) || challenge.status !== 401) {
    throw new McpControlPlaneDeploymentVerificationError("Unauthenticated MCP initialization must return HTTP 401.");
  }
  const expectedChallenge = `resource_metadata="${resourceMetadataUrl}"`;
  if (!challenge.headers.get("www-authenticate")?.includes(expectedChallenge)) {
    throw new McpControlPlaneDeploymentVerificationError("Unauthenticated MCP initialization does not point to the configured protected-resource metadata.");
  }

  return Object.freeze({
    resourceUrl: config.gateway.resourceUrl,
    issuerUrl: config.identity.issuerUrl,
    resourceMetadataUrl,
    authorizationMetadataUrl,
    checks: Object.freeze([
      "protected-resource metadata",
      "authorization-server metadata",
      "unauthenticated MCP challenge",
    ]),
  });
}

async function fetchJson(fetchImpl, url, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "error",
    });
  } catch {
    throw new McpControlPlaneDeploymentVerificationError(`${label} could not be fetched.`);
  }
  if (!(response instanceof Response) || response.status !== 200) {
    throw new McpControlPlaneDeploymentVerificationError(`${label} must return HTTP 200.`);
  }
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new McpControlPlaneDeploymentVerificationError(`${label} must return JSON.`);
  }
  try {
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value;
  } catch {
    throw new McpControlPlaneDeploymentVerificationError(`${label} must contain a JSON object.`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new McpControlPlaneDeploymentVerificationError(`${label} must be a non-empty string.`);
  }
}

function assertIncludes(value, expected, label) {
  if (!Array.isArray(value) || !value.includes(expected)) {
    throw new McpControlPlaneDeploymentVerificationError(`${label} must include ${expected}.`);
  }
}

function assertExactStringSet(value, expected, label) {
  if (
    !Array.isArray(value) ||
    value.length !== expected.length ||
    new Set(value).size !== value.length ||
    value.some((item) => typeof item !== "string") ||
    expected.some((item) => !value.includes(item))
  ) {
    throw new McpControlPlaneDeploymentVerificationError(`${label} does not match the Proofweave scope or issuer policy.`);
  }
}

async function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new McpControlPlaneDeploymentVerificationError("Usage: node scripts/verify-mcp-control-plane-deployment.mjs <deployment-manifest.json>");
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new McpControlPlaneDeploymentVerificationError("Deployment manifest must be readable valid JSON.");
  }
  const result = await verifyMcpControlPlaneDeployment(manifest);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "MCP deployment verification failed."}\n`);
    process.exitCode = 1;
  });
}
