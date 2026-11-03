import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, ActionLink, EmptyState, SectionHeading } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getReviewAssignmentRepository, type ReviewAssignmentSummary } from "@/db/repositories/reviews";
import { getVerificationMarketRepository, type PublicVerificationJob, VerificationMarketSchemaUnavailableError } from "@/db/repositories/verification-market";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";
import { getCurrentUser, signInPath, toPersonIdentity, type AuthUser } from "../auth";

import { hasActiveReviewDelegation } from "../lib/review-authority";
import { ReviewQueueClient } from "./ReviewQueueClient";
import { VerificationMarketBoard } from "./VerificationMarketBoard";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "../lib/read-only-personal-surface";
import { getI18n } from "@/app/i18n/server";
import type { Translator } from "@/app/i18n/translate";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const { t } = await getI18n();
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="review"
      eyebrow={t("reviews.readOnly.eyebrow")}
      title={t("reviews.readOnly.title")}
      detail={user ? t("reviews.readOnly.detailSignedIn") : t("reviews.readOnly.detailSignedOut")}
    >
      <section className="workspace-onboarding-boundary" aria-label={t("reviews.readOnly.infoTitle")}>
        <strong>{t("reviews.readOnly.infoTitle")}</strong>
        <p>{t("reviews.readOnly.infoBody")}</p>
        <Link href="/how-it-works#verification">{t("reviews.readOnly.infoLink")} <span aria-hidden="true">→</span></Link>
      </section>
    </ReadOnlyPersonalSurface>;
  }
  const result = await loadReviews(user);
  if (!result.storageAvailable) return <ReviewMessage unavailable t={t} />;

  const activeAssignments = result.assignments.filter((assignment) => assignment.status === "assigned" || assignment.status === "accepted").length;
  const hasReviewDelegation = hasActiveReviewDelegation(result.profile);
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main review-main">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/explore">{t("explore.breadcrumb")}</Link><span> / </span><span>{t("reviews.breadcrumb.market")}</span></Breadcrumb>
      <SectionHeading as="section" className="review-heading"><div><p className="eyebrow">{t("reviews.hero.eyebrow")}</p><PageTitle>{t("reviews.hero.title")}</PageTitle><p>{t("reviews.hero.body")}</p></div><Badge className="record-chip">{t("reviews.hero.open", { count: result.jobs.length })}</Badge></SectionHeading>
      <nav className="public-section-nav" aria-label={t("reviews.nav.aria")}>
        <a href="#open-review-work"><span>{t("reviews.nav.open")}</span><b>{result.jobs.length}</b></a>
        <a href="#my-review-work"><span>{t("reviews.nav.my")}</span><b>{user ? activeAssignments : t("reviews.nav.signIn")}</b></a>
        <Link href="/how-it-works#verification"><span>{t("reviews.nav.how")}</span><b aria-hidden="true">→</b></Link>
      </nav>
      <VerificationMarketBoard
        initialJobs={result.jobs}
        signedIn={Boolean(user)}
        hasReviewDelegation={hasReviewDelegation}
        signInPath={signInPath("/reviews")}
      />
      <SectionHeading as="section" className="personal-review-heading" id="my-review-work" aria-labelledby="personal-review-title">
        <div><p className="eyebrow">{t("reviews.personal.eyebrow")}</p><SectionTitle id="personal-review-title">{user ? t("reviews.personal.titleSignedIn") : t("reviews.personal.titleSignedOut")}</SectionTitle><p>{user ? t("reviews.personal.bodySignedIn") : t("reviews.personal.bodySignedOut")}</p></div>
        <Badge className="record-chip">{user ? t("reviews.personal.active", { active: activeAssignments, max: closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson }) : t("reviews.personal.scoped")}</Badge>
      </SectionHeading>
      {user
        ? <ReviewQueueClient initialAssignments={result.assignments} hasReviewDelegation={hasReviewDelegation} />
        : <EmptyState as="section" className="review-empty review-sign-in-panel"><p className="eyebrow">{t("reviews.queueEmpty.eyebrow")}</p><SectionTitle>{t("reviews.queueEmpty.title")}</SectionTitle><p>{t("reviews.queueEmpty.body")}</p><ActionLink className="button button-primary review-sign-in" href={signInPath("/reviews")}>{t("reviews.queueEmpty.action")} <span aria-hidden="true">→</span></ActionLink></EmptyState>}
    </SiteFrame>;
}

async function loadReviews(user: AuthUser | null): Promise<{ profile: DelegationProfile | null; assignments: readonly ReviewAssignmentSummary[]; jobs: readonly PublicVerificationJob[]; storageAvailable: boolean }> {
  try {
    const jobsPromise = getVerificationMarketRepository().listOpenJobs();
    if (!user) return { profile: null, assignments: [], jobs: await jobsPromise, storageAvailable: true };
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    return {
      profile,
      assignments: await getReviewAssignmentRepository().listForPerson(profile.person.id),
      jobs: await jobsPromise,
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError || error instanceof VerificationMarketSchemaUnavailableError) {
      return { profile: null, assignments: [], jobs: [], storageAvailable: false };
    }
    throw error;
  }
}

function ReviewMessage({ unavailable, t }: { unavailable?: boolean; t: Translator }) {
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main review-main">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/explore">{t("explore.breadcrumb")}</Link><span> / </span><span>{t("reviews.breadcrumb.market")}</span></Breadcrumb>
      <SectionHeading as="section" className="review-heading"><div><p className="eyebrow">{t("reviews.message.eyebrow")}</p><PageTitle>{t("reviews.message.title")}</PageTitle><p>{t("reviews.message.detail")}</p></div><Badge className="record-chip">{unavailable ? t("reviews.message.unavailable") : t("reviews.message.personal")}</Badge></SectionHeading>
    </SiteFrame>;
}
