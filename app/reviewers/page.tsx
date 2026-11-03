import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, ActionLink, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { PageSectionNav } from "../ui";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";

import { type Metadata } from "next";
import Link from "next/link";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey } from "@/app/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("reviewers.metaTitle"), description: t("reviewers.metaDescription") };
}

const checks: readonly { titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { titleKey: "reviewers.check.repro.title", copyKey: "reviewers.check.repro.body" },
  { titleKey: "reviewers.check.fidelity.title", copyKey: "reviewers.check.fidelity.body" },
  { titleKey: "reviewers.check.novelty.title", copyKey: "reviewers.check.novelty.body" },
];

const steps: readonly { titleKey: TranslationKey; copyKey: TranslationKey }[] = [
  { titleKey: "reviewers.step.signIn.title", copyKey: "reviewers.step.signIn.body" },
  { titleKey: "reviewers.step.connect.title", copyKey: "reviewers.step.connect.body" },
  { titleKey: "reviewers.step.claim.title", copyKey: "reviewers.step.claim.body" },
  { titleKey: "reviewers.step.decide.title", copyKey: "reviewers.step.decide.body" },
];

export default async function ReviewersPage() {
  const { t } = await getI18n();
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main reading-main">
    <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/reviews">{t("reviewers.breadcrumb.queue")}</Link><span> / </span><span>{t("reviewers.breadcrumb.title")}</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero">
      <p className="eyebrow">{t("reviewers.eyebrow")}</p>
      <PageTitle>{t("reviewers.title")}</PageTitle>
      <p>{t("reviewers.body")}</p>
    </SectionHeading>
    <PageSectionNav label={t("common.onThisPage")} links={[{ href: "#checks", label: t("reviewers.nav.checks") }, { href: "#start", label: t("reviewers.nav.start") }, { href: "#limits", label: t("reviewers.nav.limits") }, { href: "/reviews", label: t("reviewers.nav.queue") }]} />

    <section className="principle-reading-grid" id="checks" aria-label={t("reviewers.checksAria")}>
      {checks.map((check, index) => <Surface as="article" key={check.titleKey}>
        <span>{String(index + 1).padStart(2, "0")}</span>
        <SectionTitle>{t(check.titleKey)}</SectionTitle>
        <p>{t(check.copyKey)}</p>
      </Surface>)}
    </section>

    <section className="reading-note" id="start">
      <div><p className="eyebrow">{t("reviewers.start.eyebrow")}</p><SectionTitle>{t("reviewers.start.title")}</SectionTitle></div>
      <div className="principle-reading-grid">
        {steps.map((step, index) => <Surface as="article" key={step.titleKey}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <SectionTitle>{t(step.titleKey)}</SectionTitle>
          <p>{t(step.copyKey)}</p>
        </Surface>)}
      </div>
    </section>

    <section className="reading-note" id="limits">
      <div><p className="eyebrow">{t("reviewers.limits.eyebrow")}</p><SectionTitle>{t("reviewers.limits.title")}</SectionTitle></div>
      <p>{t("reviewers.limits.capacity", { max: closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson })}</p>
      <p>{t("reviewers.limits.window")}</p>
    </section>

    <section className="reading-note"><div><p className="eyebrow">{t("reviewers.boundary.eyebrow")}</p><SectionTitle>{t("reviewers.boundary.title")}</SectionTitle></div><p>{t("reviewers.boundary.body")}</p></section>

    <div className="reading-actions">
      <ActionLink className="button button-primary" href="/reviews">{t("reviewers.action.queue")} <span aria-hidden="true">→</span></ActionLink>
      <ActionLink className="button button-secondary" href="/how-it-works#verification">{t("reviewers.action.how")}</ActionLink>
      <ActionLink className="button button-secondary" href="/workbench">{t("reviewers.action.connect")}</ActionLink>
    </div>
  </SiteFrame>;
}
