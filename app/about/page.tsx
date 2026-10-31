import { CardTitle, SectionTitle, ActionLink, PageIntro, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../ui";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey } from "@/app/i18n/translate";

const builderUrl = "https://github.com/alexyyyander";
const openCatalogUrl = "https://github.com/alexyyyander/proofweave-open-catalog";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("about.metaTitle"), description: t("about.metaDescription") };
}

const topics: readonly { number: string; titleKey: TranslationKey; copyKey: TranslationKey; href: string }[] = [
  { number: "01", titleKey: "about.topic.principles.title", copyKey: "about.topic.principles.copy", href: "/about/principles" },
  { number: "02", titleKey: "about.topic.catalogStandard.title", copyKey: "about.topic.catalogStandard.copy", href: "/about/catalog-standard" },
  { number: "03", titleKey: "about.topic.sharedResearch.title", copyKey: "about.topic.sharedResearch.copy", href: "/about/shared-research" },
];

export default async function AboutPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell primary-page" active="about" mainClassName="page-main information-hub-main">
    <PageIntro id="mission" label={t("about.label")} title={t("about.title")} description={t("about.description")} />
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#product", label: t("about.nav.product") }, { href: "#design-documents", label: t("about.nav.documents") }, { href: "#builder", label: t("about.nav.builder") }]} />
    <section className="about-definition" id="product" aria-labelledby="about-definition-title"><div><p className="eyebrow">{t("about.productEyebrow")}</p><SectionTitle id="about-definition-title">{t("about.productTitle")}</SectionTitle></div><div><Surface as="article"><span>{t("about.network.title")}</span><p>{t("about.network.copy")}</p></Surface><Surface as="article"><span>{t("about.verification.title")}</span><p>{t("about.verification.copy")}</p></Surface><Surface as="article"><span>{t("about.record.title")}</span><p>{t("about.record.copy")}</p></Surface></div></section>
    <section className="information-path-grid about-topic-grid" id="design-documents" aria-label={t("about.documentsAria")}>{topics.map((topic) => <Link href={topic.href} key={topic.href}><span>{topic.number}</span><CardTitle as="h2">{t(topic.titleKey)}</CardTitle><p>{t(topic.copyKey)}</p><strong>{t("about.topic.read")} <b aria-hidden="true">→</b></strong></Link>)}</section>
    <Surface as="section" className="about-project-card" id="builder"><div className="builder-mark" aria-hidden="true">AY</div><div><p className="eyebrow">{t("about.builderEyebrow")}</p><SectionTitle>{t("about.builderTitle")}</SectionTitle><p>{t("about.builderBody")}</p></div><div className="about-project-links"><a href={builderUrl} rel="noreferrer" target="_blank">{t("about.builderGithub")} <span>↗</span></a><a href={openCatalogUrl} rel="noreferrer" target="_blank">{t("about.builderCatalog")} <span>↗</span></a></div></Surface>
    <section className="hub-next-action"><div><p className="eyebrow">{t("about.nextEyebrow")}</p><SectionTitle>{t("about.nextTitle")}</SectionTitle></div><div className="button-row"><ActionLink className="button button-primary" href="/showcase">{t("about.watchJourney")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/explore">{t("about.openCatalog")}</ActionLink></div></section>
  </SiteFrame>;
}
