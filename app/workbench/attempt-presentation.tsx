import type { McpAttempt, McpRunSummary } from "@/packages/domain/mcp";

export type AttemptBucket = "needs-attention" | "active" | "waiting" | "history";

export type AttemptPresentation = Readonly<{
  bucket: AttemptBucket;
  label: string;
  tone: "attention" | "active" | "waiting" | "complete";
  nextAction: string;
  detail: string;
}>;

export function deriveAttemptPresentation({
  attempt,
  runs,
  agentConnected,
}: {
  attempt: McpAttempt;
  runs: readonly McpRunSummary[];
  agentConnected: boolean;
}): AttemptPresentation {
  if (attempt.status !== "active") {
    return {
      bucket: "history",
      label: attempt.status === "submitted" ? "Submitted" : "Closed",
      tone: "complete",
      nextAction: "Inspect retained records",
      detail: "No future Agent progress is accepted for this Attempt.",
    };
  }

  const latestRun = runs
    .filter((run) => run.attemptId === attempt.id)
    .sort((left, right) => Date.parse(right.queuedAt) - Date.parse(left.queuedAt))[0] ?? null;
  const hasBundle = attempt.events.some((event) => event.type === "bundle_staged");
  const hasProgress = attempt.events.some((event) => event.type === "agent_reported");
  const runPending = Boolean(latestRun && ["queued", "preparing", "running", "cancel_requested"].includes(latestRun.state));
  const runFailed = Boolean(latestRun && ["failed", "timed_out", "rejected", "cancelled"].includes(latestRun.state));
  const kernelAccepted = latestRun?.result?.summary.kernelStatus === "accepted"
    && latestRun.result.summary.checks.leanBuild === "passed"
    && latestRun.result.summary.checks.noSorry === "passed"
    && latestRun.result.summary.checks.allowedAxioms === "passed";

  if (!agentConnected) return {
    bucket: "needs-attention",
    label: "Needs attention",
    tone: "attention",
    nextAction: "Restore the bound Agent approval",
    detail: "This Attempt cannot accept new work until its delegated Agent has an active website approval again.",
  };
  if (runFailed) return {
    bucket: "needs-attention",
    label: "Lean check needs attention",
    tone: "attention",
    nextAction: "Inspect the failed Run",
    detail: "The latest isolated Run ended without an accepted kernel result.",
  };
  if (runPending) return {
    bucket: "waiting",
    label: "Lean check running",
    tone: "waiting",
    nextAction: "Wait for the isolated Run",
    detail: "Proofweave is waiting for a signed Runner result.",
  };
  if (kernelAccepted) return {
    bucket: "waiting",
    label: "Awaiting independent review",
    tone: "waiting",
    nextAction: "Track verification",
    detail: "Lean evidence passed; independent claims still need a different owner.",
  };
  if (hasBundle) return {
    bucket: "waiting",
    label: "Checkpoint ready",
    tone: "waiting",
    nextAction: "Complete the Lean check",
    detail: "A signed evidence Bundle is staged for this Attempt.",
  };
  return {
    bucket: "active",
    label: hasProgress ? "Researching" : "Ready to start",
    tone: "active",
    nextAction: hasProgress ? "Continue with your Agent" : "Send the target to your Agent",
    detail: hasProgress ? "Agent-reported progress is recorded, but not yet verified." : "The bounded workspace is ready for its first research step.",
  };
}
export function AttemptStatusBadge({ presentation }: { presentation: AttemptPresentation }) {
  return <span className={`attempt-status-badge is-${presentation.tone}`}><i aria-hidden="true" />{presentation.label}</span>;
}
