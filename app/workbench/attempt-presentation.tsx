import { type McpAttempt, type McpRunSummary } from "@/packages/domain/mcp";
import { hasAcceptedKernelEvidence } from "./accepted-kernel-evidence";
import type { Translator } from "@/app/i18n/translate";

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
  t,
}: {
  attempt: McpAttempt;
  runs: readonly McpRunSummary[];
  agentConnected: boolean;
  t: Translator;
}): AttemptPresentation {
  if (attempt.status === "paused") {
    return {
      bucket: "needs-attention",
      label: t("attemptPresentation.paused.label"),
      tone: "attention",
      nextAction: t("attemptPresentation.paused.action"),
      detail: t("attemptPresentation.paused.detail"),
    };
  }
  if (attempt.status !== "active") {
    return {
      bucket: "history",
      label: attempt.status === "submitted" ? t("attemptPresentation.submitted.label") : attempt.status === "completed" ? t("attemptPresentation.completed.label") : t("attemptPresentation.abandoned.label"),
      tone: "complete",
      nextAction: t("attemptPresentation.history.action"),
      detail: t("attemptPresentation.history.detail"),
    };
  }

  const latestRun = runs
    .filter((run) => run.attemptId === attempt.id)
    .sort((left, right) => Date.parse(right.queuedAt) - Date.parse(left.queuedAt))[0] ?? null;
  const hasBundle = attempt.events.some((event) => event.type === "bundle_staged");
  const hasProgress = attempt.events.some((event) => event.type === "agent_reported");
  const deliveryStopped = Boolean(latestRun && ["queued", "preparing", "running"].includes(latestRun.state) && latestRun.delivery?.state === "dead_letter");
  const runPending = Boolean(latestRun && !deliveryStopped && ["queued", "preparing", "running", "cancel_requested"].includes(latestRun.state));
  const runFailed = Boolean(latestRun && (deliveryStopped || ["failed", "timed_out", "rejected", "cancelled"].includes(latestRun.state)));
  const kernelAccepted = hasAcceptedKernelEvidence(latestRun);

  if (!agentConnected) return {
    bucket: "needs-attention",
    label: t("attemptPresentation.needsAttention.label"),
    tone: "attention",
    nextAction: t("attemptPresentation.needsAttention.action"),
    detail: t("attemptPresentation.needsAttention.detail"),
  };
  if (runFailed) return {
    bucket: "needs-attention",
    label: deliveryStopped ? t("attemptPresentation.deliveryStopped.label") : t("attemptPresentation.leanFailed.label"),
    tone: "attention",
    nextAction: t("attemptPresentation.leanFailed.action"),
    detail: deliveryStopped ? t("attemptPresentation.deliveryStopped.detail") : t("attemptPresentation.leanFailed.detail"),
  };
  if (runPending) return {
    bucket: "waiting",
    label: t("attemptPresentation.leanRunning.label"),
    tone: "waiting",
    nextAction: t("attemptPresentation.leanRunning.action"),
    detail: t("attemptPresentation.leanRunning.detail"),
  };
  if (kernelAccepted) return {
    bucket: "waiting",
    label: t("attemptPresentation.review.label"),
    tone: "waiting",
    nextAction: t("attemptPresentation.review.action"),
    detail: t("attemptPresentation.review.detail"),
  };
  if (hasBundle) return {
    bucket: "waiting",
    label: t("attemptPresentation.checkpoint.label"),
    tone: "waiting",
    nextAction: t("attemptPresentation.checkpoint.action"),
    detail: t("attemptPresentation.checkpoint.detail"),
  };
  return {
    bucket: "active",
    label: hasProgress ? t("attemptPresentation.researching.label") : t("attemptPresentation.ready.label"),
    tone: "active",
    nextAction: hasProgress ? t("attemptPresentation.researching.action") : t("attemptPresentation.ready.action"),
    detail: hasProgress ? t("attemptPresentation.researching.detail") : t("attemptPresentation.ready.detail"),
  };
}
export function AttemptStatusBadge({ presentation }: { presentation: AttemptPresentation }) {
  return <span className={`attempt-status-badge is-${presentation.tone}`}><i aria-hidden="true" />{presentation.label}</span>;
}
