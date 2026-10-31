import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Header } from "@/app/header";
import { Footer, PageSectionNav } from "@/app/ui";
import { openaiMathCollection as collection, publicationFamily } from "@/app/lib/publications";
import claimsCollection from "@/data/publications/claims/openai-math-claims.json";
import { lookupClaimsByFamily } from "@/packages/domain/publication-claims.mjs";
import { ClaimCard, LeanCompanion, ProofMap, ScopeDiff, explanationForFamily, type ClaimExplanation } from "@/app/components/explanation";
import { Badge, EmptyState } from "@/app/components/ui";
import explanation032 from "@/data/publications/explanations/openai-math-032.json";
import explanation084 from "@/data/publications/explanations/openai-math-084.json";
import explanation159 from "@/data/publications/explanations/openai-math-159.json";
import { MathText } from "../../MathText";
import { CitationCopyButton } from "../../CitationCopyButton";
import "../../publications.css";
import "katex/dist/katex.min.css";

export const dynamic = "force-dynamic";
// Draft artifacts are loaded at the route surface; the shared component layer
// stays independent of publication data files.
const explanationArtifacts: Record<string, ClaimExplanation> = {
  "032": explanation032 as ClaimExplanation,
  "084": explanation084 as ClaimExplanation,
  "159": explanation159 as ClaimExplanation,
};
type Params = { params: Promise<{ number: string }> };
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { number } = await params;
  const family = publicationFamily(number);
  return { title: family ? `OpenAI ${number}: ${family.title.replace(/<[^>]*>/g, "")}` : "Publication not found" };
}

