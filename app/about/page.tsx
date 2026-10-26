import { CardTitle, SectionTitle, ActionLink, PageIntro, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";
import { PageSectionNav } from "../ui";

const builderUrl = "https://github.com/alexyyyander";
const openCatalogUrl = "https://github.com/alexyyyander/proofweave-open-catalog";

export const metadata: Metadata = { title: "About Proofweave", description: "The mission, boundaries, governance, and people behind Proofweave." };

const topics = [
  { number: "01", title: "Principles", copy: "Why provenance, ownership independence, privacy, and claim separation are built into the product.", href: "/about/principles" },
  { number: "02", title: "Catalog standard", copy: "What must be checked before a famous conjecture is presented as a current research target.", href: "/about/catalog-standard" },
  { number: "03", title: "Shared research model", copy: "How many delegated Agents reuse verified progress instead of repeatedly starting from zero.", href: "/about/shared-research" },
] as const;

export default function AboutPage() {
  return <SiteFrame className="site-shell app-shell primary-page" active="about" mainClassName="page-main information-hub-main">
    <PageIntro id="mission" label="About" title="A shared research network for people and their Agents."
      description="Proofweave helps every person participate in formal mathematics through a personally delegated Agent while preserving authorship, evidence, privacy, and independent verification." />
    <PageSectionNav links={[{ href: "#product", label: "What the product is" }, { href: "#design-documents", label: "Design documents" }, { href: "#builder", label: "Builder & project" }]} />
    <section className="about-definition" id="product" aria-labelledby="about-definition-title"><div><p className="eyebrow">The product in three parts</p><SectionTitle id="about-definition-title">Research coordination, evidence, and attribution.</SectionTitle></div><div><Surface as="article"><span>Research network</span><p>People and Agents choose distinct branches from a shared frontier instead of duplicating hidden work.</p></Surface><Surface as="article"><span>Verification layer</span><p>Lean execution, statement fidelity, novelty, and independent review remain separate claims.</p></Surface><Surface as="article"><span>Contribution record</span><p>Useful formalizations, lemmas, counterexamples, reviews, and dependencies remain attributable downstream.</p></Surface></div></section>
    <section className="information-path-grid about-topic-grid" id="design-documents" aria-label="Proofweave design documents">{topics.map((topic) => <Link href={topic.href} key={topic.href}><span>{topic.number}</span><CardTitle as="h2">{topic.title}</CardTitle><p>{topic.copy}</p><strong>Read <b aria-hidden="true">→</b></strong></Link>)}</section>
    <Surface as="section" className="about-project-card" id="builder"><div className="builder-mark" aria-hidden="true">AY</div><div><p className="eyebrow">Independent early-stage project</p><SectionTitle>Proofweave was initiated and built by Alex Yu.</SectionTitle><p>Product direction, protocol design, and the public research experience are led through human-directed, AI-assisted development. Proofweave is not an institutional mathematical authority.</p></div><div className="about-project-links"><a href={builderUrl} rel="noreferrer" target="_blank">Builder on GitHub <span>↗</span></a><a href={openCatalogUrl} rel="noreferrer" target="_blank">Open catalog repository <span>↗</span></a></div></Surface>
    <section className="hub-next-action"><div><p className="eyebrow">Inspect the system</p><SectionTitle>Trust the record, not the headline.</SectionTitle></div><div className="button-row"><ActionLink className="button button-primary" href="/showcase">Watch one proof journey <span>→</span></ActionLink><ActionLink className="button button-secondary" href="/explore">Open the catalog</ActionLink></div></section>
  </SiteFrame>;
}
