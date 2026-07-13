"use client";

import { useState } from "react";
import type { DelegationProfile } from "@/db/repositories/delegation";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt } from "@/packages/domain/mcp";
import { DelegationSummary, FocusAction, ResearchWorkstation, SubmissionReadiness, WorkbenchHero } from "./workbench-sections";
import { DelegationSetup } from "./DelegationSetup";
import { AttemptQueue } from "./AttemptQueue";
import { AgentConnections } from "./AgentConnections";

export function WorkbenchClient({
  profile,
  initialAttempts,
  catalogTargets,
  initialTargetSlug,
  isAuthenticated,
  signInPath,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  initialAttempts: readonly McpAttempt[];
  catalogTargets: readonly CatalogProblem[];
  initialTargetSlug: string | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
}) {
  const [attempts, setAttempts] = useState<readonly McpAttempt[]>(initialAttempts);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const refreshAttempts = async () => {
    if (!isAuthenticated || !storageAvailable || isRefreshing) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const response = await fetch("/api/me/attempts", { headers: { accept: "application/json" } });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !Array.isArray(payload?.attempts)) {
        throw new Error(payload?.error?.message ?? "Proofweave could not refresh the durable Attempt records.");
      }
      setAttempts(payload.attempts as McpAttempt[]);
      setRefreshedAt(new Date().toISOString());
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : "Proofweave could not refresh the durable Attempt records.");
    } finally {
      setIsRefreshing(false);
    }
  };

  return <>
    <WorkbenchHero profile={profile} isAuthenticated={isAuthenticated} storageAvailable={storageAvailable} attemptCount={attempts.length} />
    <DelegationSummary profile={profile} />
    <DelegationSetup profile={profile} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />
    {profile && <AgentConnections installations={profile.agentInstallations} />}
    <AttemptQueue profile={profile} attempts={attempts} catalogTargets={catalogTargets} initialTargetSlug={initialTargetSlug} onAttemptCreated={(attempt) => { setAttempts((current) => [attempt, ...current.filter((candidate) => candidate.id !== attempt.id)]); setRefreshError(null); }} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />
    <FocusAction profile={profile} attempts={attempts} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} isRefreshing={isRefreshing} refreshError={refreshError} refreshedAt={refreshedAt} onRefresh={() => { void refreshAttempts(); }} />
    <ResearchWorkstation attempt={attempts[0] ?? null} />
    <SubmissionReadiness attempt={attempts[0] ?? null} profile={profile} />
  </>;
}
