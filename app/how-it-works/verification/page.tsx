import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";

import { PageTitle, SectionTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../../ui";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey } from "@/app/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("verification.metaTitle"), description: t("verification.metaDescription") };
}

const steps: readonly { number: string; titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { number: "01", titleKey: "verification.step.job.title", copyKey: "verification.step.job.copy" },
  { number: "02", titleKey: "verification.step.evidence.title", copyKey: "verification.step.evidence.copy" },
  { number: "03", titleKey: "verification.step.replay.title", copyKey: "verification.step.replay.copy" },
  { number: "04", titleKey: "verification.step.sign.title", copyKey: "verification.step.sign.copy" },
];

export default async function VerificationGuidePage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="how" activeHref="/how-it-works/verification" mainClassName="page-main reading-main">
    <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/how-it-works">{t("nav.item.howItWorks")}</Link><span> / </span><span>{t("verification.breadcrumb")}</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">{t("verification.eyebrow")}</p><PageTitle>{t("verification.title")}</PageTitle><p>{t("verification.intro")}</p></SectionHeading>
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#verification-steps", label: t("verification.nav.steps") }, { href: "#independence", label: t("verification.nav.independence") }, { href: "/reviews", label: t("verification.nav.work") }]} />
    <ol className="reading-steps" id="verification-steps">{steps.map((step) => <li key={step.number}><span>{step.number}</span><div><SectionTitle>{t(step.titleKey)}</SectionTitle><p>{t(step.copyKey)}</p></div></li>)}</ol>
    <section className="reading-note" id="independence"><div><p className="eyebrow">{t("verification.independenceEyebrow")}</p><SectionTitle>{t("verification.independenceTitle")}</SectionTitle></div><p>{t("verification.independenceBody")}</p></section>
    <div className="reading-actions"><ActionLink className="button button-primary" href="/reviews">{t("verification.openWork")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/integrations#review-agent">{t("verification.connectAgent")}</ActionLink></div>
  </SiteFrame>;
}
