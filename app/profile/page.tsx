import { Suspense, type ReactNode } from "react";
import { ContentLoading } from "@/app/components/ui/ContentLoading";
import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Button, Badge, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getPrivateProfileFacts } from "@/db/repositories/profiles";
import { getReceiptCreditRepository } from "@/db/repositories/receipt-credits";
import { getContributionReceiptReader, type PublicContributionReceiptIndexItem } from "@/db/repositories/receipts";
import { profileRead, requireProfileUser, type ProfileRead } from "../lib/profile-read";
import { type McpAttempt } from "@/packages/domain/mcp";
import { providerAwareSignOutPath, toPersonIdentity, type AuthUser } from "../auth";

import { loadWorkspaceOverview } from "../lib/personal-workspace-summary";
import { PersonalWorkspaceFrame } from "../PersonalWorkspaceFrame";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "../lib/read-only-personal-surface";
import { getI18n } from "@/app/i18n/server";
import { pathForLocale, type Locale } from "@/app/i18n/config";
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
  const user = await requireProfileUser();
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="profile"
      eyebrow={t("profile.readOnly.eyebrow")}
      title={t("profile.readOnly.title")}
      detail={t("profile.readOnly.detail", { name: user.displayName })}
    />;
  }
  const ui = { t, locale };
  const delegation = profileRead("delegation", () => user.personId
    ? getDelegationRepository().getProfileForPerson({ id: user.personId, displayName: user.displayName })
    : getDelegationRepository().getProfile(toPersonIdentity(user)));
  const resolvedPersonId = user.personId ?? delegation.then(result => result.ok ? result.value.person.id : null);
  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main profile-main personal-workspace-main">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/workbench">{t("nav.primary.workspace")}</Link><span> / </span><span>{t("profile.breadcrumb.profile")}</span></Breadcrumb>
      <SectionHeading as="section" className="profile-hero">
        <div className="profile-avatar" aria-hidden="true">{initials(user.displayName)}</div>
        <SectionHeading as="div" className="profile-hero-copy"><p className="eyebrow">{t("profile.eyebrow")}</p><PageTitle>{user.displayName}</PageTitle><p>{user.email}</p><Suspense fallback={null}><ProfilePerson id={resolvedPersonId} /></Suspense></SectionHeading>
        <div className="profile-hero-actions"><Suspense fallback={null}><ProfilePerson id={resolvedPersonId} linkLabel={t("profile.action.public")} /></Suspense><Link className="text-link" href={providerAwareSignOutPath(user, "/")}>{t("profile.action.signOut")} <span>→</span></Link></div>
      </SectionHeading>

    <Suspense fallback={<ContentLoading label={t("common.loadingPage")} />}>
      <ProfileContents user={user} delegation={delegation} {...ui} />
    </Suspense>
  </SiteFrame>;
}

async function ProfilePerson({ id, linkLabel }: { id: string | Promise<string | null>; linkLabel?: string }) {
  const personId = await id;
  if (!personId) return null;
  if (!linkLabel) return <code>{personId}</code>;
  return <ActionLink className="button profile-public-button" href={`/people/${encodeURIComponent(personId)}`}>{linkLabel} <span>↗</span></ActionLink>;
}

type ProfileUI = { t: Translator; locale: Locale };
type Delegation = Awaited<ReturnType<ReturnType<typeof getDelegationRepository>["getProfile"]>>;

