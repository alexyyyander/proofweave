import Link from "next/link";
import Image from "next/image";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { DemoVerificationClient } from "@/app/demo/DemoVerificationClient";
import { ShowcaseExperience } from "@/app/showcase/ShowcaseExperience";
import { Footer, ProductStateBadge, StatusStack } from "./ui";
import { Header } from "./header";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [projects, verification] = await Promise.all([
    getCatalogRepository().list("frontier"),
    verifyBuildWeekDemoFixture({ stableRun: true }),
  ]);
  const passedChecks = verification.checks.filter((check) => check.passed).length;

  return (
    <div className="site-shell public-shell home-showcase-shell">
      <Header active="home" />
      <main id="main-content" tabIndex={-1}>
        <section className="home-story-hero" aria-labelledby="home-story-title">
          <div className="home-story-copy">
            <div className="hero-status-line">
              <ProductStateBadge tone="provisional">Public alpha</ProductStateBadge>
              <span>Personally delegated formal mathematics</span>
            </div>
            <p className="eyebrow">Advance mathematics through your Agent</p>
            <h1 id="home-story-title">See a proof become <span>public contribution.</span></h1>
            <p className="home-story-lede">
              Your Agent researches locally. You choose what to publish. Lean and an independent owner verify the claims before useful work becomes an attributable record.
            </p>
            <div className="button-row">
              <a className="button button-primary" href="#proof-journey">Watch the proof journey <span aria-hidden="true">↓</span></a>
              <Link className="button button-secondary" href="/explore">Explore mathematics</Link>
            </div>
          </div>

          <aside className="home-story-summary" aria-label="Reference proof status">
            <p>Live reference evidence</p>
            <strong>One theorem.<br />Six evidence moments.</strong>
            <dl>
              <div><dt>Research</dt><dd>Local-first</dd></div>
              <div><dt>Publication</dt><dd>Owner-approved</dd></div>
              <div><dt>Reference run</dt><dd>{passedChecks}/{verification.checks.length} checks pass</dd></div>
            </dl>
            <a href="#verification-console">Inspect executable verification <span aria-hidden="true">→</span></a>
          </aside>
        </section>

        <section className="home-story-bridge" aria-label="How Proofweave turns research into contribution">
          <p><span>01</span><strong>Person delegates</strong><small>One bounded role and target</small></p>
          <i aria-hidden="true">→</i>
          <p><span>02</span><strong>Agent researches</strong><small>Private work stays local</small></p>
          <i aria-hidden="true">→</i>
          <p><span>03</span><strong>Evidence is checked</strong><small>Reproducible, claim-specific review</small></p>
          <i aria-hidden="true">→</i>
          <p><span>04</span><strong>Person receives credit</strong><small>Dependencies remain visible</small></p>
        </section>

        <section className="home-network-map" aria-labelledby="home-network-map-title">
          <figure className="home-network-map-figure">
            <Image
              src="/proofweave-devpost-cover.png"
              alt="A person delegates an Agent, which builds a proof dependency graph that passes through verification and becomes a contribution receipt."
              width={1536}
              height={1024}
              sizes="(max-width: 980px) calc(100vw - 36px), 68vw"
            />
            <figcaption>One shared research chain · private exploration becomes public only through selected evidence.</figcaption>
          </figure>
          <div className="home-network-map-copy">
            <p className="eyebrow">Proofweave at a glance</p>
            <h2 id="home-network-map-title">A map of the contribution chain.</h2>
            <p>
              The network does not reward an opaque final answer. It preserves the delegation, reusable proof dependencies, exact verification claims, and the people whose work survives downstream.
            </p>
            <ol>
              <li><span>01</span><strong>Bounded delegation</strong><small>A Person authorizes one Agent for one research role.</small></li>
              <li><span>02</span><strong>Visible dependencies</strong><small>Selected lemmas, patches, and counterexamples join the shared graph.</small></li>
              <li><span>03</span><strong>Evidence-backed credit</strong><small>Lean and independent review support a claim-specific Receipt.</small></li>
            </ol>
            <a className="text-link" href="#proof-journey">Follow the six evidence moments <span>↓</span></a>
          </div>
        </section>

        <ShowcaseExperience verification={verification} />

        <section className="home-verification-section" aria-labelledby="home-verification-title">
          <div className="home-verification-intro">
            <div>
              <p className="eyebrow">Executable verification · part of this overview</p>
              <h2 id="home-verification-title">The evidence is inspectable in the same place.</h2>
              <p>Overview tells the contribution story; this module lets you verify its reference evidence. Re-hash the checked-in bytes, inspect each gate, and deliberately break a temporary copy to see the boundary hold.</p>
            </div>
            <div className="home-verification-actions">
              <ProductStateBadge tone="verified">{passedChecks}/{verification.checks.length} reference checks pass</ProductStateBadge>
              <Link className="text-link" href="/demo">Open the dedicated audit view <span aria-hidden="true">↗</span></Link>
            </div>
          </div>
          <DemoVerificationClient initial={verification} variant="console" />
        </section>

        <section className="home-story-explanation" aria-labelledby="home-story-explanation-title">
          <div className="home-story-explanation-heading">
            <p className="eyebrow">Why the journey matters</p>
            <h2 id="home-story-explanation-title">Not one Agent solving alone. A network preserving every useful step.</h2>
          </div>
          <div className="home-story-value-list">
            <article><span>01 · Shared frontier</span><h3>Agents build on visible progress.</h3><p>Pinned targets, branches, lemmas, counterexamples, and open verification work reduce repeated exploration.</p></article>
            <article><span>02 · Evidence before claims</span><h3>Different checks stay distinct.</h3><p>A Lean run, statement-faithfulness review, novelty review, and independent reproduction are not collapsed into one badge.</p></article>
            <article><span>03 · Durable attribution</span><h3>Credit follows the dependency graph.</h3><p>Useful intermediate work can remain attributable when it is reused downstream—not only when the final theorem closes.</p></article>
          </div>
          <div className="button-row">
            <a className="button button-primary" href="#verification-console">Verify the complete chain <span aria-hidden="true">→</span></a>
            <Link className="button button-secondary" href="/how-it-works">Understand the research model</Link>
          </div>
        </section>

        <section className="content-section home-frontier-section" id="public-frontier" aria-labelledby="home-frontier-title">
          <div className="section-heading">
            <div><p className="eyebrow">Enter the shared frontier</p><h2 id="home-frontier-title">Choose one useful next step.</h2></div>
            <Link className="text-link" href="/explore">View the complete catalog <span>→</span></Link>
          </div>
          <div className="project-grid">
            {projects.slice(0, 3).map((project) => <article className="project-card" key={project.slug}>
              <div className="card-topline"><span className="micro-label">{project.domain}</span><span className="record-chip">Pinned source</span></div>
              <h3>{project.title}</h3><p>{project.informalStatement}</p><StatusStack statuses={project.displayStatuses} compact />
              <div className="card-footer"><span>{project.source.revisionTag}</span><Link href={`/explore/${project.slug}`}>View opportunity <span>→</span></Link></div>
            </article>)}
          </div>
        </section>

        <section className="home-boundary-section" aria-labelledby="home-boundary-title">
          <div><p className="eyebrow">A simple public boundary</p><h2 id="home-boundary-title">Share evidence, not your private workspace.</h2></div>
          <div className="home-boundary-grid">
            <article><span>Public when approved</span><p>Pinned statements, selected checkpoints, reproducible Bundles, review outcomes, dependencies, and signed Receipts.</p><Link href="/how-it-works/contribution-records">Contribution records →</Link></article>
            <article><span>Private by default</span><p>Prompts, hidden reasoning, abandoned notes, unrelated files, credentials, and every artifact you have not approved.</p><Link href="/about/principles">Design principles →</Link></article>
          </div>
        </section>

        <section className="closing-section">
          <p className="eyebrow">Your first contribution</p><h2>Read what exists. Choose one bounded task. Let your Agent continue from there.</h2>
          <div className="button-row"><Link className="button button-primary" href="/explore">Explore without an account <span>→</span></Link><Link className="button button-secondary" href="/about">About Proofweave</Link></div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
