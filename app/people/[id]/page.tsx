import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, CardTitle, Badge, Field, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { notFound } from "next/navigation";
import { MissingDatabaseBindingError } from "@/db";
import { getPersonProfileRepository, type PublicPersonProfile } from "@/db/repositories/profiles";
import { type ContributionReceiptKind, type PublicContributionReceiptIndexItem } from "@/db/repositories/receipts";
import { type ResearchNodeKind } from "@/db/repositories/research-graph";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

const receiptKindKeys: Record<ContributionReceiptKind, TranslationKey> = {
  formalization: "profile.receiptKind.formalization",
  lemma: "profile.receiptKind.lemma",
  proof_patch: "profile.receiptKind.proof_patch",
  counterexample: "profile.receiptKind.counterexample",
  verification: "profile.receiptKind.verification",
  synthesis: "profile.receiptKind.synthesis",
  infrastructure: "profile.receiptKind.infrastructure",
};

const receiptStatusKeys: Record<PublicContributionReceiptIndexItem["lifecycleStatus"], TranslationKey> = {
  issued: "receipts.status.issued",
  corrected: "receipts.status.corrected",
  superseded: "receipts.status.superseded",
  retracted: "receipts.status.retracted",
};

const checkpointKindKeys: Record<ResearchNodeKind, TranslationKey> = {
  formalization: "explore.graph.kind.formalization",
  hypothesis: "explore.graph.kind.hypothesis",
  lemma: "explore.graph.kind.lemma",
  proof_state: "explore.graph.kind.proof_state",
  proof_patch: "explore.graph.kind.proof_patch",
  counterexample: "explore.graph.kind.counterexample",
  negative_result: "explore.graph.kind.negative_result",
  synthesis: "explore.graph.kind.synthesis",
};

export const dynamic = "force-dynamic";