async function ProfileContents({ user, delegation, ...ui }: ProfileUI & {
  user: AuthUser; delegation: Promise<ProfileRead<Delegation>>;
}) {
  const { t, locale } = ui;
  let personId = user.personId;
  if (!personId) {
    const resolved = await delegation;
    if (!resolved.ok) return <RetryRead {...ui} reference={resolved.reference} />;
    personId = resolved.value.person.id;
  }
  const id = personId;
  const facts = profileRead("facts", () => getPrivateProfileFacts(id));
  const receipts = profileRead("receipts", () => getContributionReceiptReader().listByPerson(id, 100));
  const credits = profileRead("credits", () => getReceiptCreditRepository().summaryForPerson(id));
  const workspace = delegation.then(result => result.ok
    ? profileRead("workspace", () => loadWorkspaceOverview(result.value))
    : result);

  return <PersonalWorkspaceFrame active="profile" summary={workspace.then(result => result.ok ? result.value.summary : null)}>
      <section className="profile-assurance" aria-label={t("profile.assurance.aria")}>
        <div><span>{t("profile.assurance.authLabel")}</span><strong>{t("profile.assurance.authValue", { provider: user.providerLabel })}</strong><p>{user.provider === "proofweave" ? t("profile.assurance.demoBody") : t("profile.assurance.verifiedBody")}</p></div>
        <div><span>{t("profile.assurance.rootLabel")}</span><strong>{t("profile.assurance.rootValue")}</strong><p>{t("profile.assurance.rootBody")}</p></div>
        <div><span>{t("profile.assurance.sinceLabel")}</span><SectionValue read={facts} {...ui}>{value => <strong>{formatDate(value.joinedAt, locale)}</strong>}</SectionValue><p>{t("profile.assurance.sinceBody")}</p></div>
      </section>

      <section className="profile-section" aria-labelledby="profile-overview-title">
        <SectionHeading as="div" className="profile-section-heading"><div><p className="eyebrow">{t("profile.overview.eyebrow")}</p><SectionTitle id="profile-overview-title">{t("profile.overview.title")}</SectionTitle></div><Badge className="record-chip">{t("profile.overview.badge")}</Badge></SectionHeading>
        <div className="profile-stat-grid">
          <SectionValue read={workspace} {...ui}>{value => <ProfileStat value={value.summary.counts.activeAttempts} label={t("profile.stat.activeAttempts")} detail={t("profile.stat.activeDetail", { count: value.attempts.length })} />}</SectionValue>
          <SectionValue read={facts} {...ui}>{value => <ProfileStat value={value.sharedCheckpoints} label={t("profile.stat.sharedCheckpoints")} detail={t("profile.stat.sharedDetail")} />}</SectionValue>
          <SectionValue read={receipts} {...ui}>{value => <ProfileStat value={value.length} label={t("profile.stat.verifiedReceipts")} detail={t("profile.stat.receiptsDetail")} />}</SectionValue>
          <SectionValue read={credits} {...ui}>{value => <ProfileStat value={value.active ? value.totalUnits : null} label={t("profile.stat.credit")} detail={t("profile.stat.creditDetail", { count: value.settledReceipts })} />}</SectionValue>
          <SectionValue read={workspace} {...ui}>{value => <ProfileStat value={value.reviews.filter(review => review.status === "completed").length} label={t("profile.stat.completedReviews")} detail={t("profile.stat.reviewsDetail", { count: value.summary.counts.activeReviews })} />}</SectionValue>
          <SectionValue read={delegation} {...ui}>{value => <ProfileStat value={value.agents.filter(agent => agent.status === "active").length} label={t("profile.stat.activeAgents")} detail={t("profile.stat.agentsDetail", { count: value.delegations.filter(item => item.revokedAt === null).length })} />}</SectionValue>
          <SectionValue read={workspace} {...ui}>{value => <ProfileStat value={value.summary.counts.provisionalContributions} label={t("profile.stat.stagedBundles")} detail={t("profile.stat.bundlesDetail")} />}</SectionValue>
        </div>
      </section>

      <div className="profile-two-column">
        <SectionValue read={workspace} {...ui}>{overview =>
          <SectionValue read={receipts} {...ui}>{items => {
            const activities = recentActivity({ attempts: overview.attempts, reviews: overview.reviews, receipts: items, t });
            return <section className="profile-section profile-activity" aria-labelledby="profile-activity-title">
          <SectionHeading as="div" className="profile-section-heading compact"><div><p className="eyebrow">{t("profile.activity.eyebrow")}</p><SectionTitle id="profile-activity-title">{t("profile.activity.title")}</SectionTitle></div><Link className="text-link" href="/workbench">{t("profile.activity.openWorkspace")} <span>→</span></Link></SectionHeading>
          {activities.length === 0 ? <ProfileEmpty title={t("profile.activity.emptyTitle")} detail={t("profile.activity.emptyDetail")} action={t("profile.activity.emptyAction")} href="/explore" /> : <ol className="profile-activity-list">{activities.map((activity) => <li key={activity.id}><span className={`profile-activity-mark is-${activity.tone}`} aria-hidden="true" /><div><strong>{activity.title}</strong><p>{activity.detail}</p></div><time dateTime={activity.occurredAt}>{formatDate(activity.occurredAt, locale)}</time></li>)}</ol>}
        </section>;
          }}</SectionValue>
        }</SectionValue>
        <SectionValue read={delegation} {...ui}>{delegation => {
          const activeAgents = delegation.agents.filter(agent => agent.status === "active").length;
          const activeDelegations = delegation.delegations.filter(item => item.revokedAt === null).length;
          return <aside className="profile-control-card">
          <p className="eyebrow">{t("profile.control.eyebrow")}</p><SectionTitle>{activeAgents > 0 && activeDelegations > 0 ? t("profile.control.activeTitle") : t("profile.control.setupTitle")}</SectionTitle><p>{activeAgents > 0 ? t("profile.control.activeBody", { agents: activeAgents, delegations: activeDelegations }) : t("profile.control.setupBody")}</p>
          <FieldList><Field label={t("profile.control.signingKeys")}>{delegation.signingKeys.length}</Field><Field label={t("profile.control.connections")}>{delegation.agentInstallations.filter((item) => item.status === "active").length}</Field><Field label={t("profile.control.settlement")}>{<SectionValue read={credits} {...ui}>{value => value.active ? t("profile.control.settled", { units: value.totalUnits }) : t("profile.control.unavailable")}</SectionValue>}</Field></FieldList>
          <ActionLink className="button button-primary" href="/settings">{t("profile.control.manage")} <span>→</span></ActionLink>
        </aside>;
        }}</SectionValue>
      </div>
      <section className="profile-privacy-boundary"><div><p className="eyebrow">{t("profile.privacy.eyebrow")}</p><SectionTitle>{t("profile.privacy.title")}</SectionTitle></div><p>{t("profile.privacy.body")}</p></section>
  </PersonalWorkspaceFrame>;
}

