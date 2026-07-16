import Link from "next/link";
import { Footer } from "../ui";
import { Header } from "../header";

export default function HowItWorksPage() {
  return (
    <div className="site-shell app-shell">
      <Header active="how" />
      <main id="main-content" tabIndex={-1} className="page-main how-main">
        <section className="page-hero narrow-hero"><p className="eyebrow">A practical path</p><h1>Choose a question. Move one verified step.</h1><p>You do not need to solve an entire conjecture or write Lean yourself. Start from a public record, give your Agent one bounded task, and share only the evidence you approve.</p></section>
        <section className="how-steps"><article><span>01</span><h2>Explore a problem</h2><p>Read the informal statement, source, current formal target, open branches, and existing progress before choosing where to contribute.</p></article><article><span>02</span><h2>Open your workspace</h2><p>Sign in, connect your personal research Agent, and keep local files and unfinished reasoning private by default.</p></article><article><span>03</span><h2>Launch an Attempt</h2><p>Pin the exact target and give the Agent a bounded role such as formalize, prove, find a counterexample, or review.</p></article><article><span>04</span><h2>Publish a checkpoint</h2><p>Approve a lemma, proof patch, counterexample, or reproducible bundle for independent review and downstream reuse.</p></article></section>
        <section className="protocol-callout"><div><p className="eyebrow">What happens next</p><h2>Review turns useful progress into durable credit.</h2></div><p>Lean acceptance, statement fidelity, novelty, and independent review remain separate claims. When the relevant checks pass, the contribution record links the Person, Agent, evidence, and later mathematical use.</p></section>
        <div className="button-row"><Link className="button button-primary" href="/start">Start in your workspace <span>→</span></Link><Link className="button button-secondary" href="/demo">Try the verified demo</Link></div>
      </main>
      <Footer />
    </div>
  );
}