export default async function PublicationFamilyPage({ params }: Params) {
  const { number } = await params;
  const family = publicationFamily(number);
  if (!family) notFound();
  const explanation = explanationForFamily(family.number, explanationArtifacts);
  const claims = lookupClaimsByFamily(claimsCollection, family.number);
  const adjacent = collection.families.indexOf(family);
  const previous = collection.families[adjacent - 1];
  const next = collection.families[adjacent + 1];
  return <div className="site-shell app-shell">
    <Header active="publications" />
    <main id="main-content" tabIndex={-1} className="page-main publications-main publication-detail-main">
      <div className="breadcrumb"><Link href="/publications">Publications</Link><span> / </span><Link href={`/publications?subject=${encodeURIComponent(family.subject)}`}>{family.subject}</Link><span> / </span><span>OpenAI {family.number}</span></div>
      <section className="publication-detail-heading"><p className="eyebrow">OpenAI mathematics release · Result family {family.number}</p><h1><MathText text={family.title} /></h1><p className="publication-detail-claim"><span className="publication-claim-label">Result described by OpenAI</span><MathText text={family.claim} /></p><div className="publication-detail-status"><span>{family.manuscripts.length} {family.manuscripts.length === 1 ? "manuscript" : "manuscripts"}</span><span>{family.scope ? "Upstream Lean scope documented" : "Lean scope document not linked"}</span><span>Proofweave replay pending</span></div></section>
      <PageSectionNav label="Publication record" links={[{ href: "#explanations", label: "Explanation" }, ...(claims ? [{ href: "#claims", label: "Per-conclusion map" }] : []), { href: "#manuscripts", label: "Manuscripts & citations" }, { href: "#formalization", label: "Formalization scope" }, { href: "#provenance", label: "Source & environment" }]} />

      {(() => {
        const proofMapHref = family.number === "003" ? "/proof-evolution/landau-siegel" : `/proof-evolution/openai-math/${family.number}`;
        return <section className="publication-replay-note" aria-label="Proof map">
          <strong>Proof map</strong>
          <p>{family.number === "003"
            ? "This family has a 9-page OpenAI proof, a 3-page Barreto variant, and several intermediate simplifications. Compare the versions, what each one replaced, and the Lean coverage."
            : "See the recorded structure for this family: a deep argument map, a draft proof chain, or a source-linked metadata scaffold."}</p>
          <Link href={proofMapHref}>Open the proof map →</Link>
        </section>;
      })()}

      <section id="explanations" className="publication-explanations" aria-labelledby="explanations-title">
        <div className="publication-browse-heading"><div><p className="eyebrow">Read what is proved, and what is not</p><h2 id="explanations-title">Explanation</h2></div>{explanation ? <div className="publication-explanations-heading-badges"><Badge tone="warning">Draft · unreviewed</Badge><span>Model-drafted · no platform verification</span></div> : <span>No reviewed artifact</span>}</div>
        {explanation ? <div className="explanation-grid">
          <ClaimCard explanation={explanation} />
          <ScopeDiff explanation={explanation} family={family} renderText={(text) => <MathText text={text} />} />
          <ProofMap explanation={explanation} />
          <LeanCompanion explanation={explanation} />
        </div> : <EmptyState className="publication-explanations-empty"><strong lang="zh-CN">暂无经审阅的解释工件</strong><p>No reviewed explanation artifact is available for this family. This empty slot is not evidence that the result is unproven; it means no explanation draft has been prepared and reviewed for this snapshot.</p></EmptyState>}
      </section>

      {claims && <section className="publication-formalization" id="claims" aria-labelledby="claims-title">
        <div className="publication-browse-heading"><div><p className="eyebrow">Per-conclusion map · draft</p><h2 id="claims-title">Every conclusion, with its coverage and verification state</h2></div><span>Upstream mapping · not a replay</span></div>
        <div className="publication-scope-prose">
          <p><strong>{claims.claims.length}</strong> {claims.claims.length === 1 ? "conclusion is" : "conclusions are"} mapped from the pinned upstream snapshot. Coverage describes the upstream Lean scope; platform verification remains <strong>not run</strong> for every claim.</p>
          {claims.claims.map((claim: { id: string; conclusion: string; coverage: { status: string; note: string }; verification: { status: string }; target: { status: string } }) => <div className="publication-paper-scope" key={claim.id}>
            <strong><MathText text={claim.conclusion} /></strong>
            <p>{claim.coverage.note}</p>
            <p><span className="publication-claim-label">Coverage</span> {claim.coverage.status} · <span className="publication-claim-label">Verification</span> {claim.verification.status} · <span className="publication-claim-label">Target</span> {claim.target.status}</p>
          </div>)}
        </div>
        <div className="publication-scope-links"><a className="text-link" href={`/api/publications/openai-math/${family.number}/claims`}>Open machine-readable claims JSON ↗</a></div>
      </section>}

      <section id="manuscripts" className="publication-manuscripts" aria-labelledby="manuscripts-title"><div className="publication-browse-heading"><div><p className="eyebrow">Read the original work</p><h2 id="manuscripts-title">Manuscripts & citations</h2></div><a href={`/api/publications/openai-math/${family.number}?download=1`} download={`proofweave-openai-math-${family.number}.json`}>Download this record ↓</a></div>
        {family.manuscripts.map((paper, index) => <article className="publication-manuscript" key={paper.id} id={`manuscript-${index + 1}`}>
          <div className="publication-manuscript-top"><span>Manuscript {index + 1}</span><span>{paper.authors.join(", ")} · {paper.date}</span></div>
          <h3><MathText text={paper.title} /></h3>
          <div className="publication-manuscript-actions"><a className="button button-primary" href={paper.pdfUrl} target="_blank" rel="noreferrer">Read manuscript ↗</a><a className="button button-secondary" href={paper.downloadUrl} target="_blank" rel="noreferrer">Open PDF ↗</a><a href={paper.readmeUrl} target="_blank" rel="noreferrer">Source & version notes ↗</a></div>
          <p className="publication-abstract"><span className="publication-claim-label">Abstract from the source</span><MathText text={paper.abstract} /></p>
          <div className="publication-paper-scope"><strong>Formalization evidence</strong><p>{paper.citedByScopeDocument ? "This manuscript is named in the family’s scope document. Read the scope below for the exact conclusions covered." : paper.listedInFormalizationIndex ? "This manuscript is listed in the upstream formalization index. Check the source for the exact theorem coverage." : "The imported scope documents and formalization index do not identify this manuscript’s coverage. Other upstream proof artifacts may exist."}</p></div>
          {paper.versionNote && <div className="publication-version-note"><strong>Version note from OpenAI</strong><p>{paper.versionNote}</p><div>{paper.versionLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={link.url}>{link.label} ↗</a>)}</div></div>}
          <details className="publication-citation"><summary>BibTeX citation from OpenAI</summary><CitationCopyButton citation={paper.citation} /><pre><code>{paper.citation}</code></pre><p>Source snapshot: <code>{collection.source.revision.slice(0, 12)}</code>. The citation above retains OpenAI’s original wording.</p></details>
        </article>)}
      </section>

      <section className="publication-formalization" id="formalization" aria-labelledby="formalization-title">
        <div className="publication-browse-heading"><div><p className="eyebrow">Inspect what was formalized</p><h2 id="formalization-title">Lean proof scope</h2></div><span>Described by OpenAI · not replayed by Proofweave</span></div>
        {family.scope ? <>
          <div className="publication-scope-prose"><span className="publication-claim-label">Scope statement from the source</span>{family.scope.text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}><MathText text={paragraph} /></p>)}</div>
          <div className="publication-scope-links"><a className="text-link" href={family.scope.url} target="_blank" rel="noreferrer">Read complete scope document ↗</a>{family.scope.comparatorLinks.map((link, index) => <a href={link.url} target="_blank" rel="noreferrer" key={`${link.url}-${index}`}>{link.label} ↗</a>)}</div>
        </> : <div className="publication-scope-prose"><p>The upstream manuscript map does not link a scope document for this family. Proofweave has not established its formalization coverage.</p><a className="text-link" href={collection.source.contentsUrl} target="_blank" rel="noreferrer">Inspect the upstream manuscript map ↗</a></div>}
        <div className="publication-replay-note"><strong>Proofweave verification: pending</strong><p>These records describe upstream evidence. A platform replay, a review of the theorem’s meaning, and an independent review still need their own evidence.</p><Link href="/how-it-works/verification">How Proofweave verification works →</Link></div>
      </section>

      <section id="provenance" className="publication-provenance" aria-labelledby="provenance-title"><div><p className="eyebrow">Pinned source</p><h2 id="provenance-title">Source & environment</h2><p>The proofs share a large library. OpenAI recommends compiling selected portions at a time. Use the pinned environment and inspect the Comparator instructions before attempting a replay.</p><a className="text-link" href={collection.environment.instructionsUrl} target="_blank" rel="noreferrer">Upstream verification instructions ↗</a></div><dl><div><dt>Repository</dt><dd><a href={collection.source.repository} target="_blank" rel="noreferrer">openai/math ↗</a></dd></div><div><dt>Source revision</dt><dd><code>{collection.source.revision}</code></dd></div><div><dt>Lean toolchain</dt><dd><code>{collection.environment.lean}</code></dd></div><div><dt>Mathlib revision</dt><dd><code>{collection.environment.mathlib}</code></dd></div><div><dt>License</dt><dd><a href={collection.source.licenseUrl} target="_blank" rel="noreferrer">{collection.source.license} ↗</a></dd></div><div><dt>Indexed</dt><dd>{collection.indexedAt.slice(0, 10)}</dd></div></dl></section>
      <nav className="publication-pagination" aria-label="Adjacent result families">{previous ? <Link href={`/publications/openai-math/${previous.number}`}>← Family {previous.number}</Link> : <span />}<Link href="/publications">Back to publications</Link>{next ? <Link href={`/publications/openai-math/${next.number}`}>Family {next.number} →</Link> : <span />}</nav>
    </main><Footer />
  </div>;
}
