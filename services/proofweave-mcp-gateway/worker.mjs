import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { remoteMcpScopes } from "../../packages/protocol/remote-mcp-scopes.mjs";
import { allowAllRemoteMcpRateLimiter } from "./d1-rate-limiter.mjs";

export { remoteMcpScopes };

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
  rateLimiter = allowAllRemoteMcpRateLimiter,
}) {
  if (!rateLimiter || typeof rateLimiter.enforce !== "function") {
    throw new TypeError("Proofweave MCP gateway requires a rate limiter with enforce().");
  }
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
        return handleMcpRequest(request, principal, store, resource, rateLimiter);
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

  async putArtifactObject() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async stageArtifactBundle() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async requestRunnerRun() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async requestVerificationReplay() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async getVerificationReplay() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async getRunnerRun() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }

  async cancelRunnerRun() {
    throw new Error("The Proofweave remote control plane is not configured.");
  }
}

async function handleMcpRequest(request, principal, store, resource, rateLimiter) {
  const server = createMcpServer(operationPrincipal(principal), store, rateLimiter);
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

function createMcpServer(principal, store, rateLimiter) {
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
    async () => toolResult(await withScope(principal, "catalog:read", "list_frontier_problems", rateLimiter, () => store.listFrontier(principal))),
  );

  server.registerTool(
    "inspect_problem",
    {
      title: "Inspect a frontier problem",
      description: "Read one source-pinned target and its distinct claim layers.",
      inputSchema: { slug: z.string().min(1).max(120) },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async ({ slug }) => toolResult(await withScope(principal, "catalog:read", "inspect_problem", rateLimiter, () => store.inspectProblem(principal, slug))),
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
    async (input) => toolResult(await withScope(principal, "attempt:create", "create_attempt", rateLimiter, () => store.createAttempt(principal, input))),
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
    async ({ attemptId, ...input }) => toolResult(await withScope(principal, "progress:write", "report_progress", rateLimiter, () => store.reportProgress(principal, { attemptId, ...input }))),
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
      "list_attempts",
      rateLimiter,
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
    async ({ attemptId }) => toolResult(await withScope(principal, "attempt:read", "get_attempt", rateLimiter, () => store.getAttempt(principal, attemptId))),
  );

  server.registerTool(
    "put_artifact_object",
    {
      title: "Stage one immutable artifact object",
      description: "Store one bounded, content-addressed artifact for an authorized Attempt. This does not execute Lean or verify a proof.",
      inputSchema: {
        attemptId: z.string().min(1).max(160),
        filename: z.string().min(1).max(128),
        contentType: z.string().min(1).max(255),
        contentBase64Url: z.string().min(1).max(44_739_243).regex(/^[A-Za-z0-9_-]+$/),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => toolResult(await withScope(
      principal,
      "artifact:write",
      "put_artifact_object",
      rateLimiter,
      () => store.putArtifactObject(principal, input),
    )),
  );

  server.registerTool(
    "stage_artifact_bundle",
    {
      title: "Stage a signed Artifact Bundle",
      description: "Validate and persist a signed, reproducible Artifact Bundle for an authorized Attempt. Staging is not a Lean run, review, or receipt.",
      inputSchema: {
        bundle: z.object({}).passthrough(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async ({ bundle }) => toolResult(await withScope(
      principal,
      "artifact:write",
      "stage_artifact_bundle",
      rateLimiter,
      () => store.stageArtifactBundle(principal, bundle),
    )),
  );

  server.registerTool(
    "request_runner_run",
    {
      title: "Request an isolated Lean Run",
      description: "Queue one staged v2 Artifact Bundle for the isolated Lean Runner. This is not kernel acceptance, independent review, or a receipt.",
      inputSchema: {
        attemptId: z.string().min(1).max(160),
        artifactBundleHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        idempotencyKey: z.string().min(1).max(160),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => toolResult(await withScope(
      principal,
      "run:request",
      "request_runner_run",
      rateLimiter,
      () => store.requestRunnerRun(principal, input),
    )),
  );

  server.registerTool(
    "request_verification_replay",
    {
      title: "Replay an assigned Bundle in a fresh workspace",
      description: "Queue a new isolated Lean workspace only for an accepted independent-review assignment. This records reproducibility evidence, not an attestation, theorem verification, or receipt.",
      inputSchema: {
        assignmentId: z.string().min(1).max(240),
        idempotencyKey: z.string().min(1).max(160),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => toolResult(await withScope(
      principal,
      "verification:replay",
      "request_verification_replay",
      rateLimiter,
      () => store.requestVerificationReplay(principal, input),
    )),
  );

  server.registerTool(
    "get_verification_replay",
    {
      title: "Read a fresh verification replay",
      description: "Read one review Agent's own replay Run and immutable event hashes. Its result is infrastructure evidence; the reviewer must still issue a separate signed attestation.",
      inputSchema: {
        assignmentId: z.string().min(1).max(240),
        idempotencyKey: z.string().min(1).max(160),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => toolResult(await withScope(
      principal,
      "verification:replay",
      "get_verification_replay",
      rateLimiter,
      () => store.getVerificationReplay(principal, input),
    )),
  );

  server.registerTool(
    "get_runner_run",
    {
      title: "Read an isolated Lean Run",
      description: "Read the selected Agent's exact Run state and immutable event hashes. A recorded Runner result is not independent review or a receipt.",
      inputSchema: {
        attemptId: z.string().min(1).max(160),
        runId: z.string().min(1).max(240),
      },
      annotations: { readOnlyHint: true, destructiveHint: false },
    },
    async (input) => toolResult(await withScope(
      principal,
      "run:read",
      "get_runner_run",
      rateLimiter,
      () => store.getRunnerRun(principal, input),
    )),
  );

  server.registerTool(
    "cancel_runner_run",
    {
      title: "Cancel an isolated Lean Run",
      description: "Request cancellation only for the selected Agent's exact active Run. Repeating a lost response is safe and preserves the first cancellation record.",
      inputSchema: {
        attemptId: z.string().min(1).max(160),
        runId: z.string().min(1).max(240),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => toolResult(await withScope(
      principal,
      "run:cancel",
      "cancel_runner_run",
      rateLimiter,
      () => store.cancelRunnerRun(principal, input),
    )),
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
          decision: z.enum(["attested", "rejected", "request_changes", "conflict_declared", "integrity_flagged"]),
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
      "submit_verification_attestation",
      rateLimiter,
      () => store.submitVerificationAttestation(principal, attestation),
    )),
  );

  return server;
}

async function withScope(principal, scope, operation, rateLimiter, action) {
  if (!principal.scopes.includes(scope)) {
    return { error: `Missing OAuth scope: ${scope}.` };
  }

  try {
    await rateLimiter.enforce(principal, operation);
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
