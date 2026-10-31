import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";

import { PageTitle, SectionTitle, ActionLink, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../../ui";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey } from "@/app/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("records.metaTitle"), description: t("records.metaDescription") };
}

const records: readonly { titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { titleKey: "records.layer.checkpoint.title", copyKey: "records.layer.checkpoint.copy" },
  { titleKey: "records.layer.bundle.title", copyKey: "records.layer.bundle.copy" },
  { titleKey: "records.layer.run.title", copyKey: "records.layer.run.copy" },
  { titleKey: "records.layer.review.title", copyKey: "records.layer.review.copy" },
  { titleKey: "records.layer.receipt.title", copyKey: "records.layer.receipt.copy" },
];

export default async function ContributionRecordsGuidePage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="how" activeHref="/how-it-works/contribution-records" mainClassName="page-main reading-main">
    <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/how-it-works">{t("nav.item.howItWorks")}</Link><span> / </span><span>{t("records.breadcrumb")}</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">{t("records.eyebrow")}</p><PageTitle>{t("records.title")}</PageTitle><p>{t("records.intro")}</p></SectionHeading>
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#record-layers", label: t("records.nav.layers") }, { href: "#credit-boundary", label: t("records.nav.credit") }, { href: "/receipts", label: t("records.nav.receipts") }]} />
    <section className="record-layer-list" id="record-layers" aria-label={t("records.layersAria")}>{records.map((record, index) => <Surface as="article" key={record.titleKey}><span>{String(index + 1).padStart(2, "0")}</span><SectionTitle>{t(record.titleKey)}</SectionTitle><p>{t(record.copyKey)}</p></Surface>)}</section>
    <section className="reading-note" id="credit-boundary"><div><p className="eyebrow">{t("records.creditEyebrow")}</p><SectionTitle>{t("records.creditTitle")}</SectionTitle></div><p>{t("records.creditBody")}</p></section>
    <div className="reading-actions"><ActionLink className="button button-primary" href="/receipts">{t("records.inspectReceipts")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/showcase">{t("records.watchJourney")}</ActionLink></div>
  </SiteFrame>;
}
