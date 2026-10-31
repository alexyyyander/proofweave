import { Suspense } from "react";
import { ContentLoading } from "@/app/components/ui/ContentLoading";
import { ResearchCard } from "@/app/components/research/ResearchCard";

import { CardTitle, SectionTitle, PageIntro, ActionLink, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { getContributionReceiptReader, type PublicContributionReceiptIndexItem } from "@/db/repositories/receipts";
import { getParticipantOperationState } from "@/db";
import type { Locale } from "@/app/i18n/config";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { researchCardCopy } from "@/app/lib/research-card-copy";
import { DemoVerificationClient } from "@/app/demo/DemoVerificationClient";
import { ShowcaseExperience } from "@/app/showcase/ShowcaseExperience";
import { ProductStateBadge } from "./ui";
import { getI18n } from "@/app/i18n/server";

import "./home.css";
import publicationSummary from "@/data/publications/openai-math-summary.json";
import { october26Milestones } from "./history/october26";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { t, locale } = await getI18n();
  const verification = await verifyBuildWeekDemoFixture({ stableRun: true, locale });
  const passedChecks = verification.checks.filter((check) => check.passed).length;
  const writesEnabled = getParticipantOperationState().writesEnabled;
  const latestReceipt = await latestPublishedReceipt();
  const verifyDoor = latestReceipt
    ? {
      href: `/receipt/${encodeURIComponent(latestReceipt.id)}#receipt-verification`,
      body: t("home.doors.verify.body"),
      action: t("home.doors.verify.action"),
      note: t("home.doors.verify.issuedNote", { date: formatIssuedAt(latestReceipt.issuedAt, locale) }),
    }
    : {
      href: "#verification-console",
      body: t("home.doors.verify.bodyDemo"),
      action: t("home.doors.verify.actionDemo"),
      note: t("home.doors.verify.checksNote", { passed: passedChecks, total: verification.checks.length }),
    };
  const startDoor = writesEnabled
    ? {
      href: "/workbench#research-launcher",
      body: t("home.doors.start.body"),
      action: t("home.doors.start.action"),
      note: t("home.doors.start.note"),
    }
    : {
      href: "/explore",
      body: t("home.doors.start.bodyPaused"),
      action: t("home.doors.start.actionPaused"),
      note: t("home.doors.start.notePaused"),
    };

  return (
    <SiteFrame className="site-shell public-shell home-showcase-shell primary-page" active="home">
        <PageIntro tone="navy" label={t("nav.primary.overview")} titleId="home-story-title"
          title={<>{t("home.hero.titleLead")}<span>{t("home.hero.titleAccent")}</span></>}
          description={t("home.hero.description")}
          meta={<><span>{t("home.hero.meta")}</span><ProductStateBadge tone="provisional">{t("home.hero.badge")}</ProductStateBadge></>}>
          <div className="home-doors">
            <a className="home-door" href={verifyDoor.href}>
              <span className="home-door__index" aria-hidden="true">01</span>
              <strong>{t("home.doors.verify.title")}</strong>
              <p>{verifyDoor.body}</p>
              <span className="home-door__action">{verifyDoor.action} <span aria-hidden="true">→</span></span>
              <span className="home-door__note">{verifyDoor.note}</span>
            </a>
            <a className="home-door" href={startDoor.href}>
              <span className="home-door__index" aria-hidden="true">02</span>
              <strong>{t("home.doors.start.title")}</strong>
              <p>{startDoor.body}</p>
              <span className="home-door__action">{startDoor.action} <span aria-hidden="true">→</span></span>
              <span className="home-door__note">{startDoor.note}</span>
            </a>
          </div>
        </PageIntro>

        <section className="home-publications-entry" aria-labelledby="home-publications-title">
          <div><p className="eyebrow">{t("home.publications.eyebrow")}</p><SectionTitle id="home-publications-title">{t("home.publications.title")}</SectionTitle><p>{t("home.publications.body", { manuscripts: publicationSummary.statistics.manuscripts, families: publicationSummary.statistics.families })}</p></div>
          <Link className="button button-primary" href="/publications">{t("home.publications.action")} <span aria-hidden="true">→</span></Link>
        </section>

        <section className="home-boundary-section home-math-section" id="latest-mathematics" aria-labelledby="latest-mathematics-title">
          <div><p className="eyebrow">{t("home.latest.eyebrow")}</p><SectionTitle id="latest-mathematics-title">{t("home.latest.title")}</SectionTitle><p>{t("home.latest.body")}</p><Link className="text-link" href="/history#timeline">{t("home.latest.action")} →</Link></div>
          <div className="home-boundary-grid">{october26Milestones.map((item) => <Surface as="article" key={item.number}>
            <CardTitle>{item.shortTitleKey ? t(item.shortTitleKey) : item.shortTitle}</CardTitle><span>{item.evidenceKey ? t(item.evidenceKey) : item.evidence}</span><p>{item.summaryKey ? t(item.summaryKey) : item.summary}</p>
            <a href={item.sources[0].href} target="_blank" rel="noreferrer">{t("home.latest.primarySource")} ↗</a>
          </Surface>)}</div>
        </section>

        <ShowcaseExperience verification={verification} />

        <section className="home-verification-section" aria-labelledby="home-verification-title">
          <div className="home-verification-intro">
            <div>
              <p className="eyebrow">{t("home.verification.eyebrow")}</p>
              <SectionTitle id="home-verification-title">{t("home.verification.title")}</SectionTitle>
              <p>{t("home.verification.body")}</p>
            </div>
            <div className="home-verification-actions">
              <ProductStateBadge tone="verified">{t("home.verification.badge", { passed: passedChecks, total: verification.checks.length })}</ProductStateBadge>
              <Link className="text-link" href="/demo">{t("home.verification.action")} <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
          <DemoVerificationClient initial={verification} variant="console" />
        </section>

        <section className="content-section home-frontier-section" id="public-frontier" aria-labelledby="home-frontier-title">
          <SectionHeading as="div" className="section-heading">
            <div><p className="eyebrow">{t("home.frontier.eyebrow")}</p><SectionTitle id="home-frontier-title">{t("home.frontier.title")}</SectionTitle></div>
            <Link className="text-link" href="/explore">{t("home.frontier.action")} <span>→</span></Link>
          </SectionHeading>
          <Suspense fallback={<ContentLoading label={t("home.frontier.loading")} />}><HomeFrontier /></Suspense>
        </section>

        <section className="home-boundary-section" aria-labelledby="home-boundary-title">
          <div><p className="eyebrow">{t("home.boundary.eyebrow")}</p><SectionTitle id="home-boundary-title">{t("home.boundary.title")}</SectionTitle></div>
          <div className="home-boundary-grid">
            <Surface as="article"><span>{t("home.boundary.public.title")}</span><p>{t("home.boundary.public.copy")}</p><Link href="/how-it-works/contribution-records">{t("home.boundary.public.action")} →</Link></Surface>
            <Surface as="article"><span>{t("home.boundary.private.title")}</span><p>{t("home.boundary.private.copy")}</p><Link href="/about/principles">{t("home.boundary.private.action")} →</Link></Surface>
          </div>
        </section>

        <section className="closing-section">
          <p className="eyebrow">{t("home.closing.eyebrow")}</p><SectionTitle>{t("home.closing.title")}</SectionTitle>
          <div className="button-row"><ActionLink className="button button-primary" href="/explore">{t("home.closing.explore")} <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/about">{t("home.closing.about")}</ActionLink></div>
        </section>
      </SiteFrame>
  );
}

async function HomeFrontier() {
  const { t } = await getI18n();
  const projects = await getCatalogRepository().list("frontier", 3);
  const copy = researchCardCopy(t);
  return <div className="project-grid">{projects.map((project) => <ResearchCard project={project} variant="summary" copy={copy} key={project.slug} />)}</div>;
}

/**
 * The verification door opens a real signed record when one is published. When
 * none is available, the door says so and falls back to the reference demo
 * rather than promising a record that does not exist.
 */
async function latestPublishedReceipt(): Promise<PublicContributionReceiptIndexItem | null> {
  try {
    const [latest] = await getContributionReceiptReader().listRecent(1);
    return latest ?? null;
  } catch {
    return null;
  }
}

function formatIssuedAt(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium" }).format(date);
}
