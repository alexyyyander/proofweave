import Link from "next/link";
import { Footer, ProductStateBadge } from "@/app/ui";
import { Header } from "@/app/header";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { DemoVerificationClient } from "./DemoVerificationClient";

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const verification = await verifyBuildWeekDemoFixture({ stableRun: true });

  return (
    <div className="site-shell demo-shell">
      <Header active="demo" />
      <main id="main-content" tabIndex={-1}>
        <section className="demo-hero">
          <div className="demo-hero-copy">
            <p className="eyebrow">Verified reference · no Proofweave setup required</p>
            <h1>Watch one Lean proof become <span>verifiable evidence.</span></h1>
            <p className="hero-lede">A Person delegates a local Codex Agent. The Agent signs a reproducible Lean workspace. A clearly labeled mock second account performs the independent review, and Proofweave verifies every cryptographic boundary.</p>
            <div className="button-row">
              <a className="button button-primary" href="#demo-walkthrough">Run the walkthrough <span aria-hidden="true">↓</span></a>
              <Link className="button button-secondary" href="/start">Start with my Agent</Link>
            </div>
          </div>
          <ol className="demo-chain" aria-label="Reference contribution chain">
            <li><span>01</span><div><strong>Person delegates</strong><p>A signed certificate grants one Agent formalize and prove scope.</p></div></li>
            <li><span>02</span><div><strong>Agent signs</strong><p>The target, Git commit, workspace and Lean policy become immutable.</p></div></li>
            <li><span>03</span><div><strong>Lean checks</strong><p>Lean 4.30 accepts the theorem with no <code>sorry</code>.</p></div></li>
            <li><span>04</span><div><strong>Mock owner reviews</strong><p>A simulated second Person owns a distinct real review key and signs the replay claims.</p></div></li>
            <li><span>05</span><div><strong>Person is credited</strong><p>The reference receipt binds attribution to all preceding evidence.</p></div></li>
          </ol>
        </section>

        <section className="demo-boundary" aria-label="Demo boundary">
          <strong>What you are seeing</strong>
          <p>{verification.disclosure}</p>
          <ProductStateBadge tone="verified">Local fixture + mock reviewer</ProductStateBadge>
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
          <article><span className="micro-label">This demo proves</span><h2>The evidence protocol is executable.</h2><p>Displayed bytes are re-hashed, four signature classes are checked, owner IDs remain distinct, and Receipt policy runs on every request.</p></article>
          <article><span className="micro-label">This demo does not claim</span><h2>The reviewer is not a live participant.</h2><p>The second account is a deterministic mock and the Lean result is a checked local fixture. It demonstrates the exact production protocol without pretending public onboarding or hosted execution is complete.</p></article>
        </section>

        <section className="demo-reproduce" aria-labelledby="demo-reproduce-title">
          <div>
            <p className="eyebrow">Local end-to-end reproduction</p>
            <h2 id="demo-reproduce-title">Run Lean, replay it independently, and issue the Receipt.</h2>
            <p>This command creates a temporary D1-inline evidence store, reconstructs the signed workspace, executes Lean for the research Run and fresh review replay, checks different-owner attestations, and verifies the issued Receipt. No file or event is sent to Proofweave.</p>
          </div>
          <div className="demo-reproduce-command">
            <span>From the Proofweave repository</span>
            <code>npm run demo:e2e:check</code>
            <small>D1 inline · no R2 · temporary keys · no network contribution</small>
          </div>
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
