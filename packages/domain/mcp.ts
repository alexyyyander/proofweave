export const mcpAttemptEventTypes = [
  "attempt_created",
  "agent_reported",
  "bundle_staged",
] as const;

export type McpAttemptEventType = (typeof mcpAttemptEventTypes)[number];
export type McpAttemptStatus = "active" | "submitted" | "cancelled";

export type McpAttemptEvent = Readonly<{
  id: string;
  sequence: number;
  type: McpAttemptEventType;
  message: string;
  progressPercent: number | null;
  occurredAt: string;
}>;

export type McpAttempt = Readonly<{
  id: string;
  problemRevisionId: string;
  problemSlug: string;
  problemTitle: string;
  agentId: string | null;
  agentLabel: string;
  delegationCertificateId: string | null;
  delegationScope: "formalize" | "prove" | null;
  status: McpAttemptStatus;
  lastProgressPercent: number | null;
  createdAt: string;
  updatedAt: string;
  events: readonly McpAttemptEvent[];
  verificationState: "agent_reported_only";
}>;

// This initial MCP surface intentionally cannot emit any mathematical
// verification status. A future isolated runner is the only producer of
// kernel results, and a different owner is required for review.
export const agentReportedOnly = "agent_reported_only" as const;
