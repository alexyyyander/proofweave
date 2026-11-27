import { creditMarketBuckets } from "@/packages/protocol/credit-market.mjs";
import { CardTitle, PageIntro, SectionTitle } from "@/app/components/ui";
import { publishedTargetSponsorships } from "@/app/lib/target-sponsorship";
import { Suspense } from "react";
import Link from "next/link";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { ContentLoading } from "@/app/components/ui/ContentLoading";
import { HeroWeave } from "@/app/components/research/hero/HeroWeave";
import { PrivacyBoundary } from "@/app/components/research/PrivacyBoundary";
import { FrontierHomeCard } from "@/app/components/research/FrontierHomeCard";
import { getParticipantOperationState } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { getContributionReceiptReader } from "@/db/repositories/receipts";
import { getI18n } from "@/app/i18n/server";
import { pathForLocale } from "@/app/i18n/config";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { DemoVerificationClient } from "@/app/demo/DemoVerificationClient";
import { ShowcaseExperience } from "./showcase/ShowcaseExperience";
import { journeyEvidence } from "./showcase/journey-evidence";
import "./home.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { t, locale } = await getI18n();
  const { writesEnabled } = getParticipantOperationState();
  const reference = await verifyBuildWeekDemoFixture({ locale });
  const poolShares = Object.fromEntries(creditMarketBuckets.map(bucket => [bucket.key, bucket.basisPoints / 100]));
  const stages = [
    [t("home.research.kernel"), t("home.workflow.kernel")],
    [t("home.research.review"), t("home.workflow.review")],
    [t("home.research.receipt"), t("home.workflow.receipt")],
  ];
  return <SiteFrame active="home" className="site-shell public-shell research-home">
    <div className="rh-band">
      <div className="rh-wrap">
        <section className="rh-intro" aria-labelledby="home-story-title">
          <div className="rh-lead">
            <PageIntro tone="navy" titleId="home-story-title" label={t("home.hero.badge")}
              title={<>{t("home.research.lead")}<br/><em>{t("home.research.accent")}</em></>}
              description={t("home.research.intro")}>
              <div className="rh-actions">
                <Link className="rh-primary" href={pathForLocale("/explore", locale)}>{t(writesEnabled ? "home.research.start" : "home.doors.start.actionPaused")} <span aria-hidden="true">→</span></Link>
                <a className="rh-secondary" href="#verification-console">{t("home.research.example")} <span aria-hidden="true">↓</span></a>
              </div>
              {!writesEnabled && <p>{t("home.doors.start.notePaused")}</p>}
            </PageIntro>
          </div>
          <div className="rh-figure">
            <HeroWeave pauseLabel={t("home.weave.pause")} playLabel={t("home.weave.play")} />
            <details className="rh-flow">
              <summary>
                <span>{t("home.workflow.title")}</span>
                <span className="rh-flow-stages" aria-hidden="true">{stages.map(([stage]) => stage).join("  ·  ")}</span>
              </summary>
              <ol>{stages.map(([stage, description]) => <li key={stage}>
                <strong>{stage}</strong><p>{description}</p>
              </li>)}</ol>
              <div className="rh-flow-links"><a className="rh-link" href="#landau-siegel-case">{t("home.workflow.case")} ↓</a><a className="rh-link" href="#proof-journey">{t("showcase.title")} ↓</a></div>
            </details>
          </div>
        </section>
        <nav className="rh-library" aria-label={t("home.research.resources")}>
          <strong>{t("home.research.resources")}</strong>
          <Link href="/publications">{t("home.research.pubs")} →</Link>
          <Link href="/history#timeline">{t("home.research.history")} →</Link>
        </nav>
      </div>
    </div>
    <div className="rh-wrap">
      <DemoVerificationClient initial={reference} variant="home" />
      <section id="landau-siegel-case" className="rh-section rh-case" aria-labelledby="rh-case-title">
        <header className="rh-case-head">
          <div>
            <p className="rh-meta">{t("home.research.aside")}</p>
            <SectionTitle id="rh-case-title">{t("home.research.case")}</SectionTitle>
          </div>
          <time dateTime="2026-11-24">{t("home.research.asof")}</time>
        </header>
        <p className="rh-case-scope">{t("home.case.scope")}</p>
        <ol className="rh-case-stages">
          {([
            ["kernel", "passed", "✓"],
            ["review", "pending", "◷"],
            ["receipt", "unissued", "–"],
          ] as const).map(([stage, state, symbol]) => <li key={stage} className={state}>
            <CardTitle>{t(`home.research.${stage}`)}</CardTitle>
            <p className="rh-case-outcome"><span aria-hidden="true">{symbol}</span>{t(`home.research.${stage}Outcome`)}</p>
            <p className="rh-case-detail">{t(`home.research.${stage}Detail`)}</p>
          </li>)}
        </ol>
        <details className="rh-credit-rules">
          <summary>{t("home.credit.title")}</summary>
          <CardTitle id="credit-rules">{t("home.credit.receiptTitle")}</CardTitle>
          <p>{t("home.credit.receipt")}</p>
          <CardTitle>{t("home.credit.poolTitle")}</CardTitle>
          <p>{t("home.credit.pool", poolShares)}</p>
          <p>{t("home.credit.conditions")}</p>
        </details>
        <Link className="rh-link" href="/proof-evolution/landau-siegel#submission-record">{t("home.research.caseLink")} →</Link>
      </section>
      <Suspense fallback={null}><LatestReceiptLink /></Suspense>
      <section className="rh-section rh-frontier" id="public-frontier" aria-labelledby="rh-frontier-title">
        <div className="rh-section-head"><SectionTitle id="rh-frontier-title">{t("home.research.open")}</SectionTitle><Link className="rh-link" href={pathForLocale("/explore", locale)}>{t("home.frontier.action")} →</Link></div>
        <Suspense fallback={<ContentLoading label={t("home.frontier.loading")} />}><HomeFrontier writesEnabled={writesEnabled} /></Suspense>
        <div className="rh-sponsor-line">
          <div><strong>{t("sponsor.invite")}</strong><p>{t("sponsor.inviteNote")}</p></div>
          <Link className="rh-sponsor-link" href={pathForLocale("/sponsor", locale)}>{t("sponsor.title")} <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <PrivacyBoundary t={t} policyHref={pathForLocale("/privacy", locale) + "#workspace-boundary"} />
      <ShowcaseExperience nodes={journeyEvidence(reference)} />
    </div>
  </SiteFrame>;
}

async function LatestReceiptLink() {
  const { t, locale } = await getI18n();
  let receiptId: string | undefined;
  try {
    const [receipt] = await getContributionReceiptReader().listRecent(1);
    receiptId = receipt?.id;
  } catch {
    return null;
  }
  return receiptId && <Link className="rh-link" href={`${pathForLocale(`/receipt/${encodeURIComponent(receiptId)}`, locale)}#receipt-verification`}>{t("home.doors.verify.action")} →</Link>;
}

async function HomeFrontier({ writesEnabled }: { writesEnabled: boolean }) {
  const { t, locale } = await getI18n();
  const projects = await getCatalogRepository().list("frontier", 3).catch(() => null);
  if (!projects) return <p>{t("researchLauncher.state.catalog.title")}</p>;
  return <div className="project-grid">{projects.map(project =>
    <FrontierHomeCard key={project.slug} project={project} t={t} sponsors={publishedTargetSponsorships(project.id)}
      startHref={writesEnabled ? `${pathForLocale("/workbench", locale)}?target=${encodeURIComponent(project.slug)}#research-launcher` : undefined}
      recordHref={pathForLocale(`/explore/${encodeURIComponent(project.slug)}`, locale)} />)}</div>;
}
