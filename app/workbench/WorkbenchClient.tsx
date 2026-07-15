"use client";

import { useState } from "react";
import type { DelegationProfile } from "@/db/repositories/delegation";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt, McpRunSummary } from "@/packages/domain/mcp";
import type { ProvisionalContribution } from "@/db/repositories/provisional-contributions";
import { DelegationSummary, FocusAction, ProvisionalContributionLedger, ResearchWorkstation, SubmissionReadiness, WorkbenchHero, WorkspacePath, WorkspaceSettingsPrompt } from "./workbench-sections";
import { AttemptQueue } from "./AttemptQueue";
import { LocalAgentHandoff } from "./LocalAgentHandoff";
import { activeLocalAgentAttempt } from "../lib/local-agent-journey";

export function WorkbenchClient({
  profile,
  initialAttempts,
  initialRuns,
  initialProvisionalContributions,
  provisionalLedgerAvailable,
  catalogTargets,
  initialTargetSlug,
  isAuthenticated,
  signInPath,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  initialAttempts: readonly McpAttempt[];
  initialRuns: readonly McpRunSummary[];
  initialProvisionalContributions: readonly ProvisionalContribution[];
  provisionalLedgerAvailable: boolean;
  catalogTargets: readonly CatalogProblem[];
  initialTargetSlug: string | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
}) {
  const [attempts, setAttempts] = useState<readonly McpAttempt[]>(initialAttempts);
  const [runs, setRuns] = useState<readonly McpRunSummary[]>(initialRuns);
  const [provisionalContributions, setProvisionalContributions] = useState<readonly ProvisionalContribution[]>(initialProvisionalContributions);
  const [isProvisionalLedgerAvailable, setIsProvisionalLedgerAvailable] = useState(provisionalLedgerAvailable);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const activeAttempt = activeLocalAgentAttempt(profile, attempts);

  const refreshAttempts = async () => {
    if (!isAuthenticated || !storageAvailable || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const [attemptResponse, contributionResponse] = await Promise.all([
        fetch("/api/me/attempts", { headers: { accept: "application/json" } }),
        isProvisionalLedgerAvailable
          ? fetch("/api/me/provisional-contributions", { headers: { accept: "application/json" } })
          : Promise.resolve(null),
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
      setRefreshedAt(new Date().toISOString());
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Proofweave could not refresh the durable Attempt records.");
    } finally {
      setIsRefreshing(false);
    }
  };

  return <>
    <WorkbenchHero profile={profile} isAuthenticated={isAuthenticated} storageAvailable={storageAvailable} attemptCount={attempts.length} />
    <WorkspacePath />
    <DelegationSummary profile={profile} />
    <FocusAction profile={profile} attempt={activeAttempt} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} isRefreshing={isRefreshing} refreshError={refreshError} refreshedAt={refreshedAt} onRefresh={() => { void refreshAttempts(); }} />
    <LocalAgentHandoff profile={profile} attempt={activeAttempt} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} isRefreshing={isRefreshing} onRefresh={() => { void refreshAttempts(); }} />
    <WorkspaceSettingsPrompt profile={profile} isAuthenticated={isAuthenticated} storageAvailable={storageAvailable} />
    <AttemptQueue profile={profile} attempts={attempts} catalogTargets={catalogTargets} initialTargetSlug={initialTargetSlug} onAttemptCreated={(attempt) => { setAttempts((current) => [attempt, ...current.filter((candidate) => candidate.id !== attempt.id)]); setRefreshError(null); }} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />
    <ResearchWorkstation attempt={activeAttempt} runs={runs} />
    <SubmissionReadiness attempt={activeAttempt} profile={profile} runs={runs} />
    <ProvisionalContributionLedger profile={profile} contributions={provisionalContributions} isAuthenticated={isAuthenticated} ledgerAvailable={isProvisionalLedgerAvailable} />
  </>;
}
