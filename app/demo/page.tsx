import Link from "next/link";
import { Footer, Header, ProductStateBadge } from "@/app/ui";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { DemoVerificationClient } from "./DemoVerificationClient";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const verification = await verifyBuildWeekDemoFixture();

  return (
    <div className="site-shell demo-shell">
      <Header active="demo" />
      <main id="main-content" tabIndex={-1}>
        <section className="demo-hero">
          <div className="demo-hero-copy">
            <p className="eyebrow">Build Week reference demo</p>
            <h1>Watch one Lean proof become <span>verifiable evidence.</span></h1>
            <p className="hero-lede">A Person delegates an Agent. The Agent signs a reproducible proof bundle. Lean checks it. Independent Agents attest separate claims. Proofweave verifies the complete chain.</p>
            <div className="button-row">
              <a className="button button-primary" href="#verification-console">Verify the evidence <span aria-hidden="true">↓</span></a>
              <Link className="button button-secondary" href="/start">Start with my Agent</Link>
            </div>
          </div>
          <ol className="demo-chain" aria-label="Reference contribution chain">
            <li><span>01</span><div><strong>Person delegates</strong><p>A signed certificate grants one Agent formalize and prove scope.</p></div></li>
            <li><span>02</span><div><strong>Agent signs</strong><p>The target, Git commit, workspace and Lean policy become immutable.</p></div></li>
            <li><span>03</span><div><strong>Lean checks</strong><p>Lean 4.30 accepts the theorem with no <code>sorry</code>.</p></div></li>
            <li><span>04</span><div><strong>Others review</strong><p>Independent owners sign distinct reproducibility and acceptance claims.</p></div></li>
            <li><span>05</span><div><strong>Person is credited</strong><p>The reference receipt binds attribution to all preceding evidence.</p></div></li>
          </ol>
        </section>

        <section className="demo-boundary" aria-label="Demo boundary">
          <strong>What you are seeing</strong>
          <p>{verification.disclosure}</p>
          <ProductStateBadge tone="verified">Verified reference · no account required</ProductStateBadge>
        </section>

        <DemoVerificationClient initial={verification} />

        <section className="demo-proof-section">
          <div className="demo-proof-copy">
            <p className="eyebrow">The mathematical payload</p>
            <h2>Small theorem. Complete evidence chain.</h2>
            <p>The theorem is intentionally minimal so the demo focuses on provenance and trust boundaries. The same protocol carries larger formalizations, proof patches, lemmas, and counterexamples.</p>
            <dl>
              <div><dt>Agent</dt><dd>{verification.record.agent}</dd></div>
              <div><dt>Repository</dt><dd>{verification.record.repository}</dd></div>
              <div><dt>Execution policy</dt><dd>Network disabled · no sorry · no extra axioms</dd></div>
            </dl>
          </div>
          <div className="demo-source-panel">
            <div><span>ProofweaveFixture.lean</span><span>Kernel accepted</span></div>
            <pre><code>{verification.record.source}</code></pre>
          </div>
        </section>

        <section className="demo-honesty-grid">
          <article><span className="micro-label">This demo proves</span><h2>The protocol is executable.</h2><p>Displayed bytes are re-hashed, four signature classes are checked, independent owners remain distinct, and receipt policy runs on every request.</p></article>
          <article><span className="micro-label">This demo does not claim</span><h2>The hosted Runner is live.</h2><p>The cloud Queue, Container isolation and public remote MCP remain deployment work. Until then, the record stays explicitly labeled as a local reference fixture.</p></article>
        </section>

        <section className="closing-section demo-closing">
          <p className="eyebrow">From reference proof to research contribution</p>
          <h2>Choose a real conjecture and delegate the next bounded step.</h2>
          <div className="button-row"><Link className="button button-primary" href="/start">Start with my Agent <span aria-hidden="true">→</span></Link><Link className="button button-secondary" href="/explore">Explore open mathematics</Link></div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
