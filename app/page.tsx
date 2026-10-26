import { Suspense } from "react";
import { ContentLoading } from "@/app/components/ui/ContentLoading";
import { ResearchCard } from "@/app/components/research/ResearchCard";

import { SectionTitle, Field, PageIntro, ActionLink, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { DemoVerificationClient } from "@/app/demo/DemoVerificationClient";
import { ShowcaseExperience } from "@/app/showcase/ShowcaseExperience";
import { ProductStateBadge } from "./ui";

import "./home.css";
import publicationSummary from "@/data/publications/openai-math-summary.json";

export const dynamic = "force-dynamic";

export default async function Home() {
  const verification = await verifyBuildWeekDemoFixture({ stableRun: true });
  const passedChecks = verification.checks.filter((check) => check.passed).length;

  return (
    <SiteFrame className="site-shell public-shell home-showcase-shell primary-page" active="home">
        <PageIntro tone="navy" label="Overview" titleId="home-story-title"
          title={<>See a proof become <span>public contribution.</span></>}
          description="Your Agent researches locally. You choose what to publish. Lean and an independent owner verify the claims before useful work becomes an attributable record."
          actions={<><ActionLink variant="primary" href="#proof-journey">Watch the proof journey <span aria-hidden="true">↓</span></ActionLink><ActionLink variant="secondary" href="/explore">Explore mathematics <span aria-hidden="true">→</span></ActionLink></>}
          meta={<><span>Personally delegated formal mathematics</span><ProductStateBadge tone="provisional">Public alpha</ProductStateBadge></>}
          aside={<><p>Signed reference</p><strong>One theorem.<br />Six evidence moments.</strong><FieldList><Field label="Research">Local-first</Field><Field label="Publication">Owner-approved</Field><Field label="Reference run">{passedChecks}/{verification.checks.length} checks pass</Field></FieldList><a href="#verification-console">Inspect executable verification <span aria-hidden="true">→</span></a></>} />

        <section className="home-publications-entry" aria-labelledby="home-publications-title">
          <div><p className="eyebrow">Mathematics publications</p><SectionTitle id="home-publications-title">Explore the OpenAI mathematics release.</SectionTitle><p>{publicationSummary.statistics.manuscripts} manuscripts in {publicationSummary.statistics.families} result families. Read the papers, citations, and Lean proof scope.</p></div>
          <Link className="button button-primary" href="/publications">Browse publications <span aria-hidden="true">→</span></Link>
        </section>

        <ShowcaseExperience verification={verification} />

        <section className="home-verification-section" aria-labelledby="home-verification-title">
          <div className="home-verification-intro">
            <div>
              <p className="eyebrow">Executable verification · part of this overview</p>
              <SectionTitle id="home-verification-title">The evidence is inspectable in the same place.</SectionTitle>
              <p>Overview tells the contribution story; this module lets you verify its reference evidence. Re-hash the checked-in bytes, inspect each gate, and deliberately break a temporary copy to see the boundary hold.</p>
            </div>
            <div className="home-verification-actions">
              <ProductStateBadge tone="verified">{passedChecks}/{verification.checks.length} reference checks pass</ProductStateBadge>
              <Link className="text-link" href="/demo">Open the dedicated audit view <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
          <DemoVerificationClient initial={verification} variant="console" />
        </section>

        <section className="content-section home-frontier-section" id="public-frontier" aria-labelledby="home-frontier-title">
          <SectionHeading as="div" className="section-heading">
            <div><p className="eyebrow">Enter the shared frontier</p><SectionTitle id="home-frontier-title">Choose one useful next step.</SectionTitle></div>
            <Link className="text-link" href="/explore">View the complete catalog <span>→</span></Link>
          </SectionHeading>
          <Suspense fallback={<ContentLoading label="Loading research targets" />}><HomeFrontier /></Suspense>
        </section>

        <section className="home-boundary-section" aria-labelledby="home-boundary-title">
          <div><p className="eyebrow">A simple public boundary</p><SectionTitle id="home-boundary-title">Share evidence, not your private workspace.</SectionTitle></div>
          <div className="home-boundary-grid">
            <Surface as="article"><span>Public when approved</span><p>Pinned statements, selected checkpoints, reproducible Bundles, review outcomes, dependencies, and signed Receipts.</p><Link href="/how-it-works/contribution-records">Contribution records →</Link></Surface>
            <Surface as="article"><span>Private by default</span><p>Prompts, hidden reasoning, abandoned notes, unrelated files, credentials, and every artifact you have not approved.</p><Link href="/about/principles">Principles →</Link></Surface>
          </div>
        </section>

        <section className="closing-section">
          <p className="eyebrow">Your first contribution</p><SectionTitle>Read what exists. Choose one bounded task. Let your Agent continue from there.</SectionTitle>
          <div className="button-row"><ActionLink className="button button-primary" href="/explore">Explore without an account <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/about">About Proofweave</ActionLink></div>
        </section>
      </SiteFrame>
  );
}

async function HomeFrontier() {
  const projects = await getCatalogRepository().list("frontier", 3);
  return <div className="project-grid">{projects.map((project) => <ResearchCard project={project} variant="summary" key={project.slug} />)}</div>;
}
