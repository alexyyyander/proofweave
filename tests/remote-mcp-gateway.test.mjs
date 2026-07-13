import assert from "node:assert/strict";
import test from "node:test";
import { createProofweaveIdentityService } from "../services/proofweave-identity/worker.mjs";
import cloudflareGatewayWorker from "../services/proofweave-mcp-gateway/cloudflare-worker.mjs";
import {
  createAllowlistedClientRegistrationPolicy,
  createOAuthAccessTokenAuthenticator,
  createProofweaveOAuthProvider,
} from "../services/proofweave-identity/oauth.mjs";
import { createRemoteMcpGateway, remoteMcpScopes } from "../services/proofweave-mcp-gateway/worker.mjs";

const resource = "https://mcp.example.test/mcp";
const issuer = "https://auth.example.test";

function gatewayWith(identityProvider, store = fixtureStore(), { rateLimiter } = {}) {
  return createRemoteMcpGateway({
    resource,
    issuer,
    identityProvider,
    store,
    ...(rateLimiter ? { rateLimiter } : {}),
  });
}

function fixtureStore() {
  return {
    async listFrontier() { return [{ slug: "erdos-865" }]; },
    async inspectProblem(_principal, slug) { return { slug }; },
    async createAttempt(_principal, input) { return { id: "attempt:test", ...input }; },
    async reportProgress(_principal, input) { return { id: "event:test", ...input }; },
    async listAttempts() { return { attempts: [{ id: "attempt:test" }], verificationState: "agent_reported_only" }; },
    async getAttempt(_principal, attemptId) { return { id: attemptId }; },
    async putArtifactObject(_principal, input) { return { object: input, storageState: "object_staged_only" }; },
    async stageArtifactBundle(_principal, bundle) { return { bundle, storageState: "bundle_staged_only" }; },
    async submitVerificationAttestation(_principal, attestation) { return { id: attestation.id, created: true }; },
  };
}

test("publishes MCP protected-resource and OAuth authorization metadata", async () => {
  const gateway = gatewayWith(unauthenticatedIdentity());

  const resourceMetadata = await gateway.fetch(
    new Request("https://mcp.example.test/.well-known/oauth-protected-resource"),
  );
  assert.equal(resourceMetadata.status, 200);
  assert.deepEqual(await resourceMetadata.json(), {
    resource,
    authorization_servers: [issuer],
    scopes_supported: remoteMcpScopes,
  });

  const identity = createProofweaveIdentityService({
    issuer,
    identityProvider: unavailableIdentity(),
  });
  const authorizationMetadata = await identity.fetch(
    new Request("https://auth.example.test/.well-known/oauth-authorization-server"),
  );
  assert.equal(authorizationMetadata.status, 200);
  const metadata = await authorizationMetadata.json();
  assert.equal(metadata.authorization_endpoint, "https://auth.example.test/authorize");
  assert.ok(metadata.code_challenge_methods_supported.includes("S256"));
  assert.equal(metadata.client_id_metadata_document_supported, true);
  assert.deepEqual(metadata.scopes_supported, remoteMcpScopes);
});

test("challenges unauthenticated MCP requests with protected-resource metadata", async () => {
  const gateway = gatewayWith(unauthenticatedIdentity());
  const response = await gateway.fetch(
    new Request(resource, { method: "POST", body: "{}" }),
  );
  assert.equal(response.status, 401);
  assert.match(
    response.headers.get("www-authenticate") ?? "",
    /resource_metadata="https:\/\/mcp\.example\.test\/\.well-known\/oauth-protected-resource"/,
  );
});

test("the Cloudflare gateway entrypoint fails closed without its control-plane bindings", async () => {
  const response = await cloudflareGatewayWorker.fetch(new Request(resource, { method: "POST" }), {});
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.error, "temporarily_unavailable");
  assert.match(payload.error_description, /control-plane bindings/);
});

test("keeps identity endpoints unavailable until an identity adapter is connected", async () => {
  const identity = createProofweaveIdentityService({
    issuer,
    identityProvider: unavailableIdentity(),
  });
  const response = await identity.fetch(
    new Request("https://auth.example.test/authorize"),
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "temporarily_unavailable");
});

