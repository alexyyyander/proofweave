import type { Metadata } from "next";
import Link from "next/link";
import { Footer, PageSectionNav } from "../../ui";
import { Header } from "../../header";

const openCatalogUrl = "https://github.com/alexyyyander/proofweave-open-catalog";
export const metadata: Metadata = { title: "Proofweave catalog standard", description: "The provenance and freshness gates for public formal mathematics targets." };

const gates = [
  ["01", "Identify the mathematical object", "Name the canonical problem, origin, accepted variants, and exact informal statement. Similar names must not collapse different conjectures.", "Canonical name · variant · source"],
  ["02", "Map the work that came before", "Record the original source, best known results, solved cases, nearby counterexamples, and references contributors should read first.", "Prior-work map · milestone DAG"],
  ["03", "Check the frontier is current", "Attach an as-of date, searched primary sources, reviewer, and unresolved conflicts. A stale review remains visibly stale.", "Freshness date · review evidence"],
  ["04", "Pin the formal target", "Freeze the Lean declaration, source revision, toolchain, dependencies, hashes, and license; then review statement fidelity.", "Statement hash · Lean environment"],
  ["05", "Keep every claim separate", "Kernel acceptance, statement fidelity, literature novelty, independent review, and usefulness answer different questions.", "Claim-by-claim attestations"],
] as const;

export default function CatalogStandardPage() {
  return <div className="site-shell app-shell"><Header active="about" /><main id="main-content" tabIndex={-1} className="page-main reading-main catalog-reading-main">
    <div className="breadcrumb"><Link href="/about">About</Link><span> / </span><span>Catalog standard</span></div>
    <section className="reading-hero"><p className="eyebrow">Catalog standard</p><h1>Before a famous problem is presented as current.</h1><p>Uploading a Lean statement creates a source-pinned record. It does not establish that a problem is still open, canonically formulated, or updated with the newest result.</p></section>
    <PageSectionNav links={[{ href: "#catalog-gates", label: "Five catalog gates" }, { href: "#review-states", label: "Review states" }, { href: "#boundary", label: "Current boundary" }]} />
    <ol className="catalog-reading-gates" id="catalog-gates">{gates.map(([number, title, copy, output]) => <li key={number}><span>{number}</span><div><h2>{title}</h2><p>{copy}</p></div><strong>{output}</strong></li>)}</ol>
    <section className="catalog-state-ladder" id="review-states" aria-label="Catalog review states"><div><span>Source-pinned</span><p>Statement and environment are reproducible.</p></div><b aria-hidden="true">→</b><div><span>Frontier-reviewed</span><p>Prior work and status were checked as of a stated date.</p></div><b aria-hidden="true">→</b><div><span>Proofweave-attested</span><p>Specific formal and review claims carry independent evidence.</p></div></section>
    <section className="reading-note" id="boundary"><div><p className="eyebrow">Current boundary</p><h2>Source-pinned does not mean frontier-reviewed.</h2></div><p>Many records are source-pinned imports and explicitly remain frontier-unreviewed. Proofweave does not convert upstream labels into its own mathematical attestation.</p></section>
    <div className="reading-actions"><a className="button button-primary" href={openCatalogUrl} rel="noreferrer" target="_blank">Open catalog repository <span>↗</span></a><Link className="button button-secondary" href="/explore">Inspect live records</Link></div>
  </main><Footer /></div>;
}
