import type { AttemptEvidence } from "@/db/repositories/evidence";

/**
 * A market handoff requires the complete accepted result projection. Bundle
 * staging and Agent-reported progress deliberately do not satisfy this gate.
 * The verification market store repeats the canonical hash checks at write
 * time so this UI/application predicate is never the sole enforcement point.
 */
export function hasAcceptedLeanEvidence(evidence: AttemptEvidence): boolean {
  return evidence.runs.some((run) => {
    const summary = run.result?.summary;
    return run.state === "succeeded" &&
      summary?.status === "succeeded" &&
      summary.kernelStatus === "accepted" &&
      summary.checks.network === "passed" &&
      summary.checks.noSorry === "passed" &&
      summary.checks.allowedAxioms === "passed" &&
      summary.checks.leanBuild === "passed";
  });
}
