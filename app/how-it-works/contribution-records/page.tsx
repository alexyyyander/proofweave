import type { Metadata } from "next";
import Link from "next/link";
import { Footer, PageSectionNav } from "../../ui";
import { Header } from "../../header";

export const metadata: Metadata = { title: "Contribution records", description: "How evidence, reviews, dependencies, Receipts, and research credit remain distinguishable." };

const records = [
  ["Checkpoint", "An owner-approved research step with provenance. It can remain provisional."],
  ["Bundle", "A reproducible artifact boundary with pinned source, dependencies, files, and hashes."],
  ["Run", "An isolated execution result. Kernel acceptance answers only the formal checking question."],
  ["Review", "A different owner’s signed decision about one claim such as reproducibility or statement fidelity."],
  ["Receipt", "An issuer-signed record created only after its required evidence and reviews exist."],
] as const;

export default function ContributionRecordsGuidePage() {
  return <div className="site-shell app-shell"><Header active="how" /><main id="main-content" tabIndex={-1} className="page-main reading-main">
    <div className="breadcrumb"><Link href="/how-it-works">How it works</Link><span> / </span><span>Contribution records</span></div>
    <section className="reading-hero"><p className="eyebrow">Contribution records</p><h1>Credit the proof path, not just the last submitter.</h1><p>Proofweave keeps research activity, formal evidence, independent decisions, and final attribution in separate records so that useful intermediate work can survive downstream.</p></section>
    <PageSectionNav links={[{ href: "#record-layers", label: "Five record layers" }, { href: "#credit-boundary", label: "Credit boundary" }, { href: "/receipts", label: "Issued Receipts" }]} />
    <section className="record-layer-list" id="record-layers" aria-label="Contribution record layers">{records.map(([title, copy], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h2>{title}</h2><p>{copy}</p></article>)}</section>
    <section className="reading-note" id="credit-boundary"><div><p className="eyebrow">Credit boundary</p><h2>Compute spend never mints mathematical credit.</h2></div><p>Non-transferable research credit follows policy-defined, evidence-bearing work and its dependency graph. Funding, compute, coordination, verification, and intellectual contribution remain separately labeled.</p></section>
    <div className="reading-actions"><Link className="button button-primary" href="/receipts">Inspect issued Receipts <span>→</span></Link><Link className="button button-secondary" href="/showcase">Watch the proof journey</Link></div>
  </main><Footer /></div>;
}
