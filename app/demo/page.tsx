import Link from "next/link";
import { Footer, PageSectionNav, ProductStateBadge } from "@/app/ui";
import { Header } from "@/app/header";
import { verifyBuildWeekDemoFixture } from "@/app/lib/build-week-demo";
import { latestLiveBuildWeekClosure } from "@/db/repositories/live-demo";
import { DemoVerificationClient } from "./DemoVerificationClient";

export const dynamic = "force-dynamic";

export default async function DemoPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const verification = await verifyBuildWeekDemoFixture({
    mode: params?.tamper === "artifact" ? "tampered_copy" : "reference",
    stableRun: true,
  });
  const liveClosure = await latestLiveBuildWeekClosure().catch(() => null);

  return (
    <div className="site-shell demo-shell">
      <Header active="demo" />
      <main id="main-content" tabIndex={-1}>
        <section className="demo-hero">
          <div className="demo-hero-copy">
            <p className="eyebrow">Verified reference · no Proofweave setup required</p>
            <h1>Watch one Lean proof become <span>verifiable evidence.</span></h1>
            <p className="hero-lede">A Person delegates a local Codex Agent. The Agent signs a reproducible Lean workspace. Two clearly labelled mock owners split the independent review gates, and Proofweave verifies every cryptographic boundary.</p>
            <div className="button-row">
              <a className="button button-primary" href="#demo-walkthrough">Run the walkthrough <span aria-hidden="true">↓</span></a>
              <Link className="button button-secondary" href="/start">Start with my Agent</Link>
            </div>
          </div>
          <ol className="demo-chain" aria-label="Reference contribution chain">
            <li><span>01</span><div><strong>Person delegates</strong><p>A signed certificate grants one Agent formalize and prove scope.</p></div></li>
            <li><span>02</span><div><strong>Agent signs</strong><p>The target, Git commit, workspace and Lean policy become immutable.</p></div></li>
            <li><span>03</span><div><strong>Lean checks</strong><p>Lean 4.30 accepts the theorem with no <code>sorry</code>.</p></div></li>
            <li><span>04</span><div><strong>Mock owners review</strong><p>Two simulated Persons own distinct real keys and split replay, kernel, and project claims.</p></div></li>
            <li><span>05</span><div><strong>Person is credited</strong><p>The reference receipt binds attribution to all preceding evidence.</p></div></li>
          </ol>
        </section>

        <section className="demo-boundary" aria-label="Demo boundary">
          <strong>What you are seeing</strong>
          <p>{verification.disclosure}</p>
          <ProductStateBadge tone="verified">Local fixture + 2 mock owners</ProductStateBadge>
        </section>

        <section className={`demo-live-record ${liveClosure ? "is-issued" : "is-pending"}`} id="live-network-record" aria-labelledby="demo-live-record-title">
          <div>
            <p className="eyebrow">Separate live protocol run</p>
            <h2 id="demo-live-record-title">{liveClosure ? "A real cloud replay produced an internal test Receipt." : "Live cloud closure has not been recorded yet."}</h2>
            <p>{liveClosure
              ? `The protocol run covers ${liveClosure.target}. Its ${liveClosure.reviewerCount} different-owner mock reviewer${liveClosure.reviewerCount === 1 ? " is" : "s are"} clearly labelled. The replay, ${liveClosure.attestationCount} Agent signatures, and issuer-signed Receipt remain auditable test evidence—not a public math contribution or Research Credit.`
              : "The interactive console below verifies a checked reference fixture. It does not claim that a hosted replay or network Receipt exists until this separate panel can resolve one from shared storage."}</p>
          </div>
          {liveClosure ? <div className="demo-live-record-proof">
            <dl>
              <div><dt>Replay</dt><dd><code>{shortHash(liveClosure.replayRunId)}</code></dd></div>
              <div><dt>Evidence</dt><dd><code>{shortHash(liveClosure.replayEvidenceHash)}</code></dd></div>
              <div><dt>Mock owners</dt><dd>{liveClosure.reviewerCount} distinct</dd></div>
              <div><dt>Receipt</dt><dd><code>{shortHash(liveClosure.receiptHash)}</code></dd></div>
            </dl>
            <a className="button button-primary" href="#verification-console">Inspect verification boundary <span aria-hidden="true">↓</span></a>
          </div> : <ProductStateBadge tone="provisional">Reference only</ProductStateBadge>}
        </section>

        <PageSectionNav
          tone="dark"
          label="Verified demo"
          links={[
            { href: "#demo-walkthrough", label: "Walkthrough" },
            { href: "#live-network-record", label: "Live record" },
            { href: "#verification-console", label: "Live verification" },
            { href: "#mathematical-payload", label: "Lean source" },
            { href: "#demo-boundaries", label: "Claim boundary" },
          ]}
        />

        <DemoVerificationClient initial={verification} />

        <section className="demo-proof-section" id="mathematical-payload">
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

        <section className="demo-honesty-grid" id="demo-boundaries">
          <article><span className="micro-label">This demo proves</span><h2>The evidence protocol is executable.</h2><p>Displayed bytes are re-hashed, four signature classes are checked, owner IDs remain distinct, and Receipt policy runs on every request.</p></article>
          <article><span className="micro-label">This demo does not claim</span><h2>The reviewers are not human participants.</h2><p>The review accounts are explicitly labelled mocks. They prove owner separation and cryptographic enforcement, not independent human judgment. Hosted replay and Receipt claims appear only in the live-network panel above.</p></article>
        </section>

        <section className="demo-reproduce" id="reproduce" aria-labelledby="demo-reproduce-title">
          <div>
            <p className="eyebrow">Optional audit path · developers and reviewers</p>
            <h2 id="demo-reproduce-title">Reproduce this reference proof locally.</h2>
            <p>Clone the repository to reconstruct the signed workspace, execute Lean, replay the review, and verify the reference Receipt. This does not connect your account, create an Attempt, or publish a contribution.</p>
          </div>
          <div className="demo-reproduce-command">
            <span>After installing Node 22+ and Lean 4.30</span>
            <code>npm run demo:e2e:check</code>
            <small>D1 inline · no R2 · temporary storage and keys · no network contribution</small>
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

function shortHash(value: string) {
  const normalized = value.replace(/^sha256:/, "");
  return normalized.length > 22 ? `${normalized.slice(0, 10)}…${normalized.slice(-8)}` : value;
}
