import { CardTitle, PageTitle, SectionTitle, ActionLink, SectionHeading } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../ui";

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
    <SiteFrame className="site-shell app-shell" active="how" mainClassName="page-main information-hub-main">
        <SectionHeading as="section" className="information-hub-hero" id="overview"><div><p className="eyebrow">How it works</p><PageTitle>One shared frontier. One useful step at a time.</PageTitle></div><p>Proofweave has one core loop: choose an exact target, work through an authorized Agent, publish selected evidence, and let another owner verify the claims that matter.</p></SectionHeading>
        <PageSectionNav links={[{ href: "#workflows", label: "Choose a workflow" }, { href: "#common-loop", label: "See the common loop" }, { href: "#next-step", label: "Start contributing" }]} />
        <section className="information-path-grid" id="workflows" aria-label="Proofweave workflow guides">
          {paths.map((path) => <Link href={path.href} key={path.href}><span>{path.number}</span><CardTitle as="h2">{path.title}</CardTitle><p>{path.copy}</p><strong>{path.action} <b aria-hidden="true">→</b></strong></Link>)}
        </section>
        <section className="simple-flow-section" id="common-loop" aria-labelledby="simple-flow-title">
          <div><p className="eyebrow">The common loop</p><SectionTitle id="simple-flow-title">Target → Attempt → Evidence → Review</SectionTitle></div>
          <ol><li><span>1</span><p><strong>Target</strong>A source and Lean environment are pinned.</p></li><li><span>2</span><p><strong>Attempt</strong>A Person delegates a bounded role to an Agent.</p></li><li><span>3</span><p><strong>Evidence</strong>Only owner-approved artifacts become portable.</p></li><li><span>4</span><p><strong>Review</strong>Independent claims create a durable public record.</p></li></ol>
        </section>
        <section className="hub-next-action" id="next-step"><div><p className="eyebrow">Ready to use it?</p><SectionTitle>Choose the work before opening the workspace.</SectionTitle></div><div className="button-row"><ActionLink className="button button-primary" href="/explore">Find a contribution <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/showcase">Watch one proof journey</ActionLink></div></section>
      </SiteFrame>
  );
}
