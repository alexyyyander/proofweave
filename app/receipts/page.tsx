import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { getContributionReceiptReader, type PublicContributionReceiptIndexItem } from "@/db/repositories/receipts";
import { getI18n } from "@/app/i18n/server";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

const kindKeys: Record<PublicContributionReceiptIndexItem["kind"], TranslationKey> = {
  formalization: "receipts.kind.formalization",
  lemma: "receipts.kind.lemma",
  proof_patch: "receipts.kind.proof_patch",
  counterexample: "receipts.kind.counterexample",
  verification: "receipts.kind.verification",
  synthesis: "receipts.kind.synthesis",
  infrastructure: "receipts.kind.infrastructure",
};

const statusKeys: Record<PublicContributionReceiptIndexItem["lifecycleStatus"], TranslationKey> = {
  issued: "receipts.status.issued",
  corrected: "receipts.status.corrected",
  superseded: "receipts.status.superseded",
  retracted: "receipts.status.retracted",
};

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  const { t, locale } = await getI18n();
  let receipts: readonly PublicContributionReceiptIndexItem[] = [];
  let unavailable = false;
  try {
    receipts = await getContributionReceiptReader().listRecent();
  } catch {
    unavailable = true;
  }
  return <SiteFrame className="site-shell app-shell" active="receipt" mainClassName="page-main receipts-main">
      <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/explore">{t("explore.breadcrumb")}</Link><span> / </span><span>{t("receipts.breadcrumb.index")}</span></Breadcrumb>
      <SectionHeading as="section" className="receipt-heading"><div><p className="eyebrow">{t("receipts.eyebrow")}</p><PageTitle>{t("receipts.title")}</PageTitle><p>{t("receipts.body")}</p></div><Badge className="record-chip">{unavailable ? t("receipts.badge.unavailable") : t("receipts.badge.records", { count: receipts.length })}</Badge></SectionHeading>
      <nav className="public-section-nav" aria-label={t("receipts.nav.aria")}>
        <a href="#receipt-index"><span>{t("receipts.nav.recent")}</span><b>{unavailable ? "—" : receipts.length}</b></a>
        <Link href="/how-it-works#contribution-records"><span>{t("receipts.nav.how")}</span><b aria-hidden="true">→</b></Link>
        <Link href="/explore"><span>{t("receipts.nav.explore")}</span><b aria-hidden="true">→</b></Link>
      </nav>
      <div id="receipt-index">
        {unavailable ? <EmptyState as="section" className="receipt-message"><p className="eyebrow">{t("receipts.unavailable.eyebrow")}</p><p>{t("receipts.unavailable.body")}</p></EmptyState> : receipts.length === 0 ? <EmptyState as="section" className="receipt-message receipt-empty-state"><div><p className="eyebrow">{t("receipts.empty.eyebrow")}</p><SectionTitle>{t("receipts.empty.title")}</SectionTitle><p>{t("receipts.empty.body")}</p></div><ActionLink className="button button-primary" href="/demo#verification-console">{t("receipts.empty.action")} <span aria-hidden="true">→</span></ActionLink></EmptyState> : <section className="receipt-index-list" aria-label={t("receipts.listAria")}>{receipts.map((receipt) => <ReceiptIndexCard receipt={receipt} key={receipt.id} t={t} locale={locale} />)}</section>}
      </div>
    </SiteFrame>;
}

function ReceiptIndexCard({ receipt, t, locale }: { receipt: PublicContributionReceiptIndexItem; t: Translator; locale: Locale }) {
  return <Surface as="article" className="receipt-index-card">
    <div className="receipt-index-card-top"><span className="micro-label">{t(kindKeys[receipt.kind])}</span><span className={`receipt-index-status is-${receipt.lifecycleStatus}`}>{t(statusKeys[receipt.lifecycleStatus])}</span></div>
    <Link className="receipt-index-title" href={`/receipt/${encodeURIComponent(receipt.id)}`}>{receipt.target.declaration}</Link>
    <FieldList><Field label={t("receipts.card.creditedPerson")}><Link className="person-record-link" href={`/people/${encodeURIComponent(receipt.beneficiaryPersonId)}`}><code>{receipt.beneficiaryPersonId}</code></Link></Field><Field label={t("receipts.card.issued")}>{formatDate(receipt.issuedAt, locale)}</Field><Field label={t("receipts.card.upstream")}>{receipt.dependencyCount === 0 ? t("receipts.card.noDependencies") : t(receipt.dependencyCount === 1 ? "receipts.card.dependency.one" : "receipts.card.dependency.other", { count: receipt.dependencyCount })}</Field><Field label={t("receipts.card.hash")}><code>{receipt.receiptHash}</code></Field></FieldList>
    <Link className="text-link" href={`/receipt/${encodeURIComponent(receipt.id)}`}>{t("receipts.card.inspect")} <span>→</span></Link>
  </Surface>;
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
