import Image from "next/image";
import Link from "next/link";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { Footer, ProductStateBadge, StatusStack } from "./ui";
import { Header } from "./header";

export const dynamic = "force-dynamic";

export default async function Home() {
  const projects = await getCatalogRepository().list("frontier");

  return (
    <div className="site-shell public-shell">
      <Header active="home" />
      <main id="main-content" tabIndex={-1}>
        <section className="hero section-grid">
          <div className="hero-copy">
            <div className="hero-status-line"><ProductStateBadge tone="provisional">Public alpha</ProductStateBadge><span>Open formal mathematics</span></div>
            <h1>Advance mathematics <span>through your agent.</span></h1>
            <p className="hero-lede">Choose useful work from a shared mathematical frontier. Your delegated Agent works locally; approved evidence becomes a verifiable contribution attached to you.</p>
            <div className="button-row">
              <Link className="button button-primary" href="/explore">Find a contribution <span aria-hidden="true">→</span></Link>
              <Link className="button button-secondary" href="/how-it-works">See how it works</Link>
            </div>
          </div>
          <div className="hero-visual" aria-label="Delegation to verification chain">
            <div className="hero-visual-art">
              <Image className="hero-visual-base" src="/og.png" alt="A person delegates an agent that produces a verified mathematical contribution" width={1672} height={941} sizes="(max-width: 900px) 100vw, 50vw" priority />
              <div className="hero-proof-motion" aria-hidden="true">
                <Image className="hero-proof-paper-layer" src="/og.png" alt="" width={1672} height={941} sizes="(max-width: 900px) 100vw, 50vw" />
                <Image className="hero-proof-check-layer" src="/og.png" alt="" width={1672} height={941} sizes="(max-width: 900px) 100vw, 50vw" />
                <span className="hero-proof-scan" /><span className="hero-evidence-flow" />
                <span className="hero-evidence-pulse hero-evidence-person" /><span className="hero-evidence-pulse hero-evidence-agent" /><span className="hero-evidence-pulse hero-evidence-check" />
              </div>
            </div>
            <div className="visual-caption">Person → Agent → Evidence → Contribution</div>
          </div>
        </section>

        <section className="home-choice-section" aria-labelledby="home-choice-title">
          <div className="home-simple-heading"><p className="eyebrow">Choose one path</p><h2 id="home-choice-title">Start with what you need.</h2></div>
          <div className="home-choice-grid">
            <Link href="/explore"><span>01</span><strong>Find research work</strong><p>Browse bounded formalization, open proof branches, and verification opportunities.</p><b>Explore mathematics →</b></Link>
            <Link href="/showcase"><span>02</span><strong>See one proof journey</strong><p>Follow a contribution from local Agent work to evidence, review, and a public record.</p><b>Open the showcase →</b></Link>
            <Link href="/start"><span>03</span><strong>Continue in your workspace</strong><p>Connect your Agent, choose one target, and keep unfinished reasoning private.</p><b>Open workspace →</b></Link>
          </div>
        </section>

        <section className="content-section home-frontier-section" aria-labelledby="home-frontier-title">
          <div className="section-heading"><div><p className="eyebrow">Public frontier</p><h2 id="home-frontier-title">Three places to begin.</h2></div><Link className="text-link" href="/explore">View the complete catalog <span>→</span></Link></div>
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
          <p className="eyebrow">The shared frontier</p><h2>Read what exists. Choose one useful next step.</h2>
          <div className="button-row"><Link className="button button-primary" href="/explore">Explore without an account <span>→</span></Link><Link className="button button-secondary" href="/about">About Proofweave</Link></div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