test("keeps dynamic OAuth client registration closed unless a fixed allowlist enables it", async () => {
  const registrations = [];
  const store = {
    async registerClient(metadata) {
      registrations.push(metadata);
      return {
        client_id: `approved-${registrations.length}`,
        client_name: metadata.clientName,
        redirect_uris: metadata.redirectUris,
        token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
      };
    },
  };
  const common = {
    resource,
    store,
    sessionResolver: { async currentSession() { return null; }, authorizationRequired() { return new Response("Sign in", { status: 401 }); } },
    consentResolver: { async resolve() { return { approved: false }; } },
  };
  const closed = createProofweaveIdentityService({
    issuer,
    identityProvider: createProofweaveOAuthProvider(common),
  });
  const closedMetadata = await (await closed.fetch(new Request(`${issuer}/.well-known/oauth-authorization-server`))).json();
  assert.equal(Object.hasOwn(closedMetadata, "registration_endpoint"), false);
  assert.equal((await closed.fetch(clientRegistrationRequest({
    client_name: "Approved Codex",
    redirect_uris: ["https://codex.example.test/callback"],
  }))).status, 404);
  assert.equal(registrations.length, 0);

  const enabled = createProofweaveIdentityService({
    issuer,
    identityProvider: createProofweaveOAuthProvider({
      ...common,
      clientRegistrationPolicy: createAllowlistedClientRegistrationPolicy({
        clients: [{
          client_name: "Approved Codex",
          redirect_uris: ["https://codex.example.test/callback"],
        }],
      }),
    }),
  });
  const enabledMetadata = await (await enabled.fetch(new Request(`${issuer}/.well-known/oauth-authorization-server`))).json();
  assert.equal(enabledMetadata.registration_endpoint, `${issuer}/register`);
  const approved = await enabled.fetch(clientRegistrationRequest({
    client_name: " Approved Codex ",
    redirect_uris: ["https://codex.example.test/callback"],
  }));
  assert.equal(approved.status, 201);
  assert.deepEqual((await approved.json()).redirect_uris, ["https://codex.example.test/callback"]);
  const rejected = await enabled.fetch(clientRegistrationRequest({
    client_name: "Unapproved redirect",
    redirect_uris: ["https://attacker.example.test/callback"],
  }));
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).error, "access_denied");
  assert.equal(registrations.length, 1);
});

test("issues PKCE-bound OAuth tokens for one authorized Agent installation and rotates refresh tokens", async () => {
  const store = new InMemoryOAuthStore();
  const verifier = "proofweave-pkce-verifier-with-enough-entropy-1234567890";
  const provider = createProofweaveOAuthProvider({
    issuer,
    resource,
    store,
    sessionResolver: {
      async currentSession() { return { personId: "did:proofweave:alice" }; },
      authorizationRequired() { return new Response("Sign in", { status: 401 }); },
    },
    consentResolver: {
      async resolve() {
        return {
          approved: true,
          agentInstallationId: "installation:alice-codex",
          grantedScopes: ["catalog:read", "attempt:create"],
        };
      },
    },
  });
  const identity = createProofweaveIdentityService({ issuer, identityProvider: provider });
  const authorizeResponse = await identity.fetch(
    new Request(
      `${issuer}/authorize?response_type=code&client_id=codex-test&redirect_uri=${encodeURIComponent("https://codex.example.test/callback")}&resource=${encodeURIComponent(resource)}&scope=catalog%3Aread%20attempt%3Acreate&state=state-123&code_challenge=${await pkceChallenge(verifier)}&code_challenge_method=S256`,
    ),
  );
  assert.equal(authorizeResponse.status, 302);
  const callback = new URL(authorizeResponse.headers.get("location"));
  assert.equal(callback.origin, "https://codex.example.test");
  assert.equal(callback.searchParams.get("state"), "state-123");

  const tokenResponse = await identity.fetch(tokenRequest({
    grant_type: "authorization_code",
    code: callback.searchParams.get("code"),
    client_id: "codex-test",
    redirect_uri: "https://codex.example.test/callback",
    code_verifier: verifier,
  }));
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.equal(tokens.token_type, "Bearer");
  assert.equal(tokens.scope, "attempt:create catalog:read");

  const principal = await createOAuthAccessTokenAuthenticator({ store, resource }).authenticate(
    new Request(resource, { headers: { authorization: `Bearer ${tokens.access_token}` } }),
  );
  assert.deepEqual(principal, {
    accessToken: tokens.access_token,
    clientId: "codex-test",
    personId: "did:proofweave:alice",
    agentInstallationId: "installation:alice-codex",
    scopes: ["attempt:create", "catalog:read"],
    expiresAt: principal.expiresAt,
  });

  const refreshed = await identity.fetch(tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: "codex-test",
  }));
  assert.equal(refreshed.status, 200);
  const refreshedTokens = await refreshed.json();
  assert.notEqual(refreshedTokens.refresh_token, tokens.refresh_token);

  const replayedRefresh = await identity.fetch(tokenRequest({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: "codex-test",
  }));
  assert.equal(replayedRefresh.status, 400);
  assert.equal((await replayedRefresh.json()).error, "invalid_grant");
});

