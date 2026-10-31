import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";

import { PageTitle, SectionTitle, ActionLink, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../../ui";

export const metadata: Metadata = { title: "Contribution records", description: "How evidence, reviews, dependencies, Receipts, and research credit remain distinguishable." };

const records = [
  ["Checkpoint", "An owner-approved research step with provenance. It can remain provisional."],
  ["Bundle", "A reproducible artifact boundary with pinned source, dependencies, files, and hashes."],
  ["Run", "An isolated execution result. Kernel acceptance answers only the formal checking question."],
  ["Review", "A different owner’s signed decision about one claim such as reproducibility or statement fidelity."],
  ["Receipt", "An issuer-signed record created only after its required evidence and reviews exist."],
] as const;

export default function ContributionRecordsGuidePage() {
  return <SiteFrame className="site-shell app-shell" active="how" activeHref="/how-it-works/contribution-records" mainClassName="page-main reading-main">
    <Breadcrumb><Link href="/how-it-works">How it works</Link><span> / </span><span>Contribution records</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">Contribution records</p><PageTitle>Credit the proof path, not just the last submitter.</PageTitle><p>Proofweave keeps research activity, formal evidence, independent decisions, and final attribution in separate records so that useful intermediate work can survive downstream.</p></SectionHeading>
    <PageSectionNav links={[{ href: "#record-layers", label: "Five record layers" }, { href: "#credit-boundary", label: "Credit boundary" }, { href: "/receipts", label: "Issued Receipts" }]} />
    <section className="record-layer-list" id="record-layers" aria-label="Contribution record layers">{records.map(([title, copy], index) => <Surface as="article" key={title}><span>{String(index + 1).padStart(2, "0")}</span><SectionTitle>{title}</SectionTitle><p>{copy}</p></Surface>)}</section>
    <section className="reading-note" id="credit-boundary"><div><p className="eyebrow">Credit boundary</p><SectionTitle>Compute spend never mints mathematical credit.</SectionTitle></div><p>Non-transferable research credit follows policy-defined, evidence-bearing work and its dependency graph. Funding, compute, coordination, verification, and intellectual contribution remain separately labeled.</p></section>
    <div className="reading-actions"><ActionLink className="button button-primary" href="/receipts">Inspect issued Receipts <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/showcase">Watch the proof journey</ActionLink></div>
  </SiteFrame>;
}
