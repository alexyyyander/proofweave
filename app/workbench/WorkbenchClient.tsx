"use client";

import { useEffect, useState } from "react";
import type { DelegationProfile } from "@/db/repositories/delegation";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt, McpRunSummary } from "@/packages/domain/mcp";
import type { ProvisionalContribution } from "@/db/repositories/provisional-contributions";
import { DelegationSummary, FocusAction, ProvisionalContributionLedger, ResearchWorkstation, SubmissionReadiness, WorkspaceSettingsPrompt } from "./workbench-sections";
import { LocalAgentHandoff } from "./LocalAgentHandoff";
import { ResearchLauncher } from "./ResearchLauncher";
import { activeLocalAgentAttempt, activeLocalCodexInstallation } from "../lib/local-agent-journey";
import { deriveWorkspaceMode, WorkspaceRecordLinks, WorkspaceSidebar, WorkspaceTopbar } from "./WorkspaceShell";

export function WorkbenchClient({
  profile,
  initialAttempts,
  initialRuns,
  initialProvisionalContributions,
  provisionalLedgerAvailable,
  initialReviewCount,
  initialEvidenceCount,
  catalogTargets,
  initialAttemptId,
  initialTargetSlug,
  initialParentNodeId,
  isAuthenticated,
  signInPath,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  initialAttempts: readonly McpAttempt[];
  initialRuns: readonly McpRunSummary[];
  initialProvisionalContributions: readonly ProvisionalContribution[];
  provisionalLedgerAvailable: boolean;
  initialReviewCount: number | null;
  initialEvidenceCount: number | null;
  catalogTargets: readonly CatalogProblem[];
  initialAttemptId: string | null;
  initialTargetSlug: string | null;
  initialParentNodeId: string | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
}) {
  const [attempts, setAttempts] = useState<readonly McpAttempt[]>(initialAttempts);
  const [runs, setRuns] = useState<readonly McpRunSummary[]>(initialRuns);
  const [provisionalContributions, setProvisionalContributions] = useState<readonly ProvisionalContribution[]>(initialProvisionalContributions);
  const [isProvisionalLedgerAvailable, setIsProvisionalLedgerAvailable] = useState(provisionalLedgerAvailable);
  const [reviewCount, setReviewCount] = useState<number | null>(initialReviewCount);
  const [evidenceCount, setEvidenceCount] = useState<number | null>(initialEvidenceCount);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(() => selectVisibleAttempt(profile, initialAttempts, initialTargetSlug, initialAttemptId)?.id ?? null);
  const fallbackAttempt = selectVisibleAttempt(profile, attempts, initialTargetSlug, initialAttemptId);
  const activeAttempt = attempts.find((attempt) => attempt.id === selectedAttemptId) ?? fallbackAttempt;
  const connection = activeLocalCodexInstallation(profile);
  const mode = deriveWorkspaceMode({ isAuthenticated, storageAvailable, isAgentConnected: Boolean(connection), attempt: activeAttempt });
  const activeRuns = activeAttempt ? runs.filter((run) => run.attemptId === activeAttempt.id) : [];
  const showActiveWorkspace = mode === "active-research" || mode === "evidence-review";

  const refreshAttempts = async () => {
    if (!isAuthenticated || !storageAvailable || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const [attemptResponse, contributionResponse, summaryResponse] = await Promise.all([
        fetch("/api/me/attempts", { headers: { accept: "application/json" } }),
        isProvisionalLedgerAvailable
          ? fetch("/api/me/provisional-contributions", { headers: { accept: "application/json" } })
          : Promise.resolve(null),
        fetch("/api/me/workspace-summary", { headers: { accept: "application/json" } }),
      ]);
      const attemptPayload = await attemptResponse.json().catch(() => null);
      if (!attemptResponse.ok || !Array.isArray(attemptPayload?.attempts) || !Array.isArray(attemptPayload?.runs)) {
        throw new Error(attemptPayload?.error?.message ?? "Proofweave could not refresh the durable Attempt records.");
      }
      setAttempts(attemptPayload.attempts as McpAttempt[]);
      setRuns(attemptPayload.runs as McpRunSummary[]);
      if (contributionResponse) {
        const contributionPayload = await contributionResponse.json().catch(() => null);
        if (contributionResponse.ok && Array.isArray(contributionPayload?.contributions)) {
          setProvisionalContributions(contributionPayload.contributions as ProvisionalContribution[]);
        } else if (contributionResponse.status === 503 && contributionPayload?.error?.code === "unavailable") {
          setIsProvisionalLedgerAvailable(false);
        } else {
          throw new Error(contributionPayload?.error?.message ?? "Proofweave could not refresh the provisional evidence ledger.");
        }
      }
      if (summaryResponse.ok) {
        const summaryPayload = await summaryResponse.json().catch(() => null);
        const counts = summaryPayload?.summary?.counts;
        if (typeof counts?.activeReviews === "number") setReviewCount(counts.activeReviews);
        if (typeof counts?.evidence === "number") setEvidenceCount(counts.evidence);
      }
      setRefreshedAt(new Date().toISOString());
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Proofweave could not refresh the durable Attempt records.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const selectAttempt = (attemptId: string) => {
    if (!attempts.some((attempt) => attempt.id === attemptId)) return;
    setSelectedAttemptId(attemptId);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("attempt", attemptId);
    url.searchParams.delete("target");
    url.searchParams.delete("parent");
    window.history.pushState({ attemptId }, "", `${url.pathname}${url.search}${url.hash}`);
  };

  useEffect(() => {
    const restoreAttemptFromUrl = () => {
      const url = new URL(window.location.href);
      const restored = selectVisibleAttempt(profile, attempts, url.searchParams.get("target"), url.searchParams.get("attempt"));
      setSelectedAttemptId(restored?.id ?? null);
    };
    window.addEventListener("popstate", restoreAttemptFromUrl);
    return () => window.removeEventListener("popstate", restoreAttemptFromUrl);
  }, [attempts, profile]);

  const onAttemptReady = (attempt: McpAttempt) => {
    setAttempts((current) => [attempt, ...current.filter((candidate) => candidate.id !== attempt.id)]);
    setSelectedAttemptId(attempt.id);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("attempt", attempt.id);
      url.searchParams.delete("target");
      url.searchParams.delete("parent");
      window.history.replaceState({ attemptId: attempt.id }, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setRefreshError(null);
  };

  return <>
    <WorkspaceTopbar attempts={attempts} selectedAttemptId={activeAttempt?.id ?? null} onSelectAttempt={selectAttempt} agentLabel={connection?.agentLabel ?? null} isAgentConnected={Boolean(connection)} mode={mode} isRefreshing={isRefreshing} canRefresh={isAuthenticated && storageAvailable} refreshedAt={refreshedAt} onRefresh={() => { void refreshAttempts(); }} />
    <div className={`workspace-shell mode-${mode}`}>
      <WorkspaceSidebar attempts={attempts} selectedAttemptId={activeAttempt?.id ?? null} onSelectAttempt={selectAttempt} reviewCount={reviewCount} evidenceCount={evidenceCount} />
      <section className="workspace-task-canvas" aria-label="Current research work">
        <FocusAction profile={profile} attempt={activeAttempt} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} refreshError={refreshError} refreshedAt={refreshedAt} />
        {!showActiveWorkspace && <ResearchLauncher profile={profile} attempts={attempts} catalogTargets={catalogTargets} initialTargetSlug={initialTargetSlug} initialParentNodeId={initialParentNodeId} onAttemptReady={onAttemptReady} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />}
        {showActiveWorkspace && <>
          <LocalAgentHandoff profile={profile} attempt={activeAttempt} initialParentNodeId={initialParentNodeId} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} isRefreshing={isRefreshing} onRefresh={() => { void refreshAttempts(); }} />
          <ResearchWorkstation attempt={activeAttempt} runs={runs} />
          <details className="workspace-new-research">
            <summary>Start another research target</summary>
            <ResearchLauncher profile={profile} attempts={attempts} catalogTargets={catalogTargets} initialTargetSlug={initialTargetSlug} initialParentNodeId={initialParentNodeId} onAttemptReady={onAttemptReady} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />
          </details>
        </>}
      </section>
      <aside className="workspace-status-rail" aria-label="Verification and record status">
        <SubmissionReadiness attempt={activeAttempt} profile={profile} runs={runs} compact />
        <WorkspaceRecordLinks eventCount={activeAttempt?.events.length ?? 0} runCount={activeRuns.length} contributionCount={provisionalContributions.length} />
      </aside>
    </div>
    {(provisionalContributions.length > 0 || mode === "evidence-review") && <ProvisionalContributionLedger profile={profile} contributions={provisionalContributions} isAuthenticated={isAuthenticated} ledgerAvailable={isProvisionalLedgerAvailable} />}
    <details className="workbench-account-details">
      <summary>Agent connection and authority</summary>
      <DelegationSummary profile={profile} />
      <WorkspaceSettingsPrompt profile={profile} isAuthenticated={isAuthenticated} storageAvailable={storageAvailable} />
    </details>
  </>;
}

/**
 * A local connection controls future Agent writes, not the owner's ability to
 * inspect durable Attempt and Runner evidence. Prefer the target explicitly
 * selected in the URL, then the connected Agent's active Attempt, then the
 * most recent durable record returned by the owner-scoped repository.
 */
function selectVisibleAttempt(
  profile: DelegationProfile | null,
  attempts: readonly McpAttempt[],
  targetSlug: string | null,
  attemptId: string | null,
): McpAttempt | null {
  const requestedById = attemptId
    ? attempts.find((attempt) => attempt.id === attemptId) ?? null
    : null;
  const requested = targetSlug
    ? attempts.find((attempt) => attempt.status === "active" && attempt.problemSlug === targetSlug) ?? null
    : null;
  return requestedById
    ?? requested
    ?? activeLocalAgentAttempt(profile, attempts)
    ?? attempts.find((attempt) => attempt.status === "active")
    ?? attempts[0]
    ?? null;
}
