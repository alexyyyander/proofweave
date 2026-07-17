import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const baseUrl = process.env.PROOFWEAVE_BASE_URL?.replace(/\/$/, "");
const apiToken = process.env.PROOFWEAVE_API_TOKEN;
const siteBypassToken = process.env.PROOFWEAVE_SITE_BYPASS_TOKEN;

const server = new McpServer({
  name: "proofweave-mcp",
  version: "0.1.0",
});

server.registerTool(
  "list_frontier_problems",
  {
    title: "List frontier problems",
    description:
      "List Proofweave frontier records with pinned source and verification-state metadata.",
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async () => asToolResult(await api("/api/v1/mcp/problems")),
);

server.registerTool(
  "inspect_problem",
  {
    title: "Inspect a frontier problem",
    description:
      "Read one pinned Proofweave target before starting an attempt. Never infer kernel verification from this record.",
    inputSchema: { slug: z.string().min(1).max(120) },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ slug }) =>
    asToolResult(
      await api(`/api/v1/mcp/problems?slug=${encodeURIComponent(slug)}`),
    ),
);

server.registerTool(
  "create_attempt",
  {
    title: "Create an agent-reported attempt",
    description:
      "Open a provisional Proofweave attempt. This does not create a verification claim or contribution receipt.",
    inputSchema: {
      problemSlug: z.string().min(1).max(120),
      agentLabel: z.string().min(1).max(120),
      idempotencyKey: z.string().min(1).max(160),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async (input) =>
    asToolResult(
      await api("/api/v1/mcp/attempts", { method: "POST", body: input }),
    ),
);

server.registerTool(
  "report_progress",
  {
    title: "Report provisional progress",
    description:
      "Append an agent-reported progress event. Do not report a theorem as verified without a runner result.",
    inputSchema: {
      attemptId: z.string().min(1).max(160),
      message: z.string().min(1).max(2_000),
      progressPercent: z.number().int().min(0).max(100),
      idempotencyKey: z.string().min(1).max(160),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ attemptId, ...input }) =>
    asToolResult(
      await api(`/api/v1/mcp/attempts/${encodeURIComponent(attemptId)}/events`, {
        method: "POST",
        body: input,
      }),
    ),
);

server.registerTool(
  "get_attempt",
  {
    title: "Read an attempt",
    description:
      "Read the caller's attempt and its ordered agent-reported events.",
    inputSchema: { attemptId: z.string().min(1).max(160) },
    annotations: { readOnlyHint: true, destructiveHint: false },
  },
  async ({ attemptId }) =>
    asToolResult(
      await api(`/api/v1/mcp/attempts/${encodeURIComponent(attemptId)}`),
    ),
);

await server.connect(new StdioServerTransport());

async function api(path, init = {}) {
  if (!baseUrl || !apiToken) {
    throw new Error(
      "Set PROOFWEAVE_BASE_URL and PROOFWEAVE_API_TOKEN before starting proofweave-mcp.",
    );
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiToken}`,
    ...(siteBypassToken
      ? { "OAI-Sites-Authorization": `Bearer ${siteBypassToken}` }
      : {}),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ?? `Proofweave API returned ${response.status}.`,
    );
  }
  return payload;
}

function asToolResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}
