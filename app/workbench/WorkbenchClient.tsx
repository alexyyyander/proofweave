"use client";

import { useState } from "react";
import type { DelegationProfile } from "@/db/repositories/delegation";
import { boundedStepPreview, initialEvents } from "./workbench-data";
import { DelegationSummary, FocusAction, ResearchWorkstation, SubmissionReadiness, WorkbenchHero } from "./workbench-sections";
import { DelegationSetup } from "./DelegationSetup";

export function WorkbenchClient({
  profile,
  isAuthenticated,
  signInPath,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
}) {
  const [isRunning, setIsRunning] = useState(true);
  const [hasRunStep, setHasRunStep] = useState(false);
  const [bundleStaged, setBundleStaged] = useState(false);
  const hasActiveDelegation = activeDelegation(profile);
  const events = hasRunStep ? [...initialEvents, boundedStepPreview] : initialEvents;

  const runBoundedStep = () => {
    if (!isRunning || hasRunStep) return;
    setHasRunStep(true);
    setBundleStaged(false);
  };

  return <>
    <WorkbenchHero isRunning={isRunning} profile={profile} isAuthenticated={isAuthenticated} storageAvailable={storageAvailable} />
    <DelegationSummary profile={profile} />
    <DelegationSetup profile={profile} isAuthenticated={isAuthenticated} signInPath={signInPath} storageAvailable={storageAvailable} />
    <FocusAction isRunning={isRunning} hasRunStep={hasRunStep} hasActiveDelegation={hasActiveDelegation} accountRequiresSetup={Boolean(profile && !hasActiveDelegation)} onRun={runBoundedStep} onToggleAgent={() => setIsRunning((value) => !value)} />
    <ResearchWorkstation events={events} />
    <SubmissionReadiness hasRunStep={hasRunStep} bundleStaged={bundleStaged} onStageBundle={() => setBundleStaged(true)} />
  </>;
}

function activeDelegation(profile: DelegationProfile | null): boolean {
  const now = Date.now();
  return Boolean(profile?.delegations.some((candidate) =>
    candidate.revokedAt === null &&
    Date.parse(candidate.validFrom) <= now &&
    now < Date.parse(candidate.validUntil),
  ));
}
