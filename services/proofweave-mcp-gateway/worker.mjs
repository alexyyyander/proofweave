import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export const remoteMcpScopes = [
  "catalog:read",
  "attempt:create",
  "attempt:read",
  "progress:write",
  "verification:write",
];

/**
 * Create the remote Proofweave MCP protected resource. OAuth issuance and
 * Proofweave data access are injected because they deploy outside the Sites
 * frontend and must not inherit its identity headers or bypass credentials.
 */
export function createRemoteMcpGateway({
  resource,
  issuer,
  identityProvider,
  store,
}) {
  const resourceUrl = new URL(resource);
  const resourceMetadataUrl = new URL(
    "/.well-known/oauth-protected-resource",
    resourceUrl,
  ).toString();

  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (url.origin !== resourceUrl.origin) return new Response("Not found", { status: 404 });

      if (
        request.method === "GET" &&
        url.pathname === "/.well-known/oauth-protected-resource"
      ) {
        return json({
          resource,
          authorization_servers: [issuer],
          scopes_supported: remoteMcpScopes,
        });
      }

      if (url.pathname === resourceUrl.pathname) {
        let principal;
        try {
          principal = await identityProvider.authenticate(request);
        } catch {
          return unauthorized(resourceMetadataUrl);
        }
        if (!validPrincipal(principal)) return unauthorized(resourceMetadataUrl);
        return handleMcpRequest(request, principal, store, resource);
      }

      return new Response("Not found", { status: 404 });
    },
  };
}

export class UnconfiguredIdentityProvider {
  async authenticate() {
    return null;
  }

  authorize() {
    return oauthUnavailable();
  }

  token() {
    return oauthUnavailable();
  }

  register() {
    return oauthUnavailable();
  }
}

export class UnconfiguredGatewayStore {
  async listFrontier() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async inspectProblem() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async createAttempt() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async reportProgress() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async getAttempt() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async listAttempts() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async submitVerificationAttestation() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }
}

async function handleMcpRequest(request, principal, store, resource) {
  const server = createMcpServer(operationPrincipal(principal), store);
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return transport.handleRequest(request, {
    authInfo: authInfo(principal, resource),
  });
}

function authInfo(principal, resource) {
  return {
    token: principal.accessToken,
    clientId: principal.clientId,
    scopes: [...principal.scopes],
    ...(principal.expiresAt ? { expiresAt: principal.expiresAt } : {}),
    resource: new URL(resource),
    extra: {
      personId: principal.personId,
      agentInstallationId: principal.agentInstallationId,
    },
  };
}

function operationPrincipal(principal) {
  return {
    clientId: principal.clientId,
    personId: principal.personId,
    agentInstallationId: principal.agentInstallationId,
    scopes: [...principal.scopes],
  };
}

function validPrincipal(principal) {
  return Boolean(
    principal &&
      nonEmptyString(principal.accessToken) &&
      nonEmptyString(principal.clientId) &&
      nonEmptyString(principal.personId) &&
      nonEmptyString(principal.agentInstallationId) &&
      Array.isArray(principal.scopes) &&
      new Set(principal.scopes).size === principal.scopes.length &&
      principal.scopes.every((scope) => remoteMcpScopes.includes(scope)),
  );
}

