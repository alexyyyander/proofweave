import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/app/ui";
import { Header } from "@/app/header";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { latestLiveBuildWeekClosure } from "@/db/repositories/live-demo";
import { ShowcaseExperience } from "./ShowcaseExperience";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Proof journey",
  description: "Watch a local research Agent turn one Lean proof into reproducible evidence, independent review, and attributable contribution.",
};

export default async function ShowcasePage() {
  const verification = await verifyBuildWeekDemoFixture();
  const liveClosure = await latestLiveBuildWeekClosure().catch(() => null);

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
              <Link className="button button-secondary" href="/demo">Open the verification demo</Link>
            </div>
          </div>
          <dl className="showcase-intro-facts" aria-label="Showcase facts">
            <div><dt>Journey</dt><dd>6 evidence moments</dd></div>
            <div><dt>Research</dt><dd>Local-first</dd></div>
            <div><dt>Network</dt><dd>{liveClosure ? "Live Receipt issued" : `${verification.checks.filter((check) => check.passed).length}/${verification.checks.length} reference checks`}</dd></div>
          </dl>
        </section>

        <section className={`showcase-live-record ${liveClosure ? "is-issued" : "is-reference"}`} aria-labelledby="showcase-live-title">
          <div>
            <p className="eyebrow">Live control-plane record</p>
            <h2 id="showcase-live-title">{liveClosure ? "The cloud evidence chain has closed." : "The reference chain remains inspectable."}</h2>
            <p>{liveClosure
              ? `A fresh isolated Lean replay, three signed review gates across ${liveClosure.reviewerCount} mock owner${liveClosure.reviewerCount === 1 ? "" : "s"} different from the Attempt owner, and the issuer signature resolve to one public Contribution Receipt. The mock identities are explicit; their keys, replay, attestations, and Receipt are real records.`
              : "The animated journey below is backed by the checked reference fixture. A live Receipt appears here only after a fresh cloud replay and all required signed review gates exist in the shared evidence store."}</p>
          </div>
          {liveClosure ? <>
            <dl>
              <div><dt>Target</dt><dd>{liveClosure.target}</dd></div>
              <div><dt>Fresh replay</dt><dd><code>{shortHash(liveClosure.replayRunId)}</code></dd></div>
              <div><dt>Mock owners</dt><dd>{liveClosure.reviewerCount} distinct</dd></div>
              <div><dt>Review gates</dt><dd>{liveClosure.attestationCount} signed</dd></div>
              <div><dt>Receipt</dt><dd><code>{shortHash(liveClosure.receiptHash)}</code></dd></div>
            </dl>
            <Link className="button button-primary" href={`/receipt/${encodeURIComponent(liveClosure.receiptId)}`}>Open live Receipt <span aria-hidden="true">→</span></Link>
          </> : <Link className="button button-secondary" href="/demo#verification-console">Verify the reference fixture</Link>}
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

function shortHash(value: string) {
  const normalized = value.replace(/^sha256:/, "");
  return normalized.length > 22 ? `${normalized.slice(0, 10)}…${normalized.slice(-8)}` : value;
}
