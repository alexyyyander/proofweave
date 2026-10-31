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
  return { title: t("principles.metaTitle"), description: t("principles.metaDescription") };
}

const principles: readonly { titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { titleKey: "principles.one.title", copyKey: "principles.one.copy" },
  { titleKey: "principles.two.title", copyKey: "principles.two.copy" },
  { titleKey: "principles.three.title", copyKey: "principles.three.copy" },
  { titleKey: "principles.four.title", copyKey: "principles.four.copy" },
  { titleKey: "principles.five.title", copyKey: "principles.five.copy" },
  { titleKey: "principles.six.title", copyKey: "principles.six.copy" },
];

export default async function PrinciplesPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="about" activeHref="/about/principles" mainClassName="page-main reading-main">
    <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/about">{t("nav.primary.about")}</Link><span> / </span><span>{t("nav.item.principles")}</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">{t("principles.eyebrow")}</p><PageTitle>{t("principles.title")}</PageTitle><p>{t("principles.intro")}</p></SectionHeading>
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#principles", label: t("principles.nav.six") }, { href: "#boundary", label: t("principles.nav.boundary") }, { href: "/about/catalog-standard", label: t("principles.nav.catalog") }]} />
    <section className="principle-reading-grid" id="principles" aria-label={t("principles.gridAria")}>{principles.map((principle, index) => <Surface as="article" key={principle.titleKey}><span>{String(index + 1).padStart(2, "0")}</span><SectionTitle>{t(principle.titleKey)}</SectionTitle><p>{t(principle.copyKey)}</p></Surface>)}</section>
    <section className="reading-note" id="boundary"><div><p className="eyebrow">{t("principles.boundaryEyebrow")}</p><SectionTitle>{t("principles.boundaryTitle")}</SectionTitle></div><p>{t("principles.boundaryBody")}</p></section>
    <div className="reading-actions"><ActionLink className="button button-primary" href="/about/catalog-standard">{t("principles.readCatalog")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/about">{t("principles.back")}</ActionLink></div>
  </SiteFrame>;
}
