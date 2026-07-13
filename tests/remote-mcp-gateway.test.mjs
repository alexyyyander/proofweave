import assert from "node:assert/strict";
import test from "node:test";
import { createProofweaveIdentityService } from "../services/proofweave-identity/worker.mjs";
import {
  createOAuthAccessTokenAuthenticator,
  createProofweaveOAuthProvider,
} from "../services/proofweave-identity/oauth.mjs";
import { createRemoteMcpGateway, remoteMcpScopes } from "../services/proofweave-mcp-gateway/worker.mjs";

const resource = "https://mcp.example.test/mcp";
const issuer = "https://auth.example.test";

function gatewayWith(identityProvider, store = fixtureStore()) {
  return createRemoteMcpGateway({
    resource,
    issuer,
    identityProvider,
    store,
  });
}

function fixtureStore() {
  return {
    async listFrontier() { return [{ slug: "erdos-865" }]; },
    async inspectProblem(_principal, slug) { return { slug }; },
    async createAttempt(_principal, input) { return { id: "attempt:test", ...input }; },
    async reportProgress(_principal, input) { return { id: "event:test", ...input }; },
    async getAttempt(_principal, attemptId) { return { id: attemptId }; },
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
      { problemSlug: "erdos-865", idempotencyKey: "attempt-1" },
      headers,
    ),
  );
  assert.equal(attempted.status, 200);
  const payload = await attempted.json();
  assert.equal(payload.result.isError, true);
  assert.match(payload.result.content[0].text, /Missing OAuth scope: attempt:create/);
  assert.equal(attemptedWrite, false);
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