function SectionValue<T>({ read, children, ...ui }: ProfileUI & {
  read: Promise<ProfileRead<T>>; children: (value: T) => ReactNode;
}) {
  return <Suspense fallback={<ContentLoading label={ui.t("common.loadingPage")} />}>
    <ReadResult read={read} {...ui}>{children}</ReadResult>
  </Suspense>;
}

async function ReadResult<T>({ read, children, ...ui }: ProfileUI & {
  read: Promise<ProfileRead<T>>; children: (value: T) => ReactNode;
}) {
  const result = await read;
  return result.ok ? <>{children(result.value)}</> : <RetryRead {...ui} reference={result.reference} />;
}

function RetryRead({ locale, t, reference }: ProfileUI & { reference: string }) {
  return <form action={pathForLocale("/profile", locale)} method="get" className="profile-retry-read">
    <span>{t("profile.sectionUnavailable")}</span>
    <Button type="submit">{t("explore.error.retry")}</Button>
    <small>{reference}</small>
  </form>;
}

function ProfileStat({ value, label, detail }: { value: number | null; label: string; detail: string }) {
  return <Surface as="article"><strong>{value ?? "—"}</strong><span>{label}</span><p>{detail}</p></Surface>;
}

function ProfileEmpty({ title, detail, action, href }: { title: string; detail: string; action: string; href: string }) {
  return <EmptyState as="div" className="profile-empty"><strong>{title}</strong><p>{detail}</p><Link className="text-link" href={href}>{action} <span>→</span></Link></EmptyState>;
}

function recentActivity({ attempts, reviews, receipts, t }: {
  attempts: readonly McpAttempt[];
  reviews: readonly { id: string; target: { title: string }; status: string; assignedAt: string; completedAt: string | null }[];
  receipts: readonly PublicContributionReceiptIndexItem[];
  t: Translator;
}) {
  const items = [
    ...attempts.map((attempt) => ({ id: `attempt:${attempt.id}`, tone: "attempt", title: attempt.problemTitle, detail: t("profile.activity.attemptDetail", { agent: attempt.agentLabel, status: attempt.status }), occurredAt: attempt.updatedAt })),
    ...reviews.map((review) => ({ id: `review:${review.id}`, tone: "review", title: review.target.title, detail: t("profile.activity.reviewDetail", { status: review.status }), occurredAt: review.completedAt ?? review.assignedAt })),
    ...receipts.map((receipt) => ({ id: `receipt:${receipt.id}`, tone: "receipt", title: receipt.target.declaration, detail: t("profile.activity.receiptDetail", { kind: t(receiptKindKeys[receipt.kind]), status: receipt.lifecycleStatus }), occurredAt: receipt.issuedAt })),
  ];
  return items.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 8);
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase() : (parts[0]?.slice(0, 2).toUpperCase() ?? "PW");
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(date) : "—";
}
