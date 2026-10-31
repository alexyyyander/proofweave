import type { Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../ui";
import { PageTitle, SectionTitle } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import "../introduction.css";

export const metadata: Metadata = {
  title: "How Proofweave works",
  description: "Research, independent verification and contribution records in one practical guide.",
};

export default function HowItWorksPage() {
  return <SiteFrame className="site-shell app-shell" active="how" mainClassName="page-main reading-main intro-main">
      <section className="reading-hero">
        <p className="eyebrow">How it works</p>
        <PageTitle>From a research target to a contribution record.</PageTitle>
        <p>Choose a bounded task, work through your local Agent, and publish evidence another owner can check.</p>
      </section>
      <PageSectionNav links={[{ href: "#research", label: "Research" }, { href: "#verification", label: "Verification" }, { href: "#contribution-records", label: "Contribution records" }]} />
      <section className="intro-section" id="research" aria-labelledby="research-title">
        <span className="intro-number">01 / Research</span>
        <div><SectionTitle id="research-title">Make one useful step with your Agent.</SectionTitle>
          <p>Choose a source-pinned target and inspect its prior work. Authorize one bounded, revocable Agent role, then work in your private Lean workspace.</p>
          <p>Approve the exact checkpoint or evidence Bundle to publish. Prompts, unfinished reasoning, unrelated files and credentials stay on your computer.</p>
          <Link className="text-link" href="/explore">Choose a research target <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <section className="intro-section" id="verification" aria-labelledby="verification-title">
        <span className="intro-number">02 / Verification</span>
        <div><SectionTitle id="verification-title">Check one exact claim, independently.</SectionTitle>
          <p>A different owner accepts an eligible assignment, inspects the exact Bundle and requests a fresh Lean replay when required. Reproducibility, kernel acceptance, statement fidelity and novelty are evaluated separately.</p>
          <p>The reviewer signs only the claim supported by evidence. A queued run, Agent report or successful Lean run does not by itself establish independent review.</p>
          <Link className="text-link" href="/reviews">Open the review queue <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <section className="intro-section" id="contribution-records" aria-labelledby="records-title">
        <span className="intro-number">03 / Contribution records</span>
        <div><SectionTitle id="records-title">Keep progress, evidence and credit distinct.</SectionTitle>
          <p>A signed checkpoint records progress. A Bundle pins selected source bytes. A Runner result records a replay. Independent attestations support named claims.</p>
          <p>Only after the required evidence and ownership checks close can the platform issue a signed Contribution Receipt. Research credit is non-transferable and follows useful dependencies; compute spend alone creates no credit.</p>
          <Link className="text-link" href="/receipts">Inspect contribution records <span aria-hidden="true">→</span></Link>
        </div>
      </section>
      <div className="reading-actions"><Link className="button button-primary" href="/explore">Find a contribution <span aria-hidden="true">→</span></Link><Link className="button button-secondary" href="/about">About the project</Link></div>
    </SiteFrame>;
}
