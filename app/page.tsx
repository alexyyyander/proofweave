import { Suspense } from "react";
import Link from "next/link";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { ContentLoading } from "@/app/components/ui/ContentLoading";
import { ResearchCard } from "@/app/components/research/ResearchCard";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { getContributionReceiptReader } from "@/db/repositories/receipts";
import { getI18n } from "@/app/i18n/server";
import { researchCardCopy } from "@/app/lib/research-card-copy";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { DemoVerificationClient } from "@/app/demo/DemoVerificationClient";
import "./home.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { t, locale } = await getI18n();
  const reference = await verifyBuildWeekDemoFixture({ stableRun: true, locale });
  const [latestReceipt] = await getContributionReceiptReader().listRecent(1).catch(() => []);
  // A dated snapshot of the November 22 first-submission Bundle, checked on November 24.
  const caseSteps = [
    [t("home.research.kernel"), t("home.research.kernelOutcome"), t("home.research.kernelDetail")],
    [t("home.research.review"), t("home.research.reviewOutcome"), t("home.research.reviewDetail")],
    [t("home.research.receipt"), t("home.research.receiptOutcome"), t("home.research.receiptDetail")],
  ];
  return <SiteFrame active="home" className="site-shell public-shell research-home">
    <div className="rh-band">
      <div className="rh-wrap">
        <section className="rh-intro" aria-labelledby="home-story-title">
          <div className="rh-lead">
            <span className="rh-meta rh-alpha">{t("home.hero.badge")}</span>
            <h1 id="home-story-title">{t("home.research.lead")}<br/><em>{t("home.research.accent")}</em></h1>
            <p>{t("home.research.intro")}</p>
            <div className="rh-actions">
              <Link className="rh-primary" href="/explore">{t("home.research.start")} <span aria-hidden="true">→</span></Link>
              <a className="rh-secondary" href="#verification-console">{t("home.research.example")} <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <article className="rh-case" aria-labelledby="rh-case-title">
            <div className="rh-case-head"><span className="rh-meta">{t("home.research.aside")}</span><time dateTime="2026-11-24">{t("home.research.asof")}</time></div>
            <h2 id="rh-case-title">{t("home.research.case")}</h2>
            <ol>{caseSteps.map(([label, state, detail], i) => <li key={label}>
              <span className={i === 0 ? "rh-track done" : "rh-track"} aria-hidden="true">{i === 0 ? "✓" : ""}</span>
              <div><div className="rh-step"><strong>{label}</strong><span>{state}</span></div><p>{detail}</p></div>
            </li>)}</ol>
            <Link className="rh-link" href="/proof-evolution/landau-siegel">{t("home.research.caseLink")} →</Link>
          </article>
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
      {latestReceipt && <Link className="rh-link" href={`/receipt/${encodeURIComponent(latestReceipt.id)}#receipt-verification`}>{t("home.doors.verify.action")} →</Link>}
      <section className="rh-section" id="public-frontier">
        <div className="rh-section-head"><h2>{t("home.research.open")}</h2><Link className="rh-link" href="/explore">{t("home.frontier.action")} →</Link></div>
        <Suspense fallback={<ContentLoading label={t("home.frontier.loading")} />}><HomeFrontier /></Suspense>
      </section>
      <section className="rh-section rh-privacy"><h2>{t("home.research.privacy")}</h2>
        <ol>{[
          [t("home.research.local"), t("home.research.localNote")],
          [t("home.research.upload"), t("home.research.uploadNote")],
          [t("home.research.publish"), t("home.research.publishNote")],
        ].map(([label, detail]) => <li key={label}><strong>{label}</strong><p>{detail}</p></li>)}</ol>
      </section>
    </div>
  </SiteFrame>;
}

async function HomeFrontier() {
  const { t } = await getI18n();
  const projects = await getCatalogRepository().list("frontier", 3);
  const copy = researchCardCopy(t);
  return <div className="project-grid">{projects.map(project =>
    <ResearchCard key={project.slug} project={project} variant="summary" copy={copy} />)}</div>;
}
