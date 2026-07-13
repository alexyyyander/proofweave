import assert from "node:assert/strict";
import test from "node:test";
import { createProofweaveIdentityService } from "../services/proofweave-identity/worker.mjs";
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
