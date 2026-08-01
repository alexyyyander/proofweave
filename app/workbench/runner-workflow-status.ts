import type { McpRunSummary } from "@/packages/domain/mcp";
import { hasAcceptedKernelEvidence } from "./accepted-kernel-evidence.ts";

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
): RunnerWorkflowStatus {
  if (!run) {
    return bundleStaged
      ? {
          tone: "pending",
          badge: "Runner needed",
          title: "Your approved Bundle is ready for an isolated Lean Run.",
          detail: "The evidence is safely recorded, but no Runner request exists yet. Start or inspect the exact evidence when you are ready to verify it.",
          technicalTitle: "Lean kernel status · no Run recorded",
          technicalDetail: "No isolated Lean Run is recorded for this Attempt. Only a Runner can record compiler diagnostics, a sorry audit, axioms, and kernel acceptance.",
        }
      : {
          tone: "pending",
          badge: "Awaiting evidence",
          title: "No evidence has been approved for verification.",
          detail: "Private work and local previews do not move this step. Proofweave does not render a sample source file or a fictional compiler result in place of a complete, Agent-signed Bundle.",
          technicalTitle: "Lean kernel status · no Run recorded",
          technicalDetail: "No isolated Lean Run is recorded for this Attempt. Only a Runner can record compiler diagnostics, a sorry audit, axioms, and kernel acceptance.",
        };
  }

  if (hasAcceptedKernelEvidence(run)) {
    return {
      tone: "accepted",
      badge: "Lean accepted",
      title: "Lean accepted the approved evidence.",
      detail: "The signed Runner result passed its isolated kernel and policy checks. A different owner must still independently review the same Bundle before any Contribution Receipt can exist.",
      technicalTitle: "Lean kernel status · accepted",
      technicalDetail: "The recorded signed result passed the network, sorry, axiom, and Lean build checks. Inspect controlled evidence for the complete immutable record.",
    };
  }

  if (run.evidenceState === "unreadable") {
    return {
      tone: "failed",
      badge: "Inspection required",
      title: "The stored Runner result needs controlled inspection.",
      detail: "Proofweave cannot safely normalize this result as a Lean verdict. Inspect the bound evidence before retrying or publishing any further claim.",
      technicalTitle: "Lean Runner result needs controlled inspection",
      technicalDetail: "A stored result row could not be normalized and bound to this Run, so Proofweave will not show it as a Lean verdict. Inspect controlled evidence before acting on it.",
    };
  }

  if (run.result?.summary) {
    return {
      tone: "failed",
      badge: "Lean check did not pass",
      title: "This isolated Lean Run did not meet the accepted gate.",
      detail: "The result is recorded for inspection. Do not describe the Bundle as Lean-accepted; prepare a corrected Bundle or start a new isolated Run.",
      technicalTitle: `Lean Runner result · ${run.result.summary.status}`,
      technicalDetail: "This terminal Runner result is recorded, but it did not meet the accepted Lean gate. A corrected Bundle or a new isolated Run may be required.",
    };
  }

  switch (run.state) {
    case "queued":
      return {
        tone: "waiting",
        badge: "Bundle safely queued",
        title: "Your immutable Bundle is waiting for the Runner.",
        detail: "The Runner may be waking or waiting for capacity. Do not resubmit the Bundle: this page refreshes while the Run is pending, and the existing request remains bound to the same evidence.",
        technicalTitle: "Lean Runner lifecycle · queued",
        technicalDetail: "This is lifecycle state only, not a Lean verdict. A terminal signed result must be recorded before kernel, axiom, and sorry checks can count.",
      };
    case "preparing":
      return {
        tone: "running",
        badge: "Preparing isolated workspace",
        title: "The Runner is preparing an isolated Lean workspace.",
        detail: "Your Bundle remains immutable while its pinned environment is prepared. No proof result has been recorded yet.",
        technicalTitle: "Lean Runner lifecycle · preparing",
        technicalDetail: "This is lifecycle state only, not a Lean verdict. A terminal signed result must be recorded before kernel, axiom, and sorry checks can count.",
      };
    case "running":
      return {
        tone: "running",
        badge: "Lean running in isolation",
        title: "Lean is checking the Bundle in an isolated workspace.",
        detail: "The Runner will record a signed result only after its compiler, kernel, and policy checks finish. Refreshing cannot change the Bundle being checked.",
        technicalTitle: "Lean Runner lifecycle · running",
        technicalDetail: "This is lifecycle state only, not a Lean verdict. A terminal signed result must be recorded before kernel, axiom, and sorry checks can count.",
      };
    case "cancel_requested":
      return {
        tone: "waiting",
        badge: "Cancellation requested",
        title: "The Runner is resolving a cancellation request.",
        detail: "Wait for a terminal Run record before treating the request as cancelled or starting replacement evidence.",
        technicalTitle: "Lean Runner lifecycle · cancel requested",
        technicalDetail: "This is lifecycle state only, not a Lean verdict. A terminal signed result must be recorded before kernel, axiom, and sorry checks can count.",
      };
    case "failed":
    case "timed_out":
    case "rejected":
    case "cancelled":
      return {
        tone: "failed",
        badge: "Runner did not complete",
        title: "This isolated Lean Run did not complete successfully.",
        detail: "No Lean acceptance was recorded. Inspect the exact evidence and terminal Run record before preparing a new Bundle or retrying the check.",
        technicalTitle: `Lean Runner lifecycle · ${run.state}`,
        technicalDetail: "This terminal lifecycle state is not a Lean verdict. Inspect controlled evidence before acting on it.",
      };
    case "succeeded":
      return {
        tone: "failed",
        badge: "Result inspection required",
        title: "A terminal Runner state exists, but no accepted Lean result is readable.",
        detail: "Proofweave will not upgrade lifecycle state into a proof claim. Inspect controlled evidence before publishing or retrying.",
        technicalTitle: "Lean Runner lifecycle · succeeded",
        technicalDetail: "A terminal signed result must be recorded and satisfy every acceptance check before kernel acceptance can count.",
      };
  }
}
