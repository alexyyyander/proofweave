import { ActionLink, PageIntro } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import Link from "next/link";

import { getCurrentUser, signInPath } from "../auth";
import { getResearchEligibilityForPerson } from "../lib/research-eligibility";
import { WorkbenchClient } from "./WorkbenchClient";
import { MyWorkOverview } from "./MyWorkOverview";
import { loadCatalogTargets, loadSelectedCatalogTarget, loadWorkbenchData, requestedAttemptId, requestedParentNodeId, requestedTargetSlug } from "./workbench-data";
import { getParticipantOperationState } from "@/db";
import { getI18n } from "@/app/i18n/server";

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

async function ReadOnlyWorkbench({ selectedTarget }: {
  selectedTarget: Awaited<ReturnType<typeof loadCatalogTargets>>[number] | null;
}) {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell primary-page" active="workbench" mainClassName="workbench-main signed-out-workbench">
      <PageIntro label={t("workbench.launch.label")} title={t("workbench.launch.maintenanceTitle")} titleId="workspace-maintenance-title"
        description={t("workbench.launch.maintenanceDescription")}
        actions={<><ActionLink variant="primary" href={selectedTarget ? `/explore/${selectedTarget.slug}` : "/explore"}>{selectedTarget ? t("workbench.launch.viewSelected") : t("workbench.launch.browsePublic")} <span aria-hidden="true">→</span></ActionLink><ActionLink variant="secondary" href="/demo">{t("workbench.launch.openDemo")}</ActionLink></>}>
          {selectedTarget && <div className="workspace-onboarding-selection">
            <span className="micro-label">{t("workbench.launch.selectedPreserved")}</span>
            <strong>{selectedTarget.title}</strong>
            <p>{selectedTarget.informalStatement}</p>
            <span>{t("workbench.launch.selectedResume")}</span>
          </div>}
      </PageIntro>
        <ol className="workspace-onboarding-steps workspace-entry-steps" aria-label={t("workbench.launch.maintenanceStepsAria")}>
          <li><span>01</span><div><strong>{t("workbench.launch.maintenanceStep1.title")}</strong><p>{t("workbench.launch.maintenanceStep1.body")}</p></div></li>
          <li><span>02</span><div><strong>{t("workbench.launch.maintenanceStep2.title")}</strong><p>{t("workbench.launch.maintenanceStep2.body")}</p></div></li>
          <li><span>03</span><div><strong>{t("workbench.launch.maintenanceStep3.title")}</strong><p>{t("workbench.launch.maintenanceStep3.body")}</p></div></li>
        </ol>
    </SiteFrame>;
}

async function SignedOutWorkbench({ signInHref, selectedTarget }: {
  signInHref: string;
  selectedTarget: Awaited<ReturnType<typeof loadCatalogTargets>>[number] | null;
}) {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell primary-page" active="workbench" mainClassName="workbench-main signed-out-workbench">
      <PageIntro label={t("workbench.launch.label")} title={t("workbench.launch.signedOutTitle")} titleId="workspace-onboarding-title"
        description={t("workbench.launch.signedOutDescription")}
        actions={<><ActionLink variant="primary" href={signInHref}>{t("workbench.launch.signIn")} <span aria-hidden="true">→</span></ActionLink><ActionLink variant="secondary" href="/explore">{t("workbench.launch.exploreFirst")}</ActionLink></>}>
          {selectedTarget && <div className="workspace-onboarding-selection">
            <span className="micro-label">{t("workbench.launch.selectedLabel")}</span>
            <strong>{selectedTarget.title}</strong>
            <p>{selectedTarget.informalStatement}</p>
            <span>{t("workbench.launch.selectedNote")}</span>
          </div>}
      </PageIntro>
        <ol className="workspace-onboarding-steps workspace-entry-steps" aria-label={t("workbench.launch.setupStepsAria")}>
          <li><span>01</span><div><strong>{t("workbench.launch.setupStep1.title")}</strong><p>{t("workbench.launch.setupStep1.body")}</p></div></li>
          <li><span>02</span><div><strong>{t("workbench.launch.setupStep2.title")}</strong><p>{t("workbench.launch.setupStep2.body")}</p></div></li>
          <li><span>03</span><div><strong>{t("workbench.launch.setupStep3.title")}</strong><p>{t("workbench.launch.setupStep3.body")}</p></div></li>
        </ol>
      <section className="workspace-onboarding-boundary" aria-label={t("workbench.launch.privacyAria")}><strong>{t("workbench.launch.privacyTitle")}</strong><p>{t("workbench.launch.privacyBody")}</p><Link href="/privacy">{t("workbench.launch.privacyLink")} <span aria-hidden="true">→</span></Link></section>
    </SiteFrame>;
}
