import type { McpRunSummary } from "@/packages/domain/mcp";
import { hasAcceptedKernelEvidence } from "./accepted-kernel-evidence.ts";
import type { Translator } from "@/app/i18n/translate";

export type RunnerWorkflowStatus = Readonly<{
  tone: "pending" | "waiting" | "running" | "accepted" | "failed";
  badge: string;
  title: string;
  detail: string;
  technicalTitle: string;
  technicalDetail: string;
}>;

/**
 * Translate durable Runner lifecycle records into the small amount of state an
 * Attempt owner needs to act on. In particular, this deliberately hides the
 * control-plane's transport-only wake diagnostics: an immutable Bundle queued
 * for a free-tier Runner is not a failed proof and should not be resubmitted.
 */
export function runnerWorkflowStatus(
  run: McpRunSummary | null | undefined,
  bundleStaged: boolean,
  t: Translator,
): RunnerWorkflowStatus {
  if (!run) {
    return bundleStaged
      ? {
          tone: "pending",
          badge: t("runnerWorkflow.noRun.badgeRunnerNeeded"),
          title: t("runnerWorkflow.noRun.titleReady"),
          detail: t("runnerWorkflow.noRun.detailReady"),
          technicalTitle: t("runnerWorkflow.noRun.technicalTitle"),
          technicalDetail: t("runnerWorkflow.noRun.technicalDetail"),
        }
      : {
          tone: "pending",
          badge: t("runnerWorkflow.noRun.badgeAwaitingEvidence"),
          title: t("runnerWorkflow.noRun.titleNoEvidence"),
          detail: t("runnerWorkflow.noRun.detailNoEvidence"),
          technicalTitle: t("runnerWorkflow.noRun.technicalTitle"),
          technicalDetail: t("runnerWorkflow.noRun.technicalDetail"),
        };
  }

  if (hasAcceptedKernelEvidence(run)) {
    return {
      tone: "accepted",
      badge: t("runnerWorkflow.accepted.badge"),
      title: t("runnerWorkflow.accepted.title"),
      detail: t("runnerWorkflow.accepted.detail"),
      technicalTitle: t("runnerWorkflow.accepted.technicalTitle"),
      technicalDetail: t("runnerWorkflow.accepted.technicalDetail"),
    };
  }

  if (run.evidenceState === "unreadable") {
    return {
      tone: "failed",
      badge: t("runnerWorkflow.unreadable.badge"),
      title: t("runnerWorkflow.unreadable.title"),
      detail: t("runnerWorkflow.unreadable.detail"),
      technicalTitle: t("runnerWorkflow.unreadable.technicalTitle"),
      technicalDetail: t("runnerWorkflow.unreadable.technicalDetail"),
    };
  }

  if (run.result?.summary) {
    return {
      tone: "failed",
      badge: t("runnerWorkflow.failedResult.badge"),
      title: t("runnerWorkflow.failedResult.title"),
      detail: t("runnerWorkflow.failedResult.detail"),
      technicalTitle: t("runnerWorkflow.failedResult.technicalTitle", { status: run.result.summary.status }),
      technicalDetail: t("runnerWorkflow.failedResult.technicalDetail"),
    };
  }

  switch (run.state) {
    case "queued":
      return {
        tone: "waiting",
        badge: t("runnerWorkflow.queued.badge"),
        title: t("runnerWorkflow.queued.title"),
        detail: t("runnerWorkflow.queued.detail"),
        technicalTitle: t("runnerWorkflow.lifecycle.technicalTitle", { state: "queued" }),
        technicalDetail: t("runnerWorkflow.lifecycle.technicalDetail"),
      };
    case "preparing":
      return {
        tone: "running",
        badge: t("runnerWorkflow.preparing.badge"),
        title: t("runnerWorkflow.preparing.title"),
        detail: t("runnerWorkflow.preparing.detail"),
        technicalTitle: t("runnerWorkflow.lifecycle.technicalTitle", { state: "preparing" }),
        technicalDetail: t("runnerWorkflow.lifecycle.technicalDetail"),
      };
    case "running":
      return {
        tone: "running",
        badge: t("runnerWorkflow.running.badge"),
        title: t("runnerWorkflow.running.title"),
        detail: t("runnerWorkflow.running.detail"),
        technicalTitle: t("runnerWorkflow.lifecycle.technicalTitle", { state: "running" }),
        technicalDetail: t("runnerWorkflow.lifecycle.technicalDetail"),
      };
    case "cancel_requested":
      return {
        tone: "waiting",
        badge: t("runnerWorkflow.cancel.badge"),
        title: t("runnerWorkflow.cancel.title"),
        detail: t("runnerWorkflow.cancel.detail"),
        technicalTitle: t("runnerWorkflow.cancel.technicalTitle"),
        technicalDetail: t("runnerWorkflow.lifecycle.technicalDetail"),
      };
    case "failed":
    case "timed_out":
    case "rejected":
    case "cancelled":
      return {
        tone: "failed",
        badge: t("runnerWorkflow.terminal.badge"),
        title: t("runnerWorkflow.terminal.title"),
        detail: t("runnerWorkflow.terminal.detail"),
        technicalTitle: t("runnerWorkflow.terminal.technicalTitle", { state: run.state }),
        technicalDetail: t("runnerWorkflow.terminal.technicalDetail"),
      };
    case "succeeded":
      return {
        tone: "failed",
        badge: t("runnerWorkflow.succeeded.badge"),
        title: t("runnerWorkflow.succeeded.title"),
        detail: t("runnerWorkflow.succeeded.detail"),
        technicalTitle: t("runnerWorkflow.succeeded.technicalTitle"),
        technicalDetail: t("runnerWorkflow.succeeded.technicalDetail"),
      };
  }
}
