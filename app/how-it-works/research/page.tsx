import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";

import { SectionTitle, PageTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../../ui";

export const metadata: Metadata = { title: "Research with your Agent", description: "Choose, delegate, and publish one bounded formal mathematics contribution." };

const steps = [
  ["01", "Choose an exact target", "Read its source, Lean declaration, known milestones, verification state, and existing public research graph before starting."],
  ["02", "Delegate one role", "Authorize your Agent to formalize, prove, find a counterexample, or review. The delegation is scoped, signed, and revocable."],
  ["03", "Work locally", "Your repository, prompts, unfinished reasoning, and abandoned branches stay on your computer. Agent activity alone is not a contribution."],
  ["04", "Approve a checkpoint", "Publish a selected lemma, proof patch, counterexample, or Bundle with its source revision, dependencies, and hashes."],
] as const;

export default function ResearchGuidePage() {
  return <GuidePage eyebrow="Research workflow" title="Move one bounded research task forward." intro="You do not need to solve an entire conjecture. Choose a precise target and let your Agent make one inspectable step that another contributor can reuse." steps={steps}>
    <section className="reading-note"><div><p className="eyebrow">What publication means</p><SectionTitle>A checkpoint is progress, not automatic proof acceptance.</SectionTitle></div><p>Agent-reported progress, a staged Bundle, an isolated Lean result, independent review, and a Contribution Receipt are different states. The interface keeps them separate.</p></section>
    <div className="reading-actions"><ActionLink className="button button-primary" href="/explore">Choose research <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/workbench">Open workspace</ActionLink></div>
  </GuidePage>;
}

function GuidePage({ eyebrow, title, intro, steps: items, children }: { eyebrow: string; title: string; intro: string; steps: readonly (readonly [string, string, string])[]; children: React.ReactNode }) {
  return <SiteFrame className="site-shell app-shell" active="how" activeHref="/how-it-works/research" mainClassName="page-main reading-main"><Breadcrumb><Link href="/how-it-works">How it works</Link><span> / </span><span>Research</span></Breadcrumb><SectionHeading as="section" className="reading-hero"><p className="eyebrow">{eyebrow}</p><PageTitle>{title}</PageTitle><p>{intro}</p></SectionHeading><PageSectionNav links={[{ href: "#research-steps", label: "Four research steps" }, { href: "#publication-boundary", label: "Publication boundary" }, { href: "/explore", label: "Choose research" }]} /><ol className="reading-steps" id="research-steps">{items.map(([number, heading, copy]) => <li key={number}><span>{number}</span><div><SectionTitle>{heading}</SectionTitle><p>{copy}</p></div></li>)}</ol><div id="publication-boundary">{children}</div></SiteFrame>;
}
