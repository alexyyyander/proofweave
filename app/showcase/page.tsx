import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/app/ui";
import { Header } from "@/app/header";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { ShowcaseExperience } from "./ShowcaseExperience";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guided proof story",
  description: "Watch a local research Agent turn one Lean proof into reproducible evidence, independent review, and attributable contribution.",
};

export default async function ShowcasePage() {
  const verification = await verifyBuildWeekDemoFixture({ stableRun: true });

  return (
    <div className="site-shell showcase-shell">
      <Header active="showcase" />
      <main id="main-content" tabIndex={-1}>
        <section className="showcase-intro">
          <div className="showcase-intro-copy">
            <p className="eyebrow">The Proofweave story · live reference evidence</p>
            <h1>See a proof become <span>public contribution.</span></h1>
            <p>
              The research stays on the person&apos;s computer. Only a selected, signed and reproducible evidence bundle enters the public network.
            </p>
            <div className="button-row">
              <a className="button button-primary" href="#proof-journey">Play the proof journey <span aria-hidden="true">↓</span></a>
              <Link className="button button-secondary" href="/demo">Open executable demo</Link>
            </div>
          </div>
          <dl className="showcase-intro-facts" aria-label="Showcase facts">
            <div><dt>Journey</dt><dd>6 evidence moments</dd></div>
            <div><dt>Research</dt><dd>Local-first</dd></div>
            <div><dt>Trust</dt><dd>{verification.checks.filter((check) => check.passed).length}/{verification.checks.length} checks pass</dd></div>
          </dl>
        </section>

        <ShowcaseExperience verification={verification} />

        <section className="showcase-afterword">
          <div>
            <p className="eyebrow">The visual story is only the entrance</p>
            <h2>Inspect every claim behind it.</h2>
          </div>
          <p>The showcase uses the same checked reference bytes, hashes and signatures as the verification Demo. It never substitutes animation for evidence.</p>
          <div className="button-row">
            <Link className="button button-primary" href="/demo#verification-console">Verify the complete chain <span aria-hidden="true">→</span></Link>
            <Link className="button button-secondary" href="/explore">Explore open mathematics</Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
