"use client";

import { useState } from "react";
import type { DelegationProfile } from "@/db/repositories/delegation";
import { boundedStepPreview, initialEvents } from "./workbench-data";
import { DelegationSummary, FocusAction, ResearchWorkstation, SubmissionReadiness, WorkbenchHero } from "./workbench-sections";

export function WorkbenchClient({ profile }: { profile: DelegationProfile | null }) {
  const [isRunning, setIsRunning] = useState(true);
  const [hasRunStep, setHasRunStep] = useState(false);
  const [bundleStaged, setBundleStaged] = useState(false);
  const events = hasRunStep ? [...initialEvents, boundedStepPreview] : initialEvents;

  const runBoundedStep = () => {
    if (!isRunning || hasRunStep) return;
    setHasRunStep(true);
    setBundleStaged(false);
  };

  return <>
    <WorkbenchHero isRunning={isRunning} profile={profile} />
    <DelegationSummary profile={profile} />
    <FocusAction isRunning={isRunning} hasRunStep={hasRunStep} onRun={runBoundedStep} onToggleAgent={() => setIsRunning((value) => !value)} />
    <ResearchWorkstation events={events} />
    <SubmissionReadiness hasRunStep={hasRunStep} bundleStaged={bundleStaged} onStageBundle={() => setBundleStaged(true)} />
  </>;
}
