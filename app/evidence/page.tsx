import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";

import { PersonalWorkspaceFrame } from "@/app/PersonalWorkspaceFrame";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getEvidenceRepository, type AttemptEvidenceSummary } from "@/db/repositories/evidence";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { Translator } from "@/app/i18n/translate";

export const dynamic = "force-dynamic";

export default async function EvidenceIndexPage() {
  const { t, locale } = await getI18n();
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (!user) return <EvidenceMessage unauthenticated t={t} />;
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="workbench"
      eyebrow={t("evidence.readOnly.eyebrow")}
      title={t("evidence.readOnly.title")}
      detail={t("evidence.readOnly.detail")}
    />;
  }
  const result = await loadEvidence(user);
  if (result.unavailable) return <EvidenceMessage unavailable t={t} />;
  const evidence = result.evidence;
  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main evidence-main personal-workspace-main">
      <PersonalWorkspaceFrame active="evidence">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/workbench">{t("nav.primary.workspace")}</Link><span> / </span><span>{t("evidence.index.breadcrumb")}</span></Breadcrumb>
      <SectionHeading as="section" className="review-heading"><div><p className="eyebrow">{t("evidence.index.eyebrow")}</p><PageTitle>{t("evidence.index.title")}</PageTitle><p>{t("evidence.index.body")}</p></div><Badge className="record-chip">{t("evidence.index.records", { count: evidence.length })}</Badge></SectionHeading>
      {evidence.length === 0 ? <EmptyState as="section" className="review-empty"><p className="eyebrow">{t("evidence.index.emptyEyebrow")}</p><SectionTitle>{t("evidence.index.emptyTitle")}</SectionTitle><p>{t("evidence.index.emptyBody")}</p><Link className="text-link" href="/workbench">{t("evidence.index.emptyAction")} <span>→</span></Link></EmptyState> : <section className="evidence-index-list" aria-label={t("evidence.index.listAria")}>{evidence.map((record) => <EvidenceIndexCard key={record.artifactBundleManifestHash} record={record} t={t} locale={locale} />)}</section>}
      </PersonalWorkspaceFrame>
    </SiteFrame>;
}

async function loadEvidence(user: Awaited<ReturnType<typeof getCurrentUser>>): Promise<{ evidence: readonly AttemptEvidenceSummary[]; unavailable: boolean }> {
  if (!user) return { evidence: [], unavailable: false };
  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    return { evidence: await getEvidenceRepository().listForPerson(profile.person.id), unavailable: false };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { evidence: [], unavailable: true };
    throw error;
  }
}

function EvidenceIndexCard({ record, t, locale }: { record: AttemptEvidenceSummary; t: Translator; locale: Locale }) {
  return <Surface as="article" className="evidence-index-card">
    <div className="evidence-index-card-top"><span className="micro-label">{record.accessRole === "attempt_owner" ? t("evidence.card.yourAttempt") : t("evidence.card.assignedReview")}</span><span className="review-status is-accepted">{record.latestRunState ?? t("evidence.card.noRun")}</span></div>
    <SectionTitle>{record.target.title}</SectionTitle>
    <p><code>{record.target.declaration}</code></p>
    <FieldList><Field label={t("evidence.card.agent")}>{record.agentLabel}</Field><Field label={t("evidence.card.bundleHash")}><code>{record.artifactBundleManifestHash}</code></Field><Field label={t("evidence.card.updated")}>{formatDate(record.updatedAt, locale)}</Field></FieldList>
    <ActionLink className="button button-primary evidence-inspect-link" href={`/evidence/${encodeURIComponent(record.artifactBundleManifestHash)}`}>{t("evidence.card.inspect")} <span aria-hidden="true">→</span></ActionLink>
  </Surface>;
}

function EvidenceMessage({ unauthenticated, unavailable, t }: { unauthenticated?: boolean; unavailable?: boolean; t: Translator }) {
  return <SiteFrame className="site-shell app-shell" active="workbench" mainClassName="page-main evidence-main personal-workspace-main"><PersonalWorkspaceFrame active="evidence"><Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/workbench">{t("nav.primary.workspace")}</Link><span> / </span><span>{t("evidence.index.breadcrumb")}</span></Breadcrumb><SectionHeading as="section" className="review-heading"><div><p className="eyebrow">{t("evidence.message.eyebrow")}</p><PageTitle>{unauthenticated ? t("evidence.message.signInTitle") : t("evidence.message.unavailableTitle")}</PageTitle><p>{unauthenticated ? t("evidence.message.signInBody") : t("evidence.message.unavailableBody")}</p></div><Badge className="record-chip">{unavailable ? t("evidence.message.badgeUnavailable") : t("evidence.message.badgePersonal")}</Badge></SectionHeading>{unauthenticated && <ActionLink className="button button-primary review-sign-in" href={signInPath("/evidence")}>{t("evidence.message.signInAction")} <span aria-hidden="true">→</span></ActionLink>}</PersonalWorkspaceFrame></SiteFrame>;
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