export default async function PublicPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { t, locale } = await getI18n();
  const { id } = await params;
  let profile: PublicPersonProfile | null = null;
  try {
    profile = await getPersonProfileRepository().findPublicByPersonId(id);
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return <PublicProfileUnavailable t={t} />;
    throw error;
  }
  if (!profile) notFound();

  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main public-profile-main">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/receipts">{t("people.breadcrumb.receipts")}</Link><span> / </span><span>{t("people.breadcrumb.person")}</span></Breadcrumb>
      <SectionHeading as="section" className="public-profile-hero">
        <div className="profile-avatar is-public" aria-hidden="true">{initials(profile.person.displayName)}</div>
        <div><p className="eyebrow">{t("people.eyebrow")}</p><PageTitle>{profile.person.displayName}</PageTitle><code>{profile.person.id}</code><p>{t("people.joined", { date: formatDate(profile.person.joinedAt, locale) })}</p></div>
        <Badge className="record-chip">{t("people.badge")}</Badge>
      </SectionHeading>

      <section className="public-profile-stats" aria-label={t("people.stats.aria")}>
        <ProfileStat value={profile.summary.verifiedReceipts} label={t("people.stat.verifiedReceipts")} />
        <ProfileStat value={profile.credits.totalUnits} label={t("people.stat.credit")} />
        <ProfileStat value={profile.summary.sharedCheckpoints} label={t("people.stat.sharedCheckpoints")} />
        <ProfileStat value={profile.summary.independentReviews} label={t("people.stat.independentReviews")} />
        <ProfileStat value={profile.summary.challengeFindings} label={t("people.stat.findings")} />
      </section>

      {(profile.receiptKinds.length > 0 || profile.publicAgentLabels.length > 0 || profile.credits.categories.length > 0) && <section className="public-profile-taxonomy" aria-label={t("people.taxonomy.aria")}>
        <div><span>{t("people.taxonomy.receiptMix")}</span><p>{profile.receiptKinds.length > 0 ? profile.receiptKinds.map((entry) => `${t(receiptKindKeys[entry.kind])} ${entry.count}`).join(" · ") : t("people.taxonomy.noReceipts")}</p></div>
        <div><span>{t("people.taxonomy.agents")}</span><p>{profile.publicAgentLabels.length > 0 ? profile.publicAgentLabels.join(" · ") : t("people.taxonomy.noAgents")}</p></div>
        <div><span>{t("people.taxonomy.credit")}</span><p>{profile.credits.categories.length > 0 ? profile.credits.categories.map((entry) => `${creditCategoryLabel(entry.category)} ${entry.units}`).join(" · ") : t("people.taxonomy.noCredit")}</p></div>
      </section>}

      <p className="public-profile-disclosure">{t("people.disclosure")}</p>

      <section className="public-profile-section" aria-labelledby="public-receipts-title">
        <SectionHeading as="div" className="profile-section-heading"><div><p className="eyebrow">{t("people.receipts.eyebrow")}</p><SectionTitle id="public-receipts-title">{t("people.receipts.title")}</SectionTitle></div><Badge className="record-chip">{t("people.receipts.count", { count: profile.receipts.length })}</Badge></SectionHeading>
        {profile.receipts.length === 0 ? <PublicEmpty title={t("people.receipts.emptyTitle")} detail={t("people.receipts.emptyDetail")} /> : <div className="public-receipt-grid">{profile.receipts.map((receipt) => <Surface as="article" key={receipt.id}><div><span className="micro-label">{t(receiptKindKeys[receipt.kind])}</span><span className={`receipt-index-status is-${receipt.lifecycleStatus}`}>{t(receiptStatusKeys[receipt.lifecycleStatus])}</span></div><CardTitle>{receipt.target.declaration}</CardTitle><FieldList><Field label={t("people.receipt.issued")}>{formatDate(receipt.issuedAt, locale)}</Field><Field label={t("people.receipt.dependencies")}>{receipt.dependencyCount}</Field><Field label={t("people.receipt.hash")}><code>{shortHash(receipt.receiptHash)}</code></Field></FieldList><Link className="text-link" href={`/receipt/${encodeURIComponent(receipt.id)}`}>{t("people.receipt.inspect")} <span>→</span></Link></Surface>)}</div>}
      </section>

      <section className="public-profile-section" aria-labelledby="public-checkpoints-title">
        <SectionHeading as="div" className="profile-section-heading"><div><p className="eyebrow">{t("people.checkpoints.eyebrow")}</p><SectionTitle id="public-checkpoints-title">{t("people.checkpoints.title")}</SectionTitle></div><Badge className="record-chip">{t("people.checkpoints.badge")}</Badge></SectionHeading>
        {profile.recentCheckpoints.length === 0 ? <PublicEmpty title={t("people.checkpoints.emptyTitle")} detail={t("people.checkpoints.emptyDetail")} /> : <div className="public-checkpoint-list">{profile.recentCheckpoints.map((checkpoint) => <Surface as="article" key={checkpoint.id}><div><span>{t(checkpointKindKeys[checkpoint.kind])}</span><time dateTime={checkpoint.occurredAt}>{formatDate(checkpoint.occurredAt, locale)}</time></div><CardTitle>{checkpoint.summary}</CardTitle><p>{checkpoint.target.title}</p><footer><span>{t("people.checkpoints.via", { agent: checkpoint.agentLabel })}</span><Link href={`/explore/${encodeURIComponent(checkpoint.target.slug)}#research-graph`}>{t("people.checkpoints.openGraph")} →</Link></footer></Surface>)}</div>}
      </section>

      <section className="public-profile-boundary"><strong>{t("people.boundary.title")}</strong><p>{t("people.boundary.body")}</p></section>
    </SiteFrame>;
}

function ProfileStat({ value, label }: { value: number; label: string }) {
  return <Surface as="article"><strong>{value}</strong><span>{label}</span></Surface>;
}

function PublicEmpty({ title, detail }: { title: string; detail: string }) {
  return <EmptyState as="div" className="public-profile-empty"><strong>{title}</strong><p>{detail}</p></EmptyState>;
}

function creditCategoryLabel(category: string) {
  return category.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase() : (parts[0]?.slice(0, 2).toUpperCase() ?? "PW");
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function shortHash(value: string) {
  return `${value.slice(0, 16)}…${value.slice(-8)}`;
}

function PublicProfileUnavailable({ t }: { t: Translator }) {
  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main public-profile-main"><SectionHeading as="section" className="review-heading"><div><p className="eyebrow">{t("people.unavailable.eyebrow")}</p><PageTitle>{t("people.unavailable.title")}</PageTitle><p>{t("people.unavailable.body")}</p></div><Badge className="record-chip">{t("people.unavailable.badge")}</Badge></SectionHeading></SiteFrame>;
}