test("rejects an authorization code when its PKCE verifier is wrong", async () => {
  const store = new InMemoryOAuthStore();
  const provider = createProofweaveOAuthProvider({
    issuer,
    resource,
    store,
    sessionResolver: {
      async currentSession() { return { personId: "did:proofweave:alice" }; },
      authorizationRequired() { return new Response("Sign in", { status: 401 }); },
    },
    consentResolver: {
      async resolve() { return { approved: true, agentInstallationId: "installation:alice-codex" }; },
    },
  });
  const identity = createProofweaveIdentityService({ issuer, identityProvider: provider });
  const verifier = "correct-verifier-1234567890";
  const authorize = await identity.fetch(
    new Request(`${issuer}/authorize?response_type=code&client_id=codex-test&redirect_uri=${encodeURIComponent("https://codex.example.test/callback")}&code_challenge=${await pkceChallenge(verifier)}&code_challenge_method=S256`),
  );
  const code = new URL(authorize.headers.get("location")).searchParams.get("code");
  const response = await identity.fetch(tokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: "codex-test",
    redirect_uri: "https://codex.example.test/callback",
    code_verifier: "wrong-verifier-1234567890",
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_grant");
});

test("handles sequential authenticated MCP requests without retaining a session", async () => {
  const gateway = gatewayWith({
    async authenticate() {
      return {
        accessToken: "test-token",
        clientId: "https://codex.example.test/client.json",
        personId: "did:proofweave:alice",
        agentInstallationId: "agent-installation:alice-codex",
        scopes: remoteMcpScopes,
      };
    },
    ...unavailableIdentity(),
  });
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const initialized = await gateway.fetch(
    new Request(resource, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-11-25",
          capabilities: {},
          clientInfo: { name: "Proofweave gateway test", version: "1.0.0" },
        },
      }),
    }),
  );
  assert.equal(initialized.status, 200);
  assert.equal(initialized.headers.get("mcp-session-id"), null);

  const tools = await gateway.fetch(
    new Request(resource, {
      method: "POST",
      headers: { ...headers, "MCP-Protocol-Version": "2025-11-25" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    }),
  );
  assert.equal(tools.status, 200);
  const payload = await tools.json();
  assert.ok(payload.result.tools.some((tool) => tool.name === "create_attempt"));
  assert.ok(payload.result.tools.some((tool) => tool.name === "list_attempts"));
  assert.ok(payload.result.tools.some((tool) => tool.name === "put_artifact_object"));
  assert.ok(payload.result.tools.some((tool) => tool.name === "stage_artifact_bundle"));
  assert.ok(payload.result.tools.some((tool) => tool.name === "submit_verification_attestation"));
});

