import type { McpRunSummary } from "@/packages/domain/mcp";

/**
 * The single presentation boundary for an accepted Lean result.
 *
 * A lifecycle state or a partially readable summary must never be upgraded
 * into a kernel verdict. This is a UI progress state only; it does not imply
 * statement fidelity, novelty, independent review, credit, or a Receipt.
 */
export function hasAcceptedKernelEvidence(
  run: McpRunSummary | null | undefined,
): boolean {
  const summary = run?.result?.summary;
  return Boolean(
    run?.evidenceState === "recorded" &&
    run.state === "succeeded" &&
    summary?.status === "succeeded" &&
    summary.kernelStatus === "accepted" &&
    summary.checks.network === "passed" &&
    summary.checks.noSorry === "passed" &&
    summary.checks.allowedAxioms === "passed" &&
    summary.checks.leanBuild === "passed",
  );
}
