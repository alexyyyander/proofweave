import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";

import { PageTitle, SectionTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { PageSectionNav } from "../../ui";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey } from "@/app/i18n/translate";

const openCatalogUrl = "https://github.com/alexyyyander/proofweave-open-catalog";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("catalog.metaTitle"), description: t("catalog.metaDescription") };
}

const gates: readonly { number: string; titleKey: TranslationKey; copyKey: TranslationKey; outputKey: TranslationKey }[] = [
  { number: "01", titleKey: "catalog.gate.identify.title", copyKey: "catalog.gate.identify.copy", outputKey: "catalog.gate.identify.output" },
  { number: "02", titleKey: "catalog.gate.priorWork.title", copyKey: "catalog.gate.priorWork.copy", outputKey: "catalog.gate.priorWork.output" },
  { number: "03", titleKey: "catalog.gate.freshness.title", copyKey: "catalog.gate.freshness.copy", outputKey: "catalog.gate.freshness.output" },
  { number: "04", titleKey: "catalog.gate.pin.title", copyKey: "catalog.gate.pin.copy", outputKey: "catalog.gate.pin.output" },
  { number: "05", titleKey: "catalog.gate.claims.title", copyKey: "catalog.gate.claims.copy", outputKey: "catalog.gate.claims.output" },
];

const states: readonly { titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { titleKey: "catalog.state.sourcePinned.title", copyKey: "catalog.state.sourcePinned.copy" },
  { titleKey: "catalog.state.frontierReviewed.title", copyKey: "catalog.state.frontierReviewed.copy" },
  { titleKey: "catalog.state.attested.title", copyKey: "catalog.state.attested.copy" },
];

export default async function CatalogStandardPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="about" activeHref="/about/catalog-standard" mainClassName="page-main reading-main catalog-reading-main">
    <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/about">{t("nav.primary.about")}</Link><span> / </span><span>{t("nav.item.catalogStandard")}</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">{t("catalog.eyebrow")}</p><PageTitle>{t("catalog.title")}</PageTitle><p>{t("catalog.intro")}</p></SectionHeading>
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#catalog-gates", label: t("catalog.nav.gates") }, { href: "#review-states", label: t("catalog.nav.states") }, { href: "#boundary", label: t("catalog.nav.boundary") }]} />
    <ol className="catalog-reading-gates" id="catalog-gates">{gates.map((gate) => <li key={gate.number}><span>{gate.number}</span><div><SectionTitle>{t(gate.titleKey)}</SectionTitle><p>{t(gate.copyKey)}</p></div><strong>{t(gate.outputKey)}</strong></li>)}</ol>
    <section className="catalog-state-ladder" id="review-states" aria-label={t("catalog.statesAria")}>{states.map((state, index) => <Fragment key={state.titleKey}><div><span>{t(state.titleKey)}</span><p>{t(state.copyKey)}</p></div>{index < states.length - 1 ? <b aria-hidden="true">→</b> : null}</Fragment>)}</section>
    <section className="reading-note" id="boundary"><div><p className="eyebrow">{t("catalog.boundaryEyebrow")}</p><SectionTitle>{t("catalog.boundaryTitle")}</SectionTitle></div><p>{t("catalog.boundaryBody")}</p></section>
    <div className="reading-actions"><a className="button button-primary" href={openCatalogUrl} rel="noreferrer" target="_blank">{t("catalog.openRepository")} <span>↗</span></a><ActionLink className="button button-secondary" href="/explore">{t("catalog.inspectLive")}</ActionLink></div>
  </SiteFrame>;
}
