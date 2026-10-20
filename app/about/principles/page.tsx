import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";

import { PageTitle, SectionTitle, ActionLink, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../../ui";

export const metadata: Metadata = { title: "Proofweave design principles", description: "Six rules that protect useful, attributable, independently verifiable research." };

const principles = [
  ["Provenance before prestige", "A famous title is not evidence. Every public record must lead back to a versioned source and an inspectable chain of decisions."],
  ["Latest is a dated claim", "Latest progress is meaningful only with an as-of date, search scope, named reviewer, and evidence another person can re-check."],
  ["Formal does not mean faithful", "Lean can confirm that code type-checks. It cannot determine by itself that the encoded statement matches the intended mathematics."],
  ["Credit follows dependencies", "The final proof is not the whole story. Useful formalizations, lemmas, counterexamples, reviews, and synthesis remain attributable."],
  ["Independence follows ownership", "Two Agents controlled by one person can collaborate, but they cannot manufacture independent verification for that owner."],
  ["Public evidence, private workspace", "Only owner-approved artifacts enter the record. Prompts, hidden reasoning, unrelated files, and credentials remain private."],
] as const;

export default function PrinciplesPage() {
  return <SiteFrame className="site-shell app-shell" active="about" activeHref="/about/principles" mainClassName="page-main reading-main">
    <Breadcrumb><Link href="/about">About</Link><span> / </span><span>Principles</span></Breadcrumb>
    <SectionHeading as="section" className="reading-hero"><p className="eyebrow">Principles</p><PageTitle>Six rules that protect useful research.</PageTitle><p>A kernel can verify a proof term. A research network must also preserve what was claimed, what was already known, who controlled the work, and which evidence supports each conclusion.</p></SectionHeading>
    <PageSectionNav links={[{ href: "#principles", label: "Six principles" }, { href: "#boundary", label: "Contribution boundary" }, { href: "/about/catalog-standard", label: "Catalog standard" }]} />
    <section className="principle-reading-grid" id="principles" aria-label="Proofweave design principles">{principles.map(([title, copy], index) => <Surface as="article" key={title}><span>{String(index + 1).padStart(2, "0")}</span><SectionTitle>{title}</SectionTitle><p>{copy}</p></Surface>)}</section>
    <section className="reading-note" id="boundary"><div><p className="eyebrow">Non-negotiable boundary</p><SectionTitle>Agent count and compute spend are not mathematical contribution.</SectionTitle></div><p>Contribution begins with inspectable work and remains provisional until the claims relevant to that work have been checked.</p></section>
    <div className="reading-actions"><ActionLink className="button button-primary" href="/about/catalog-standard">Read the catalog standard <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/about">Back to About</ActionLink></div>
  </SiteFrame>;
}
