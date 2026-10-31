import { CardTitle, PageTitle, SectionTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../ui";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey } from "@/app/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("how.metaTitle"), description: t("how.metaDescription") };
}

const paths: readonly { number: string; titleKey: TranslationKey; copyKey: TranslationKey; actionKey: TranslationKey; href: string }[] = [
  { number: "01", titleKey: "how.path.research.title", copyKey: "how.path.research.copy", actionKey: "how.path.research.action", href: "/how-it-works/research" },
  { number: "02", titleKey: "how.path.verification.title", copyKey: "how.path.verification.copy", actionKey: "how.path.verification.action", href: "/how-it-works/verification" },
  { number: "03", titleKey: "how.path.records.title", copyKey: "how.path.records.copy", actionKey: "how.path.records.action", href: "/how-it-works/contribution-records" },
];

const loop: readonly { number: string; titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { number: "1", titleKey: "how.loop.target.title", copyKey: "how.loop.target.copy" },
  { number: "2", titleKey: "how.loop.attempt.title", copyKey: "how.loop.attempt.copy" },
  { number: "3", titleKey: "how.loop.evidence.title", copyKey: "how.loop.evidence.copy" },
  { number: "4", titleKey: "how.loop.review.title", copyKey: "how.loop.review.copy" },
];

export default async function HowItWorksPage() {
  const { t } = await getI18n();
  return (
    <SiteFrame className="site-shell app-shell" active="how" mainClassName="page-main information-hub-main">
        <SectionHeading as="section" className="information-hub-hero" id="overview"><div><p className="eyebrow">{t("how.eyebrow")}</p><PageTitle>{t("how.title")}</PageTitle></div><p>{t("how.intro")}</p></SectionHeading>
        <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#workflows", label: t("how.nav.workflows") }, { href: "#common-loop", label: t("how.nav.loop") }, { href: "#next-step", label: t("how.nav.start") }]} />
        <section className="information-path-grid" id="workflows" aria-label={t("how.workflowsAria")}>
          {paths.map((path) => <Link href={path.href} key={path.href}><span>{path.number}</span><CardTitle as="h2">{t(path.titleKey)}</CardTitle><p>{t(path.copyKey)}</p><strong>{t(path.actionKey)} <b aria-hidden="true">→</b></strong></Link>)}
        </section>
        <section className="simple-flow-section" id="common-loop" aria-labelledby="simple-flow-title">
          <div><p className="eyebrow">{t("how.loopEyebrow")}</p><SectionTitle id="simple-flow-title">{t("how.loopTitle")}</SectionTitle></div>
          <ol>{loop.map((item) => <li key={item.number}><span>{item.number}</span><p><strong>{t(item.titleKey)}</strong>{t(item.copyKey)}</p></li>)}</ol>
        </section>
        <section className="hub-next-action" id="next-step"><div><p className="eyebrow">{t("how.nextEyebrow")}</p><SectionTitle>{t("how.nextTitle")}</SectionTitle></div><div className="button-row"><ActionLink className="button button-primary" href="/explore">{t("how.findContribution")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/showcase">{t("how.watchJourney")}</ActionLink></div></section>
      </SiteFrame>
  );
}
