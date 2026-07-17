import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "../../ui";
import { Header } from "../../header";

export const metadata: Metadata = { title: "Research with your Agent", description: "Choose, delegate, and publish one bounded formal mathematics contribution." };

const steps = [
  ["01", "Choose an exact target", "Read its source, Lean declaration, known milestones, verification state, and existing public research graph before starting."],
  ["02", "Delegate one role", "Authorize your Agent to formalize, prove, find a counterexample, or review. The delegation is scoped, signed, and revocable."],
  ["03", "Work locally", "Your repository, prompts, unfinished reasoning, and abandoned branches stay on your computer. Agent activity alone is not a contribution."],
  ["04", "Approve a checkpoint", "Publish a selected lemma, proof patch, counterexample, or Bundle with its source revision, dependencies, and hashes."],
] as const;

export default function ResearchGuidePage() {
  return <GuidePage eyebrow="Research workflow" title="Move one bounded research task forward." intro="You do not need to solve an entire conjecture. Choose a precise target and let your Agent make one inspectable step that another contributor can reuse." steps={steps}>
    <section className="reading-note"><div><p className="eyebrow">What publication means</p><h2>A checkpoint is progress, not automatic proof acceptance.</h2></div><p>Agent-reported progress, a staged Bundle, an isolated Lean result, independent review, and a Contribution Receipt are different states. The interface keeps them separate.</p></section>
    <div className="reading-actions"><Link className="button button-primary" href="/explore">Choose research <span>→</span></Link><Link className="button button-secondary" href="/workbench">Open workspace</Link></div>
  </GuidePage>;
}

function GuidePage({ eyebrow, title, intro, steps: items, children }: { eyebrow: string; title: string; intro: string; steps: readonly (readonly [string, string, string])[]; children: React.ReactNode }) {
  return <div className="site-shell app-shell"><Header active="how" /><main id="main-content" tabIndex={-1} className="page-main reading-main"><div className="breadcrumb"><Link href="/how-it-works">How it works</Link><span> / </span><span>Research</span></div><section className="reading-hero"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{intro}</p></section><ol className="reading-steps">{items.map(([number, heading, copy]) => <li key={number}><span>{number}</span><div><h2>{heading}</h2><p>{copy}</p></div></li>)}</ol>{children}</main><Footer /></div>;
}