test("passes only attribution context to the store and blocks an ungranted write scope", async () => {
  let storePrincipal;
  let attemptedWrite = false;
  const gateway = gatewayWith(
    {
      async authenticate() {
        return {
          accessToken: "secret-token-that-must-not-reach-the-store",
          clientId: "https://codex.example.test/client.json",
          personId: "did:proofweave:alice",
          agentInstallationId: "agent-installation:alice-codex",
          scopes: ["catalog:read"],
        };
      },
      ...unavailableIdentity(),
    },
    {
      ...fixtureStore(),
      async listFrontier(principal) {
        storePrincipal = principal;
        return [{ slug: "erdos-865" }];
      },
      async createAttempt() {
        attemptedWrite = true;
        return { id: "attempt:should-not-exist" };
      },
    },
  );
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };

  const listed = await gateway.fetch(
    mcpToolRequest("list_frontier_problems", {}, headers),
  );
  assert.equal(listed.status, 200);
  assert.deepEqual(storePrincipal, {
    clientId: "https://codex.example.test/client.json",
    personId: "did:proofweave:alice",
    agentInstallationId: "agent-installation:alice-codex",
    scopes: ["catalog:read"],
  });

  const attempted = await gateway.fetch(
    mcpToolRequest(
      "create_attempt",
      { problemSlug: "erdos-865", delegationScope: "prove", idempotencyKey: "attempt-1" },
      headers,
    ),
  );
  assert.equal(attempted.status, 200);
  const payload = await attempted.json();
  assert.equal(payload.result.isError, true);
  assert.match(payload.result.content[0].text, /Missing OAuth scope: attempt:create/);
  assert.equal(attemptedWrite, false);

  const attemptedRead = await gateway.fetch(mcpToolRequest("list_attempts", {}, headers));
  assert.equal(attemptedRead.status, 200);
  const attemptedReadPayload = await attemptedRead.json();
  assert.equal(attemptedReadPayload.result.isError, true);
  assert.match(attemptedReadPayload.result.content[0].text, /Missing OAuth scope: attempt:read/);
});

test("applies request quotas only after OAuth scope authorization", async () => {
  const operations = [];
  const gateway = gatewayWith(
    {
      async authenticate() {
        return {
          accessToken: "secret-token-that-must-not-reach-the-limiter",
          clientId: "https://codex.example.test/client.json",
          personId: "did:proofweave:alice",
          agentInstallationId: "agent-installation:alice-codex",
          scopes: ["catalog:read"],
        };
      },
      ...unavailableIdentity(),
    },
    fixtureStore(),
    {
      rateLimiter: {
        async enforce(principal, operation) {
          operations.push({ principal, operation });
        },
      },
    },
  );
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };

  const listed = await gateway.fetch(mcpToolRequest("list_frontier_problems", {}, headers));
  assert.equal(listed.status, 200);
  assert.deepEqual(operations, [{
    principal: {
      clientId: "https://codex.example.test/client.json",
      personId: "did:proofweave:alice",
      agentInstallationId: "agent-installation:alice-codex",
      scopes: ["catalog:read"],
    },
    operation: "list_frontier_problems",
  }]);

  const blocked = await gateway.fetch(mcpToolRequest(
    "create_attempt",
    { problemSlug: "erdos-865", delegationScope: "prove", idempotencyKey: "attempt-rate-limit" },
    headers,
  ));
  assert.equal(blocked.status, 200);
  assert.equal((await blocked.json()).result.isError, true);
  assert.equal(operations.length, 1);
});

