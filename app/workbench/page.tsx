import { ActionLink, PageIntro } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import Link from "next/link";

import { getCurrentUser, signInPath } from "../auth";
import { getResearchEligibilityForPerson } from "../lib/research-eligibility";
import { WorkbenchClient } from "./WorkbenchClient";
import { MyWorkOverview } from "./MyWorkOverview";
import { loadCatalogTargets, loadSelectedCatalogTarget, loadWorkbenchData, requestedAttemptId, requestedParentNodeId, requestedTargetSlug } from "./workbench-data";
import { getParticipantOperationState } from "@/db";

export const dynamic = "force-dynamic";

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string | string[]; target?: string | string[]; parent?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const targetSlug = requestedTargetSlug(resolvedSearchParams);
  const parentNodeId = requestedParentNodeId(resolvedSearchParams);
  const attemptId = requestedAttemptId(resolvedSearchParams);
  const controlPlane = getParticipantOperationState();
  const selectedTargetPromise = targetSlug ? loadSelectedCatalogTarget(targetSlug) : Promise.resolve(null);
  if (!controlPlane.writesEnabled) return <ReadOnlyWorkbench selectedTarget={await selectedTargetPromise} />;
  const [user, selectedTarget] = await Promise.all([getCurrentUser(), selectedTargetPromise]);
  const returnTo = targetSlug
    ? `/workbench?target=${encodeURIComponent(targetSlug)}${parentNodeId ? `&parent=${encodeURIComponent(parentNodeId)}` : ""}#research-launcher`
    : attemptId
      ? `/workbench?attempt=${encodeURIComponent(attemptId)}`
      : "/workbench";
  if (!user) return <SignedOutWorkbench signInHref={signInPath(returnTo)} selectedTarget={selectedTarget} />;

  const [data, catalogTargets] = await Promise.all([loadWorkbenchData(user), loadCatalogTargets()]);
  const eligibility = await getResearchEligibilityForPerson(
    data.profile?.person.id ?? user.personId ?? null,
  );
  const isLegacyFocusedEntry = Boolean(targetSlug || attemptId);

  return <SiteFrame className="site-shell app-shell primary-page" active="workbench" mainClassName={isLegacyFocusedEntry ? "workbench-main" : "workbench-main my-work-main"}>
      {isLegacyFocusedEntry ? <WorkbenchClient
        profile={data.profile}
        initialAttempts={data.attempts}
        initialRuns={data.runs}
        initialProvisionalContributions={data.provisionalContributions}
        provisionalLedgerAvailable={data.provisionalLedgerAvailable}
        initialReviewCount={data.reviewCount}
        initialEvidenceCount={data.evidenceCount}
        catalogTargets={catalogTargets}
        initialAttemptId={attemptId}
        initialTargetSlug={targetSlug}
        initialParentNodeId={parentNodeId}
        isAuthenticated
        signInPath={signInPath(returnTo)}
        storageAvailable={data.storageAvailable}
        eligibility={eligibility}
      /> : <MyWorkOverview
        profile={data.profile}
        initialAttempts={data.attempts}
        runs={data.runs}
        reviewCount={data.reviewCount}
        evidenceCount={data.evidenceCount}
        provisionalContributionCount={data.provisionalContributions.length}
        catalogTargets={catalogTargets}
        initialTargetSlug={null}
        initialParentNodeId={null}
        storageAvailable={data.storageAvailable}
        eligibility={eligibility}
      />}
    </SiteFrame>;
}

function ReadOnlyWorkbench({ selectedTarget }: {
  selectedTarget: Awaited<ReturnType<typeof loadCatalogTargets>>[number] | null;
}) {
  return <SiteFrame className="site-shell app-shell primary-page" active="workbench" mainClassName="workbench-main signed-out-workbench">
      <PageIntro label="Workspace" title="Research updates are temporarily paused." titleId="workspace-maintenance-title"
        description="Public questions and verification records remain available. Connecting an Agent, starting or managing research, and submitting evidence will return after maintenance."
        actions={<><ActionLink variant="primary" href={selectedTarget ? `/explore/${selectedTarget.slug}` : "/explore"}>{selectedTarget ? "View selected question" : "Browse public research"} <span aria-hidden="true">→</span></ActionLink><ActionLink variant="secondary" href="/demo">Open verified demo</ActionLink></>}>
          {selectedTarget && <div className="workspace-onboarding-selection">
            <span className="micro-label">Your selected question is preserved</span>
            <strong>{selectedTarget.title}</strong>
            <p>{selectedTarget.informalStatement}</p>
            <span>Return to this question when research updates resume.</span>
          </div>}
      </PageIntro>
        <ol className="workspace-onboarding-steps workspace-entry-steps" aria-label="What remains available">
          <li><span>01</span><div><strong>Browse public questions</strong><p>Statements, sources, and existing verification states remain readable.</p></div></li>
          <li><span>02</span><div><strong>Inspect the evidence model</strong><p>The public Demo continues to verify its signed reference evidence.</p></div></li>
          <li><span>03</span><div><strong>Resume after maintenance</strong><p>Write controls remain closed rather than risking an incomplete research record.</p></div></li>
        </ol>
    </SiteFrame>;
}

function SignedOutWorkbench({ signInHref, selectedTarget }: {
  signInHref: string;
  selectedTarget: Awaited<ReturnType<typeof loadCatalogTargets>>[number] | null;
}) {
  return <SiteFrame className="site-shell app-shell primary-page" active="workbench" mainClassName="workbench-main signed-out-workbench">
      <PageIntro label="Workspace" title="One private place for your Agent's research." titleId="workspace-onboarding-title"
        description="Sign in to connect a local Agent, open bounded Attempts, and publish only the evidence you approve. Empty dashboards stay hidden until you have real work to show."
        actions={<><ActionLink variant="primary" href={signInHref}>Sign in to begin <span aria-hidden="true">→</span></ActionLink><ActionLink variant="secondary" href="/explore">Explore first</ActionLink></>}>
          {selectedTarget && <div className="workspace-onboarding-selection">
            <span className="micro-label">Selected target</span>
            <strong>{selectedTarget.title}</strong>
            <p>{selectedTarget.informalStatement}</p>
            <span>Your exact target and source revision stay selected after sign-in.</span>
          </div>}
      </PageIntro>
        <ol className="workspace-onboarding-steps workspace-entry-steps" aria-label="Workspace setup steps">
          <li><span>01</span><div><strong>Choose one exact target</strong><p>Start from a pinned statement instead of an unbounded prompt.</p></div></li>
          <li><span>02</span><div><strong>Connect your local Agent</strong><p>Your repository and unfinished reasoning remain on your computer.</p></div></li>
          <li><span>03</span><div><strong>Approve evidence for review</strong><p>Only selected checkpoints become attributable public records.</p></div></li>
        </ol>
      <section className="workspace-onboarding-boundary" aria-label="Workspace privacy boundary"><strong>Private by default.</strong><p>Signing in creates a stable Person identity for attribution. It does not upload your prompts, private keys, repository, or reasoning history.</p><Link href="/privacy">Read the privacy boundary <span aria-hidden="true">→</span></Link></section>
    </SiteFrame>;
}
