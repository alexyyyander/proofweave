export const mcpAttemptEventTypes = [
  "attempt_created",
  "agent_reported",
  "bundle_staged",
  "attempt_cancelled",
] as const;

export type McpAttemptEventType = (typeof mcpAttemptEventTypes)[number];
export type McpAttemptStatus = "active" | "submitted" | "cancelled";

export const mcpRunStates = [
  "queued",
  "preparing",
  "running",
  "cancel_requested",
  "succeeded",
  "failed",
  "timed_out",
  "rejected",
  "cancelled",
] as const;

export type McpRunState = (typeof mcpRunStates)[number];
export type McpRunEvidenceState = "not_recorded" | "recorded" | "unreadable";

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

/**
 * A deliberately small, owner-scoped projection of an isolated Lean Run.
 * Full signed result payloads and stdout/stderr remain in controlled evidence
 * records. `unreadable` means a persisted row exists but cannot be safely
 * presented as a normalized Runner verdict.
 */
export type McpRunnerResultSummary = Readonly<{
  status: "succeeded" | "failed" | "timed_out" | "rejected" | "cancelled";
  exitCode: number;
  kernelStatus: "accepted" | "rejected" | "not_run";
  checks: Readonly<{
    network: "passed" | "failed" | "not_run";
    noSorry: "passed" | "failed" | "not_run";
    allowedAxioms: "passed" | "failed" | "not_run";
    leanBuild: "passed" | "failed" | "not_run";
  }>;
}>;

export type McpRunSummary = Readonly<{
  id: string;
  attemptId: string;
  artifactBundleHash: string;
  state: McpRunState;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  runnerResultHash: string | null;
  evidenceState: McpRunEvidenceState;
  result: Readonly<{
    resultHash: string;
    receivedAt: string;
    summary: McpRunnerResultSummary;
  }> | null;
}>;

// This initial MCP surface intentionally cannot emit any mathematical
// verification status. A future isolated runner is the only producer of
// kernel results, and a different owner is required for review.
export const agentReportedOnly = "agent_reported_only" as const;
