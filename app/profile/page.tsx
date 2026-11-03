import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getMcpRepository } from "@/db/repositories/mcp";
import { getPersonProfileRepository, type PublicPersonProfile } from "@/db/repositories/profiles";
import { getProvisionalContributionRepository, ProvisionalContributionSchemaUnavailableError } from "@/db/repositories/provisional-contributions";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";
import { type McpAttempt } from "@/packages/domain/mcp";
import { providerAwareSignOutPath, requireUser, toPersonIdentity, type AuthUser } from "../auth";

import { PersonalWorkspaceFrame } from "../PersonalWorkspaceFrame";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "../lib/read-only-personal-surface";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import type { ContributionReceiptKind } from "@/db/repositories/receipts";

const receiptKindKeys: Record<ContributionReceiptKind, TranslationKey> = {
  formalization: "profile.receiptKind.formalization",
  lemma: "profile.receiptKind.lemma",
  proof_patch: "profile.receiptKind.proof_patch",
  counterexample: "profile.receiptKind.counterexample",
  verification: "profile.receiptKind.verification",
  synthesis: "profile.receiptKind.synthesis",
  infrastructure: "profile.receiptKind.infrastructure",
};

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const { t, locale } = await getI18n();
  const readOnly = personalWritesPaused();
  const user = await requireUser("/profile");
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="profile"
      eyebrow={t("profile.readOnly.eyebrow")}
      title={t("profile.readOnly.title")}
      detail={t("profile.readOnly.detail", { name: user.displayName })}
    />;
  }
  const data = await loadProfile(user);
  if (!data) return <ProfileUnavailable />;
  const { delegation, publicProfile, attempts, reviews, provisionalBundleCount } = data;
  const activeDelegations = delegation.delegations.filter((item) => item.revokedAt === null).length;
  const activeAgents = delegation.agents.filter((agent) => agent.status === "active").length;
  const activeAttempts = attempts.filter((attempt) => attempt.status === "active").length;
  const activeReviews = reviews.filter((review) => review.status === "assigned" || review.status === "accepted").length;
  const completedReviews = reviews.filter((review) => review.status === "completed").length;
  const activities = recentActivity({ attempts, reviews, publicProfile, t });

  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main profile-main personal-workspace-main">
      <PersonalWorkspaceFrame active="profile">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/workbench">{t("nav.primary.workspace")}</Link><span> / </span><span>{t("profile.breadcrumb.profile")}</span></Breadcrumb>
      <SectionHeading as="section" className="profile-hero">
        <div className="profile-avatar" aria-hidden="true">{initials(user.displayName)}</div>
        <SectionHeading as="div" className="profile-hero-copy"><p className="eyebrow">{t("profile.eyebrow")}</p><PageTitle>{user.displayName}</PageTitle><p>{user.email}</p><code>{delegation.person.id}</code></SectionHeading>
        <div className="profile-hero-actions"><ActionLink className="button profile-public-button" href={`/people/${encodeURIComponent(delegation.person.id)}`}>{t("profile.action.public")} <span>↗</span></ActionLink><Link className="text-link" href={providerAwareSignOutPath(user, "/")}>{t("profile.action.signOut")} <span>→</span></Link></div>
      </SectionHeading>

      <section className="profile-assurance" aria-label={t("profile.assurance.aria")}>
        <div><span>{t("profile.assurance.authLabel")}</span><strong>{t("profile.assurance.authValue", { provider: user.providerLabel })}</strong><p>{user.provider === "proofweave" ? t("profile.assurance.demoBody") : t("profile.assurance.verifiedBody")}</p></div>
        <div><span>{t("profile.assurance.rootLabel")}</span><strong>{t("profile.assurance.rootValue")}</strong><p>{t("profile.assurance.rootBody")}</p></div>
        <div><span>{t("profile.assurance.sinceLabel")}</span><strong>{formatDate(publicProfile.person.joinedAt, locale)}</strong><p>{t("profile.assurance.sinceBody")}</p></div>
      </section>

      <section className="profile-section" aria-labelledby="profile-overview-title">
        <SectionHeading as="div" className="profile-section-heading"><div><p className="eyebrow">{t("profile.overview.eyebrow")}</p><SectionTitle id="profile-overview-title">{t("profile.overview.title")}</SectionTitle></div><Badge className="record-chip">{t("profile.overview.badge")}</Badge></SectionHeading>
        <div className="profile-stat-grid">
          <ProfileStat value={activeAttempts} label={t("profile.stat.activeAttempts")} detail={t("profile.stat.activeDetail", { count: attempts.length })} />
          <ProfileStat value={publicProfile.summary.sharedCheckpoints} label={t("profile.stat.sharedCheckpoints")} detail={t("profile.stat.sharedDetail")} />
          <ProfileStat value={publicProfile.summary.verifiedReceipts} label={t("profile.stat.verifiedReceipts")} detail={t("profile.stat.receiptsDetail")} />
          <ProfileStat value={publicProfile.credits.totalUnits} label={t("profile.stat.credit")} detail={t("profile.stat.creditDetail", { count: publicProfile.credits.settledReceipts })} />
          <ProfileStat value={completedReviews} label={t("profile.stat.completedReviews")} detail={t("profile.stat.reviewsDetail", { count: activeReviews })} />
          <ProfileStat value={activeAgents} label={t("profile.stat.activeAgents")} detail={t("profile.stat.agentsDetail", { count: activeDelegations })} />
          <ProfileStat value={provisionalBundleCount} label={t("profile.stat.stagedBundles")} detail={t("profile.stat.bundlesDetail")} />
        </div>
      </section>

      <div className="profile-two-column">
        <section className="profile-section profile-activity" aria-labelledby="profile-activity-title">
          <SectionHeading as="div" className="profile-section-heading compact"><div><p className="eyebrow">{t("profile.activity.eyebrow")}</p><SectionTitle id="profile-activity-title">{t("profile.activity.title")}</SectionTitle></div><Link className="text-link" href="/workbench">{t("profile.activity.openWorkspace")} <span>→</span></Link></SectionHeading>
          {activities.length === 0 ? <ProfileEmpty title={t("profile.activity.emptyTitle")} detail={t("profile.activity.emptyDetail")} action={t("profile.activity.emptyAction")} href="/explore" /> : <ol className="profile-activity-list">{activities.map((activity) => <li key={activity.id}><span className={`profile-activity-mark is-${activity.tone}`} aria-hidden="true" /><div><strong>{activity.title}</strong><p>{activity.detail}</p></div><time dateTime={activity.occurredAt}>{formatDate(activity.occurredAt, locale)}</time></li>)}</ol>}
        </section>

        <aside className="profile-control-card">
          <p className="eyebrow">{t("profile.control.eyebrow")}</p><SectionTitle>{activeAgents > 0 && activeDelegations > 0 ? t("profile.control.activeTitle") : t("profile.control.setupTitle")}</SectionTitle><p>{activeAgents > 0 ? t("profile.control.activeBody", { agents: activeAgents, delegations: activeDelegations }) : t("profile.control.setupBody")}</p>
          <FieldList><Field label={t("profile.control.signingKeys")}>{delegation.signingKeys.length}</Field><Field label={t("profile.control.connections")}>{delegation.agentInstallations.filter((item) => item.status === "active").length}</Field><Field label={t("profile.control.settlement")}>{publicProfile.credits.active ? t("profile.control.settled", { units: publicProfile.credits.totalUnits }) : t("profile.control.unavailable")}</Field></FieldList>
          <ActionLink className="button button-primary" href="/settings">{t("profile.control.manage")} <span>→</span></ActionLink>
        </aside>
      </div>

      <section className="profile-privacy-boundary"><div><p className="eyebrow">{t("profile.privacy.eyebrow")}</p><SectionTitle>{t("profile.privacy.title")}</SectionTitle></div><p>{t("profile.privacy.body")}</p></section>
      </PersonalWorkspaceFrame>
    </SiteFrame>;
}

