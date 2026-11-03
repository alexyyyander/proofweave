import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, Badge, ActionLink, SectionHeading } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";
import { hasActiveReviewDelegation } from "@/app/lib/review-authority";

import { PersonalWorkspaceFrame } from "@/app/PersonalWorkspaceFrame";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";
import { ReviewAssignmentWorkspace } from "../ReviewAssignmentWorkspace";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";
import { getI18n } from "@/app/i18n/server";
import type { Translator } from "@/app/i18n/translate";

export const dynamic = "force-dynamic";

export default async function ReviewAssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { t } = await getI18n();
  const { assignmentId } = await params;
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (!user) return <ReviewAssignmentMessage signInPath={signInPath(`/reviews/${encodeURIComponent(assignmentId)}`)} t={t} />;
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="review"
      eyebrow={t("reviewWorkspace.readOnly.eyebrow")}
      title={t("reviewWorkspace.readOnly.title")}
      detail={t("reviewWorkspace.readOnly.detail")}
    />;
  }
  const result = await loadReviewAssignment(user, assignmentId);
  if (result.unavailable) return <ReviewAssignmentMessage unavailable t={t} />;
  if (!result.review) notFound();
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main review-main review-workspace-main personal-workspace-main">
      <PersonalWorkspaceFrame active="reviews">
        <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/reviews">{t("reviewWorkspace.breadcrumb.market")}</Link><span> / </span><span>{t("reviewWorkspace.breadcrumb.workspace")}</span></Breadcrumb>
        <ReviewAssignmentWorkspace initialReview={result.review} hasReviewDelegation={result.hasReviewDelegation} />
      </PersonalWorkspaceFrame>
    </SiteFrame>;
}

async function loadReviewAssignment(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, assignmentId: string) {
  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    return {
      review: await getReviewAssignmentRepository().getForPerson(profile.person.id, assignmentId),
      hasReviewDelegation: hasActiveReviewDelegation(profile),
      unavailable: false,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { review: null, hasReviewDelegation: false, unavailable: true };
    throw error;
  }
}

function ReviewAssignmentMessage({ signInPath: loginPath, unavailable, t }: { signInPath?: string; unavailable?: boolean; t: Translator }) {
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main review-main personal-workspace-main">
      <PersonalWorkspaceFrame active="reviews">
        <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/reviews">{t("reviewWorkspace.breadcrumb.market")}</Link><span> / </span><span>{t("reviewWorkspace.breadcrumb.controlled")}</span></Breadcrumb>
        <SectionHeading as="section" className="review-heading"><div><p className="eyebrow">{t("reviewWorkspace.message.eyebrow")}</p><PageTitle>{unavailable ? t("reviewWorkspace.message.unavailableTitle") : t("reviewWorkspace.message.signInTitle")}</PageTitle><p>{unavailable ? t("reviewWorkspace.message.unavailableBody") : t("reviewWorkspace.message.signInBody")}</p></div><Badge className="record-chip">{unavailable ? t("reviewWorkspace.message.unavailable") : t("reviewWorkspace.message.personal")}</Badge></SectionHeading>
        {loginPath && <ActionLink className="button button-primary review-sign-in" href={loginPath}>{t("reviewWorkspace.message.signInAction")} <span aria-hidden="true">→</span></ActionLink>}
      </PersonalWorkspaceFrame>
    </SiteFrame>;
}
