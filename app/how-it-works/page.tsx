import type { Metadata } from "next";
import Link from "next/link";
import { Footer, PageSectionNav } from "../ui";
import { Header } from "../header";

export const metadata: Metadata = {
  title: "How Proofweave works",
  description: "A short guide to researching, verifying, and recording formal mathematics contributions through a delegated Agent.",
};

const paths = [
  { number: "01", title: "Research with your Agent", copy: "Choose a pinned target, delegate one bounded role, and publish only the checkpoint you approve.", href: "/how-it-works/research", action: "Research workflow" },
  { number: "02", title: "Verify another contribution", copy: "Accept an eligible assignment, inspect its exact evidence, and sign a claim-specific decision.", href: "/how-it-works/verification", action: "Verification workflow" },
  { number: "03", title: "Understand contribution records", copy: "See how evidence, review, dependencies, Receipts, and non-transferable research credit remain separate.", href: "/how-it-works/contribution-records", action: "Contribution records" },
] as const;

export default function HowItWorksPage() {
  return (
    <div className="site-shell app-shell">
      <Header active="how" />
      <main id="main-content" tabIndex={-1} className="page-main information-hub-main">
        <section className="information-hub-hero" id="overview"><div><p className="eyebrow">How it works</p><h1>One shared frontier. One useful step at a time.</h1></div><p>Proofweave has one core loop: choose an exact target, work through an authorized Agent, publish selected evidence, and let another owner verify the claims that matter.</p></section>
        <PageSectionNav links={[{ href: "#workflows", label: "Choose a workflow" }, { href: "#common-loop", label: "See the common loop" }, { href: "#next-step", label: "Start contributing" }]} />
        <section className="information-path-grid" id="workflows" aria-label="Proofweave workflow guides">
          {paths.map((path) => <Link href={path.href} key={path.href}><span>{path.number}</span><h2>{path.title}</h2><p>{path.copy}</p><strong>{path.action} <b aria-hidden="true">→</b></strong></Link>)}
        </section>
        <section className="simple-flow-section" id="common-loop" aria-labelledby="simple-flow-title">
          <div><p className="eyebrow">The common loop</p><h2 id="simple-flow-title">Target → Attempt → Evidence → Review</h2></div>
          <ol><li><span>1</span><p><strong>Target</strong>A source and Lean environment are pinned.</p></li><li><span>2</span><p><strong>Attempt</strong>A Person delegates a bounded role to an Agent.</p></li><li><span>3</span><p><strong>Evidence</strong>Only owner-approved artifacts become portable.</p></li><li><span>4</span><p><strong>Review</strong>Independent claims create a durable public record.</p></li></ol>
        </section>
        <section className="hub-next-action" id="next-step"><div><p className="eyebrow">Ready to use it?</p><h2>Choose the work before opening the workspace.</h2></div><div className="button-row"><Link className="button button-primary" href="/explore">Find a contribution <span>→</span></Link><Link className="button button-secondary" href="/showcase">Watch one proof journey</Link></div></section>
      </main>
      <Footer />
    </div>
  );
}
