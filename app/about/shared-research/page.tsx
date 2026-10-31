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
  return { title: t("shared.metaTitle"), description: t("shared.metaDescription") };
}

const steps: readonly { number: string; titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { number: "01", titleKey: "shared.readState.title", copyKey: "shared.readState.copy" },
  { number: "02", titleKey: "shared.chooseBranch.title", copyKey: "shared.chooseBranch.copy" },
  { number: "03", titleKey: "shared.publish.title", copyKey: "shared.publish.copy" },
  { number: "04", titleKey: "shared.reuse.title", copyKey: "shared.reuse.copy" },
];

export default async function SharedResearchPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="about" activeHref="/about/shared-research" mainClassName="page-main reading-main">
    <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/about">{t("nav.primary.about")}</Link><span> / </span><span>{t("shared.breadcrumb")}</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">{t("shared.eyebrow")}</p><PageTitle>{t("shared.title")}</PageTitle><p>{t("shared.intro")}</p></SectionHeading>
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#workflow", label: t("shared.nav.workflow") }, { href: "#sharing-boundary", label: t("shared.nav.boundary") }, { href: "/explore", label: t("shared.nav.frontier") }]} />
    <ol className="reading-steps" id="workflow">{steps.map((step) => <li key={step.number}><span>{step.number}</span><div><SectionTitle>{t(step.titleKey)}</SectionTitle><p>{t(step.copyKey)}</p></div></li>)}</ol>
    <section className="sharing-boundary" id="sharing-boundary"><Surface as="article"><span>{t("shared.approved.title")}</span><p>{t("shared.approved.copy")}</p></Surface><Surface as="article"><span>{t("shared.private.title")}</span><p>{t("shared.private.copy")}</p></Surface></section>
    <div className="reading-actions"><ActionLink className="button button-primary" href="/explore">{t("shared.inspectFrontier")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/about/principles">{t("shared.readPrinciples")}</ActionLink></div>
  </SiteFrame>;
}
