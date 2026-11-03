import { PageTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { notFound } from "next/navigation";
import { getCurrentUser, signInPath } from "@/app/auth";

import { personalWritesPaused, ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";
import { WorkbenchClient } from "../../WorkbenchClient";
import { loadCatalogTargets, loadWorkbenchData } from "../../workbench-data";
import { getI18n } from "@/app/i18n/server";

export const dynamic = "force-dynamic";

export default async function AttemptDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { t } = await getI18n();
  const { id } = await params;
  const returnTo = `/workbench/attempts/${encodeURIComponent(id)}`;

  if (personalWritesPaused()) {
    return <ReadOnlyPersonalSurface
      active="workbench"
      eyebrow={t("attempt.readOnly.eyebrow")}
      title={t("attempt.readOnly.title")}
      detail={t("attempt.readOnly.detail")}
    />;
  }

  const user = await getCurrentUser();
  if (!user) return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main attempt-access-main"><SectionHeading as="section" className="page-hero"><p className="eyebrow">{t("attempt.signIn.eyebrow")}</p><PageTitle>{t("attempt.signIn.title")}</PageTitle><p>{t("attempt.signIn.body")}</p><div className="button-row"><ActionLink className="button button-primary" href={signInPath(returnTo)}>{t("attempt.signIn.action")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/workbench">{t("attempt.signIn.back")}</ActionLink></div></SectionHeading></SiteFrame>;

  const [data, catalogTargets] = await Promise.all([loadWorkbenchData(user), loadCatalogTargets()]);
  if (!data.storageAvailable) return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main attempt-access-main"><SectionHeading as="section" className="page-hero"><p className="eyebrow">{t("attempt.unavailable.eyebrow")}</p><PageTitle>{t("attempt.unavailable.title")}</PageTitle><p>{t("attempt.unavailable.body")}</p><ActionLink className="button button-secondary" href="/workbench">{t("attempt.unavailable.back")}</ActionLink></SectionHeading></SiteFrame>;
  if (!data.attempts.some((attempt) => attempt.id === id)) notFound();

  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="workbench-main attempt-detail-main">
      <WorkbenchClient
        profile={data.profile}
        initialAttempts={data.attempts}
        initialRuns={data.runs}
        initialProvisionalContributions={data.provisionalContributions}
        provisionalLedgerAvailable={data.provisionalLedgerAvailable}
        initialReviewCount={data.reviewCount}
        initialEvidenceCount={data.evidenceCount}
        catalogTargets={catalogTargets}
        initialAttemptId={id}
        initialTargetSlug={null}
        initialParentNodeId={null}
        isAuthenticated
        signInPath={signInPath(returnTo)}
        storageAvailable={data.storageAvailable}
        variant="detail"
      />
    </SiteFrame>;
}
