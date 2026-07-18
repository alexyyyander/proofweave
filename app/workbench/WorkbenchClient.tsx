"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DelegationProfile } from "@/db/repositories/delegation";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt, McpRunSummary } from "@/packages/domain/mcp";
import type { ProvisionalContribution } from "@/db/repositories/provisional-contributions";
import { DelegationSummary, FirstContributionPath, FocusAction, ProvisionalContributionLedger, ResearchWorkstation, SubmissionReadiness, WorkspaceSettingsPrompt } from "./workbench-sections";
import { buildCodexResearchBrief, LocalAgentHandoff } from "./LocalAgentHandoff";
import { ResearchLauncher } from "./ResearchLauncher";
import { activeAttemptDelegation, activeLocalAgentAttempt, activeLocalCodexInstallation } from "../lib/local-agent-journey";
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
  variant = "legacy",
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
  variant?: "legacy" | "detail";
}) {
  const [attempts, setAttempts] = useState<readonly McpAttempt[]>(initialAttempts);
  const [runs, setRuns] = useState<readonly McpRunSummary[]>(initialRuns);
  const [provisionalContributions, setProvisionalContributions] = useState<readonly ProvisionalContribution[]>(initialProvisionalContributions);
  const [isProvisionalLedgerAvailable, setIsProvisionalLedgerAvailable] = useState(provisionalLedgerAvailable);
  const [reviewCount, setReviewCount] = useState<number | null>(initialReviewCount);
  const [evidenceCount, setEvidenceCount] = useState<number | null>(initialEvidenceCount);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshInFlight = useRef(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [handoffNotice, setHandoffNotice] = useState<string | null>(null);
  const [lifecycleNotice, setLifecycleNotice] = useState<string | null>(null);
  const [isClosingAttempt, setIsClosingAttempt] = useState(false);
  const initialVisibleAttempt = selectVisibleAttempt(profile, initialAttempts, initialTargetSlug, initialAttemptId);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(() => initialVisibleAttempt?.id ?? null);
  const [attemptListView, setAttemptListView] = useState<"active" | "history">(() => initialVisibleAttempt?.status === "active" || !initialVisibleAttempt ? "active" : "history");
  const fallbackAttempt = selectVisibleAttempt(profile, attempts, initialTargetSlug, initialAttemptId);
  const activeAttempt = attempts.find((attempt) => attempt.id === selectedAttemptId) ?? fallbackAttempt;
  const connection = activeLocalCodexInstallation(profile);
  const selectedDelegation = activeAttemptDelegation(profile, activeAttempt);
  const selectedConnection = activeAttempt
    ? activeLocalCodexInstallation(profile, selectedDelegation)
    : connection;
  const mode = deriveWorkspaceMode({ isAuthenticated, storageAvailable, isAgentConnected: Boolean(selectedConnection), attempt: activeAttempt });
  const activeRuns = activeAttempt ? runs.filter((run) => run.attemptId === activeAttempt.id) : [];
  const showActiveWorkspace = mode === "active-research" || mode === "evidence-review";
  const canContinueLocally = activeAttempt?.status === "active" && Boolean(selectedConnection);
  const hasPendingRun = activeRuns.some((run) => ["queued", "preparing", "running", "cancel_requested"].includes(run.state));

  const refreshAttempts = useCallback(async () => {
    if (!isAuthenticated || !storageAvailable || refreshInFlight.current) return;
    refreshInFlight.current = true;
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
      refreshInFlight.current = false;
      setIsRefreshing(false);
    }
  }, [isAuthenticated, isProvisionalLedgerAvailable, storageAvailable]);

  const selectAttempt = (attemptId: string) => {
    const selected = attempts.find((attempt) => attempt.id === attemptId);
    if (!selected) return;
    setSelectedAttemptId(attemptId);
    setAttemptListView(selected.status === "active" ? "active" : "history");
    setHandoffNotice(null);
    setLifecycleNotice(null);
    if (typeof window === "undefined") return;
    if (variant === "detail") {
      window.location.assign(`/workbench/attempts/${encodeURIComponent(attemptId)}`);
      return;
    }
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
      setAttemptListView(restored?.status === "active" || !restored ? "active" : "history");
    };
    window.addEventListener("popstate", restoreAttemptFromUrl);
    return () => window.removeEventListener("popstate", restoreAttemptFromUrl);
  }, [attempts, profile]);

  useEffect(() => {
    if (!isAuthenticated || !storageAvailable) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshAttempts();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = hasPendingRun ? window.setInterval(refreshWhenVisible, 15_000) : null;
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (interval !== null) window.clearInterval(interval);
    };
  }, [hasPendingRun, isAuthenticated, refreshAttempts, storageAvailable]);

  const onAttemptReady = (attempt: McpAttempt) => {
    setAttempts((current) => [attempt, ...current.filter((candidate) => candidate.id !== attempt.id)]);
    setSelectedAttemptId(attempt.id);
    setAttemptListView("active");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("attempt", attempt.id);
      url.searchParams.delete("target");
      url.searchParams.delete("parent");
      window.history.replaceState({ attemptId: attempt.id }, "", `${url.pathname}${url.search}${url.hash}`);
    }
    setRefreshError(null);
    setLifecycleNotice(null);
  };

  const copyCodexBrief = async () => {
    if (!activeAttempt || activeAttempt.status !== "active" || !selectedConnection) return;
    const brief = buildCodexResearchBrief({
      agentLabel: activeAttempt.agentLabel,
      attempt: activeAttempt,
      parentNodeId: initialParentNodeId,
    });
    try {
      await navigator.clipboard.writeText(brief);
      setHandoffNotice("Codex brief copied. Paste it into a new Codex task on this computer; it will verify the Connector and resume this target without creating duplicate work.");
    } catch {
      setHandoffNotice("Your browser could not copy the Codex brief. Use Download .md in the local handoff section instead.");
    }
  };

  const closeAttempt = async () => {
    if (!activeAttempt || activeAttempt.status !== "active" || isClosingAttempt) return;
    const attemptId = activeAttempt.id;
    setIsClosingAttempt(true);
    setLifecycleNotice(null);
    try {
      const response = await fetch(`/api/me/attempts/${encodeURIComponent(attemptId)}`, {
        method: "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.attempt) {
        throw new Error(payload?.error?.message ?? "Proofweave could not close this Attempt.");
      }
      const closed = payload.attempt as McpAttempt;
      setAttempts((current) => current.map((attempt) => attempt.id === closed.id ? closed : attempt));
      setAttemptListView("history");
      setLifecycleNotice("Attempt closed and moved to History. Its events, evidence, Runs, and reviews remain available.");
      setRefreshedAt(new Date().toISOString());
    } catch (error) {
      setLifecycleNotice(error instanceof Error ? error.message : "Proofweave could not close this Attempt.");
    } finally {
      setIsClosingAttempt(false);
    }
  };

  if (variant === "detail") return <>
    <nav className="attempt-detail-breadcrumb" aria-label="Breadcrumb"><Link href="/workbench">My work</Link><span>/</span><span>{activeAttempt?.problemTitle ?? "Attempt"}</span></nav>
    <WorkspaceTopbar attempts={attempts} selectedAttemptId={activeAttempt?.id ?? null} onSelectAttempt={selectAttempt} agentLabel={selectedConnection?.agentLabel ?? null} isAgentConnected={Boolean(selectedConnection)} mode={mode} isRefreshing={isRefreshing} canRefresh={isAuthenticated && storageAvailable} refreshedAt={refreshedAt} onRefresh={() => { void refreshAttempts(); }} />
    <FirstContributionPath attempt={activeAttempt} profile={profile} runs={runs} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />
    <div className="attempt-detail-layout">
      <section className="workspace-task-canvas" aria-label="Current research work">
        <FocusAction profile={profile} attempt={activeAttempt} canContinueLocally={canContinueLocally} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} refreshError={refreshError} refreshedAt={refreshedAt} handoffNotice={handoffNotice} lifecycleNotice={lifecycleNotice} isClosingAttempt={isClosingAttempt} onCopyCodexBrief={() => { void copyCodexBrief(); }} onCloseAttempt={() => { void closeAttempt(); }} isPageHeading />
        {canContinueLocally && <LocalAgentHandoff profile={profile} attempt={activeAttempt} initialParentNodeId={initialParentNodeId} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} isRefreshing={isRefreshing} onRefresh={() => { void refreshAttempts(); }} />}
        <ResearchWorkstation attempt={activeAttempt} runs={runs} />
      </section>
      <aside className="workspace-status-rail" aria-label="Verification and record status">
        <SubmissionReadiness attempt={activeAttempt} profile={profile} runs={runs} compact />
        <WorkspaceRecordLinks eventCount={activeAttempt?.events.length ?? 0} runCount={activeRuns.length} contributionCount={provisionalContributions.length} />
      </aside>
    </div>
    {(provisionalContributions.length > 0 || mode === "evidence-review") && <ProvisionalContributionLedger profile={profile} contributions={provisionalContributions} isAuthenticated={isAuthenticated} ledgerAvailable={isProvisionalLedgerAvailable} />}
    <details className="workbench-account-details"><summary>Agent connection and authority</summary><DelegationSummary profile={profile} /><WorkspaceSettingsPrompt profile={profile} isAuthenticated={isAuthenticated} storageAvailable={storageAvailable} /></details>
  </>;

  return <>
    <WorkspaceTopbar attempts={attempts} selectedAttemptId={activeAttempt?.id ?? null} onSelectAttempt={selectAttempt} agentLabel={selectedConnection?.agentLabel ?? null} isAgentConnected={Boolean(selectedConnection)} mode={mode} isRefreshing={isRefreshing} canRefresh={isAuthenticated && storageAvailable} refreshedAt={refreshedAt} onRefresh={() => { void refreshAttempts(); }} />
    <FirstContributionPath attempt={activeAttempt} profile={profile} runs={runs} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />
    <div className={`workspace-shell mode-${mode}`}>
      <WorkspaceSidebar attempts={attempts} selectedAttemptId={activeAttempt?.id ?? null} onSelectAttempt={selectAttempt} view={attemptListView} onViewChange={setAttemptListView} reviewCount={reviewCount} evidenceCount={evidenceCount} />
      <section className="workspace-task-canvas" aria-label="Current research work">
        <FocusAction profile={profile} attempt={activeAttempt} canContinueLocally={canContinueLocally} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} refreshError={refreshError} refreshedAt={refreshedAt} handoffNotice={handoffNotice} lifecycleNotice={lifecycleNotice} isClosingAttempt={isClosingAttempt} onCopyCodexBrief={() => { void copyCodexBrief(); }} onCloseAttempt={() => { void closeAttempt(); }} />
        {!showActiveWorkspace && <ResearchLauncher profile={profile} attempts={attempts} catalogTargets={catalogTargets} initialTargetSlug={initialTargetSlug} initialParentNodeId={initialParentNodeId} onAttemptReady={onAttemptReady} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />}
        {showActiveWorkspace && <>
          {canContinueLocally && <LocalAgentHandoff profile={profile} attempt={activeAttempt} initialParentNodeId={initialParentNodeId} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} isRefreshing={isRefreshing} onRefresh={() => { void refreshAttempts(); }} />}
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
