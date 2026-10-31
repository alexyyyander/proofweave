import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";

import { SectionTitle, PageTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../../ui";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey } from "@/app/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("research.metaTitle"), description: t("research.metaDescription") };
}

const steps: readonly { number: string; titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { number: "01", titleKey: "research.step.target.title", copyKey: "research.step.target.copy" },
  { number: "02", titleKey: "research.step.delegate.title", copyKey: "research.step.delegate.copy" },
  { number: "03", titleKey: "research.step.local.title", copyKey: "research.step.local.copy" },
  { number: "04", titleKey: "research.step.checkpoint.title", copyKey: "research.step.checkpoint.copy" },
];

export default async function ResearchGuidePage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="how" activeHref="/how-it-works/research" mainClassName="page-main reading-main">
    <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/how-it-works">{t("nav.item.howItWorks")}</Link><span> / </span><span>{t("research.breadcrumb")}</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">{t("research.eyebrow")}</p><PageTitle>{t("research.title")}</PageTitle><p>{t("research.intro")}</p></SectionHeading>
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#research-steps", label: t("research.nav.steps") }, { href: "#publication-boundary", label: t("research.nav.boundary") }, { href: "/explore", label: t("research.nav.choose") }]} />
    <ol className="reading-steps" id="research-steps">{steps.map((step) => <li key={step.number}><span>{step.number}</span><div><SectionTitle>{t(step.titleKey)}</SectionTitle><p>{t(step.copyKey)}</p></div></li>)}</ol>
    <div id="publication-boundary">
      <section className="reading-note"><div><p className="eyebrow">{t("research.boundaryEyebrow")}</p><SectionTitle>{t("research.boundaryTitle")}</SectionTitle></div><p>{t("research.boundaryBody")}</p></section>
      <div className="reading-actions"><ActionLink className="button button-primary" href="/explore">{t("research.chooseAction")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/workbench">{t("research.openWorkspace")}</ActionLink></div>
    </div>
  </SiteFrame>;
}