async function loadProfile(user: AuthUser) {
  try {
    const delegation = await getDelegationRepository().getProfile(toPersonIdentity(user));
    const [publicProfile, attempts, reviews, provisional] = await Promise.all([
      getPersonProfileRepository().findPublicByPersonId(delegation.person.id),
      getMcpRepository().listAttempts(delegation.person.id),
      getReviewAssignmentRepository().listForPerson(delegation.person.id),
      getProvisionalContributionRepository().listForPerson(delegation.person.id),
    ]);
    if (!publicProfile) return null;
    return { delegation, publicProfile, attempts, reviews, provisionalBundleCount: provisional.length };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError || error instanceof ProvisionalContributionSchemaUnavailableError) return null;
    throw error;
  }
}

function ProfileStat({ value, label, detail }: { value: number; label: string; detail: string }) {
  return <Surface as="article"><strong>{value}</strong><span>{label}</span><p>{detail}</p></Surface>;
}

function ProfileEmpty({ title, detail, action, href }: { title: string; detail: string; action: string; href: string }) {
  return <EmptyState as="div" className="profile-empty"><strong>{title}</strong><p>{detail}</p><Link className="text-link" href={href}>{action} <span>→</span></Link></EmptyState>;
}

function recentActivity({ attempts, reviews, publicProfile, t }: {
  attempts: readonly McpAttempt[];
  reviews: readonly { id: string; target: { title: string }; status: string; assignedAt: string; completedAt: string | null }[];
  publicProfile: PublicPersonProfile;
  t: Translator;
}) {
  const items = [
    ...attempts.map((attempt) => ({ id: `attempt:${attempt.id}`, tone: "attempt", title: attempt.problemTitle, detail: t("profile.activity.attemptDetail", { agent: attempt.agentLabel, status: attempt.status }), occurredAt: attempt.updatedAt })),
    ...reviews.map((review) => ({ id: `review:${review.id}`, tone: "review", title: review.target.title, detail: t("profile.activity.reviewDetail", { status: review.status }), occurredAt: review.completedAt ?? review.assignedAt })),
    ...publicProfile.receipts.map((receipt) => ({ id: `receipt:${receipt.id}`, tone: "receipt", title: receipt.target.declaration, detail: t("profile.activity.receiptDetail", { kind: t(receiptKindKeys[receipt.kind]), status: receipt.lifecycleStatus }), occurredAt: receipt.issuedAt })),
  ];
  return items.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 8);
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase() : (parts[0]?.slice(0, 2).toUpperCase() ?? "PW");
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

async function ProfileUnavailable() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main profile-main personal-workspace-main"><PersonalWorkspaceFrame active="profile"><SectionHeading as="section" className="review-heading"><div><p className="eyebrow">{t("profile.unavailable.eyebrow")}</p><PageTitle>{t("profile.unavailable.title")}</PageTitle><p>{t("profile.unavailable.body")}</p></div><Badge className="record-chip">{t("profile.unavailable.badge")}</Badge></SectionHeading></PersonalWorkspaceFrame></SiteFrame>;
}