test("requires verification:write and passes only bound attribution context to the attestation store", async () => {
  let submitted = null;
  const gateway = gatewayWith(
    {
      async authenticate() {
        return {
          accessToken: "secret-token-that-must-not-reach-the-store",
          clientId: "https://codex.example.test/client.json",
          personId: "did:proofweave:alice",
          agentInstallationId: "agent-installation:alice-codex",
          scopes: ["verification:write"],
        };
      },
      ...unavailableIdentity(),
    },
    {
      ...fixtureStore(),
      async submitVerificationAttestation(principal, attestation) {
        submitted = { principal, attestation };
        return { id: attestation.id, created: true };
      },
    },
  );
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
  };
  const response = await gateway.fetch(mcpToolRequest(
    "submit_verification_attestation",
    { attestation: remoteAttestationInput() },
    headers,
  ));
  assert.equal(response.status, 200);
  assert.deepEqual(submitted.principal, {
    clientId: "https://codex.example.test/client.json",
    personId: "did:proofweave:alice",
    agentInstallationId: "agent-installation:alice-codex",
    scopes: ["verification:write"],
  });
  assert.equal(submitted.attestation.id, "attestation:mcp-test");

  const ungrantedGateway = gatewayWith(
    {
      async authenticate() {
        return {
          accessToken: "different-secret-token",
          clientId: "https://codex.example.test/client.json",
          personId: "did:proofweave:alice",
          agentInstallationId: "agent-installation:alice-codex",
          scopes: ["catalog:read"],
        };
      },
      ...unavailableIdentity(),
    },
    {
      ...fixtureStore(),
      async submitVerificationAttestation() {
        throw new Error("The store must not receive an ungranted write.");
      },
    },
  );
  const blocked = await ungrantedGateway.fetch(mcpToolRequest(
    "submit_verification_attestation",
    { attestation: remoteAttestationInput() },
    headers,
  ));
  assert.equal(blocked.status, 200);
  const blockedPayload = await blocked.json();
  assert.equal(blockedPayload.result.isError, true);
  assert.match(blockedPayload.result.content[0].text, /Missing OAuth scope: verification:write/);
});

function unauthenticatedIdentity() {
  return {
    async authenticate() { return null; },
    ...unavailableIdentity(),
  };
}

function unavailableIdentity() {
  return {
    authorize: unavailable,
    token: unavailable,
    register: unavailable,
  };
}

function unavailable() {
  return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
}

function tokenRequest(fields) {
  return new Request(`${issuer}/token`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
}

function clientRegistrationRequest(metadata) {
  return new Request(`${issuer}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(metadata),
  });
}

class InMemoryOAuthStore {
  constructor() {
    this.codes = new Map();
    this.accessTokens = new Map();
    this.refreshTokens = new Map();
  }

  async findClient(clientId, redirectUri) {
    return clientId === "codex-test" && redirectUri === "https://codex.example.test/callback"
      ? { id: clientId }
      : null;
  }

  async findAgentInstallation(personId, installationId) {
    return personId === "did:proofweave:alice" && installationId === "installation:alice-codex"
      ? { id: installationId }
      : null;
  }

  async issueAuthorizationCode(record) {
    this.codes.set(record.codeHash, record);
  }

  async consumeAuthorizationCode(hash, now) {
    const record = this.codes.get(hash);
    this.codes.delete(hash);
    return record && record.expiresAt > now ? record : null;
  }

  async issueTokenPair(record) {
    const shared = {
      clientId: record.clientId,
      resource: record.resource,
      personId: record.personId,
      agentInstallationId: record.agentInstallationId,
      scopes: record.scopes,
      expiresAt: record.accessExpiresAt,
      installationActive: true,
    };
    this.accessTokens.set(record.accessTokenHash, shared);
    this.refreshTokens.set(record.refreshTokenHash, {
      ...shared,
      expiresAt: record.refreshExpiresAt,
    });
  }

  async findAccessToken(hash, expectedResource, now) {
    const record = this.accessTokens.get(hash);
    return record && record.resource === expectedResource && record.expiresAt > now ? record : null;
  }

  async consumeRefreshToken(hash, now) {
    const record = this.refreshTokens.get(hash);
    this.refreshTokens.delete(hash);
    return record && record.expiresAt > now ? record : null;
  }

  async registerClient(metadata) {
    return { client_id: "registered-test-client", ...metadata };
  }
}

async function pkceChallenge(verifier) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function mcpToolRequest(name, args, headers) {
  return new Request(resource, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

function remoteAttestationInput() {
  const hash = (character) => `sha256:${character.repeat(64)}`;
  return {
    protocolVersion: "pw-verification-attestation-v1",
    id: "attestation:mcp-test",
    assignmentId: "assignment:mcp-test",
    artifactBundleHash: hash("a"),
    claimType: "kernel_accepted",
    verifierPersonId: "did:proofweave:alice",
    verifierAgentId: "agent:mcp-test",
    delegationCertificateId: "delegation:mcp-test",
    verifierAgentPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    decision: "attested",
    evidenceHash: hash("b"),
    attestedAt: "2026-07-13T00:00:00Z",
    payloadHash: hash("c"),
    signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };
}