function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function createMcpServer(principal, store) {
  const server = new McpServer(
    { name: "proofweave-mcp", version: "0.2.0" },
    {
      instructions:
        "Proofweave records provisional research work only. Never describe an agent-reported event as Lean verification, independent review, or a contribution receipt.",
    },
  );

  server.registerTool(
    "list_frontier_problems",
    {
      title: "List frontier problems",
      description: "List source-pinned frontier records.",
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async () => toolResult(await withScope(principal, "catalog:read", () => store.listFrontier(principal))),
  );

  server.registerTool(
    "inspect_problem",
    {
      title: "Inspect a frontier problem",
      description: "Read one source-pinned target and its distinct claim layers.",
      inputSchema: { slug: z.string().min(1).max(120) },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ slug }) => toolResult(await withScope(principal, "catalog:read", () => store.inspectProblem(principal, slug))),
  );

  server.registerTool(
    "create_attempt",
    {
      title: "Create a bounded Attempt",
      description: "Create a Person-owned provisional Attempt. This does not create a verification claim or receipt.",
      inputSchema: {
        problemSlug: z.string().min(1).max(120),
        delegationScope: z.enum(["formalize", "prove"]),
        idempotencyKey: z.string().min(1).max(160),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => toolResult(await withScope(principal, "attempt:create", () => store.createAttempt(principal, input))),
  );

  server.registerTool(
    "report_progress",
    {
      title: "Report provisional progress",
      description: "Append an evidence-bound agent-reported event. It is not Lean verification.",
      inputSchema: {
        attemptId: z.string().min(1).max(160),
        message: z.string().min(1).max(2_000),
        progressPercent: z.number().int().min(0).max(100),
        idempotencyKey: z.string().min(1).max(160),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ attemptId, ...input }) => toolResult(await withScope(principal, "progress:write", () => store.reportProgress(principal, { attemptId, ...input }))),
  );

  server.registerTool(
    "list_attempts",
    {
      title: "List authorized Attempts",
      description: "List recently updated Attempts bound to the selected Agent installation and delegation certificate only.",
      inputSchema: { limit: z.number().int().min(1).max(100).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ limit }) => toolResult(await withScope(
      principal,
      "attempt:read",
      () => store.listAttempts(principal, { limit }),
    )),
  );

  server.registerTool(
    "get_attempt",
    {
      title: "Read an Attempt",
      description: "Read the authorized Person's Attempt and publication-facing events.",
      inputSchema: { attemptId: z.string().min(1).max(160) },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ attemptId }) => toolResult(await withScope(principal, "attempt:read", () => store.getAttempt(principal, attemptId))),
  );

  server.registerTool(
    "submit_verification_attestation",
    {
      title: "Submit a signed verification attestation",
      description: "Submit an externally signed review-Agent attestation for an assigned Bundle. It is one explicit claim, never a contribution receipt.",
      inputSchema: {
        attestation: z.object({
          protocolVersion: z.literal("pw-verification-attestation-v1"),
          id: z.string().min(1).max(240),
          assignmentId: z.string().min(1).max(240),
          artifactBundleHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          claimType: z.enum(["bundle_reproducible", "kernel_accepted", "statement_faithful", "novelty_reviewed", "project_accepted"]),
          verifierPersonId: z.string().min(1).max(240),
          verifierAgentId: z.string().min(1).max(240),
          delegationCertificateId: z.string().min(1).max(240),
          verifierAgentPublicKey: z.string().min(1).max(256),
          decision: z.enum(["attested", "rejected", "request_changes"]),
          evidenceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          attestedAt: z.string().min(1).max(64),
          payloadHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          signature: z.string().min(1).max(256),
        }).strict(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ attestation }) => toolResult(await withScope(
      principal,
      "verification:write",
      () => store.submitVerificationAttestation(principal, attestation),
    )),
  );

  return server;
}

async function withScope(principal, scope, action) {
  if (!principal.scopes.includes(scope)) {
    return { error: `Missing OAuth scope: ${scope}.` };
  }

  try {
    return { value: await action() };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "The Proofweave control plane could not complete the request.",
    };
  }
}

function toolResult(result) {
  if ("error" in result) {
    return {
      content: [{ type: "text", text: result.error }],
      isError: true,
    };
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }],
  };
}

function unauthorized(resourceMetadataUrl) {
  return json(
    { error: "invalid_token", error_description: "Proofweave OAuth authorization is required." },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
    },
  );
}

function oauthUnavailable() {
  return json(
    {
      error: "temporarily_unavailable",
      error_description: "Proofweave Identity is not configured for this gateway yet.",
    },
    503,
  );
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

export default createRemoteMcpGateway({
  resource: "https://mcp.proofweave.org/mcp",
  issuer: "https://auth.proofweave.org",
  identityProvider: new UnconfiguredIdentityProvider(),
  store: new UnconfiguredGatewayStore(),
});
