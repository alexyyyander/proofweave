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
import { getI18n } from "@/app/i18n/server";
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
  const { t } = await getI18n();
  const { number } = await params;
  const family = publicationFamily(number);
  return { title: family ? `OpenAI ${number}: ${family.title.replace(/<[^>]*>/g, "")}` : t("publicationDetail.notFound") };
}

export default async function PublicationFamilyPage({ params }: Params) {
  const { t, locale } = await getI18n();
  const { number } = await params;
  const family = publicationFamily(number);
  if (!family) notFound();
  const explanation = explanationForFamily(family.number, explanationArtifacts);
  const claims = lookupClaimsByFamily(claimsCollection, family.number);
  const adjacent = collection.families.indexOf(family);
  const previous = collection.families[adjacent - 1];
  const next = collection.families[adjacent + 1];
  const manuscriptCount = (count: number) => t(count === 1 ? "publicationDetail.status.manuscript.one" : "publicationDetail.status.manuscript.other", { count });
  return <div className="site-shell app-shell">
    <Header active="publications" />
    <main id="main-content" tabIndex={-1} className="page-main publications-main publication-detail-main">
      <div className="breadcrumb"><Link href="/publications">{t("nav.item.publications")}</Link><span> / </span><Link href={`/publications?subject=${encodeURIComponent(family.subject)}`}>{family.subject}</Link><span> / </span><span>OpenAI {family.number}</span></div>
      <section className="publication-detail-heading"><p className="eyebrow">{t("publicationDetail.eyebrow", { number: family.number })}</p><h1><MathText text={family.title} /></h1><p className="publication-detail-claim"><span className="publication-claim-label">{t("publications.card.claimLabel")}</span><MathText text={family.claim} /></p><div className="publication-detail-status"><span>{manuscriptCount(family.manuscripts.length)}</span><span>{family.scope ? t("publicationDetail.status.scopeDocumented") : t("publicationDetail.status.noScope")}</span><span>{t("publicationDetail.status.replayPending")}</span></div></section>
      <PageSectionNav label={t("publicationDetail.navAria")} links={[{ href: "#explanations", label: t("publicationDetail.nav.explanation") }, ...(claims ? [{ href: "#claims", label: t("publicationDetail.nav.claims") }] : []), { href: "#manuscripts", label: t("publicationDetail.nav.manuscripts") }, { href: "#formalization", label: t("publicationDetail.nav.formalization") }, { href: "#provenance", label: t("publicationDetail.nav.provenance") }]} />

      <section id="explanations" className="publication-explanations" aria-labelledby="explanations-title">
        <div className="publication-browse-heading"><div><p className="eyebrow">{t("publicationDetail.explanations.eyebrow")}</p><h2 id="explanations-title">{t("publicationDetail.explanations.title")}</h2></div>{explanation ? <div className="publication-explanations-heading-badges"><Badge tone="warning">{t("publicationDetail.explanations.draftBadge")}</Badge><span>{t("publicationDetail.explanations.draftNote")}</span></div> : <span>{t("publicationDetail.explanations.none")}</span>}</div>
        {explanation ? <div className="explanation-grid">
          <ClaimCard explanation={explanation} t={t} />
          <ScopeDiff explanation={explanation} family={family} t={t} locale={locale} renderText={(text) => <MathText text={text} />} />
          <ProofMap explanation={explanation} t={t} />
          <LeanCompanion explanation={explanation} t={t} />
        </div> : <EmptyState className="publication-explanations-empty"><strong>{t("publicationDetail.explanations.emptyTitle")}</strong><p>{t("publicationDetail.explanations.emptyBody")}</p></EmptyState>}
      </section>

      {claims && <section className="publication-formalization" id="claims" aria-labelledby="claims-title">
        <div className="publication-browse-heading"><div><p className="eyebrow">{t("publicationDetail.claims.eyebrow")}</p><h2 id="claims-title">{t("publicationDetail.claims.title")}</h2></div><span>{t("publicationDetail.claims.hint")}</span></div>
        <div className="publication-scope-prose">
          <p>{t(claims.claims.length === 1 ? "publicationDetail.claims.count.one" : "publicationDetail.claims.count.other", { count: claims.claims.length })}</p>
          {claims.claims.map((claim: { id: string; conclusion: string; coverage: { status: string; note: string }; verification: { status: string }; target: { status: string } }) => <div className="publication-paper-scope" key={claim.id}>
            <strong><MathText text={claim.conclusion} /></strong>
            <p>{claim.coverage.note}</p>
            <p><span className="publication-claim-label">{t("publicationDetail.claims.coverage")}</span> {claim.coverage.status} · <span className="publication-claim-label">{t("publicationDetail.claims.verification")}</span> {claim.verification.status} · <span className="publication-claim-label">{t("publicationDetail.claims.target")}</span> {claim.target.status}</p>
          </div>)}
        </div>
        <div className="publication-scope-links"><a className="text-link" href={`/api/publications/openai-math/${family.number}/claims`}>{t("publicationDetail.claims.openJson")} ↗</a></div>
      </section>}

      <section id="manuscripts" className="publication-manuscripts" aria-labelledby="manuscripts-title"><div className="publication-browse-heading"><div><p className="eyebrow">{t("publicationDetail.manuscripts.eyebrow")}</p><h2 id="manuscripts-title">{t("publicationDetail.manuscripts.title")}</h2></div><a href={`/api/publications/openai-math/${family.number}?download=1`} download={`proofweave-openai-math-${family.number}.json`}>{t("publicationDetail.manuscripts.download")} ↓</a></div>
        {family.manuscripts.map((paper, index) => <article className="publication-manuscript" key={paper.id} id={`manuscript-${index + 1}`}>
          <div className="publication-manuscript-top"><span>{t("publicationDetail.manuscript.number", { number: index + 1 })}</span><span>{paper.authors.join(", ")} · {paper.date}</span></div>
          <h3><MathText text={paper.title} /></h3>
          <div className="publication-manuscript-actions"><a className="button button-primary" href={paper.pdfUrl} target="_blank" rel="noreferrer">{t("publicationDetail.manuscript.read")} ↗</a><a className="button button-secondary" href={paper.downloadUrl} target="_blank" rel="noreferrer">{t("publicationDetail.manuscript.openPdf")} ↗</a><a href={paper.readmeUrl} target="_blank" rel="noreferrer">{t("publicationDetail.manuscript.notes")} ↗</a></div>
          <p className="publication-abstract"><span className="publication-claim-label">{t("publicationDetail.manuscript.abstract")}</span><MathText text={paper.abstract} /></p>
          <div className="publication-paper-scope"><strong>{t("publicationDetail.manuscript.evidence")}</strong><p>{paper.citedByScopeDocument ? t("publicationDetail.manuscript.citedByScope") : paper.listedInFormalizationIndex ? t("publicationDetail.manuscript.listedInIndex") : t("publicationDetail.manuscript.unknownCoverage")}</p></div>
          {paper.versionNote && <div className="publication-version-note"><strong>{t("publicationDetail.manuscript.versionNote")}</strong><p>{paper.versionNote}</p><div>{paper.versionLinks.map((link) => <a href={link.url} target="_blank" rel="noreferrer" key={link.url}>{link.label} ↗</a>)}</div></div>}
          <details className="publication-citation"><summary>{t("publicationDetail.manuscript.citation")}</summary><CitationCopyButton citation={paper.citation} /><pre><code>{paper.citation}</code></pre><p>{t("publicationDetail.manuscript.citationSnapshot", { revision: collection.source.revision.slice(0, 12) })}</p></details>
        </article>)}
      </section>

      <section className="publication-formalization" id="formalization" aria-labelledby="formalization-title">
        <div className="publication-browse-heading"><div><p className="eyebrow">{t("publicationDetail.formalization.eyebrow")}</p><h2 id="formalization-title">{t("publicationDetail.formalization.title")}</h2></div><span>{t("publicationDetail.formalization.hint")}</span></div>
        {family.scope ? <>
          <div className="publication-scope-prose"><span className="publication-claim-label">{t("publicationDetail.formalization.scopeLabel")}</span>{family.scope.text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}><MathText text={paragraph} /></p>)}</div>
          <div className="publication-scope-links"><a className="text-link" href={family.scope.url} target="_blank" rel="noreferrer">{t("publicationDetail.formalization.readScope")} ↗</a>{family.scope.comparatorLinks.map((link, index) => <a href={link.url} target="_blank" rel="noreferrer" key={`${link.url}-${index}`}>{link.label} ↗</a>)}</div>
        </> : <div className="publication-scope-prose"><p>{t("publicationDetail.formalization.noScope")}</p><a className="text-link" href={collection.source.contentsUrl} target="_blank" rel="noreferrer">{t("publicationDetail.formalization.inspectMap")} ↗</a></div>}
        <div className="publication-replay-note"><strong>{t("publicationDetail.formalization.replayTitle")}</strong><p>{t("publicationDetail.formalization.replayBody")}</p><Link href="/how-it-works/verification">{t("publicationDetail.formalization.replayLink")} →</Link></div>
      </section>

      <section id="provenance" className="publication-provenance" aria-labelledby="provenance-title"><div><p className="eyebrow">{t("publicationDetail.provenance.eyebrow")}</p><h2 id="provenance-title">{t("publicationDetail.provenance.title")}</h2><p>{t("publicationDetail.provenance.body")}</p><a className="text-link" href={collection.environment.instructionsUrl} target="_blank" rel="noreferrer">{t("publicationDetail.provenance.instructions")} ↗</a></div><dl><div><dt>{t("publicationDetail.provenance.repository")}</dt><dd><a href={collection.source.repository} target="_blank" rel="noreferrer">openai/math ↗</a></dd></div><div><dt>{t("publicationDetail.provenance.sourceRevision")}</dt><dd><code>{collection.source.revision}</code></dd></div><div><dt>{t("publicationDetail.provenance.leanToolchain")}</dt><dd><code>{collection.environment.lean}</code></dd></div><div><dt>{t("publicationDetail.provenance.mathlibRevision")}</dt><dd><code>{collection.environment.mathlib}</code></dd></div><div><dt>{t("publicationDetail.provenance.license")}</dt><dd><a href={collection.source.licenseUrl} target="_blank" rel="noreferrer">{collection.source.license} ↗</a></dd></div><div><dt>{t("publicationDetail.provenance.indexed")}</dt><dd>{collection.indexedAt.slice(0, 10)}</dd></div></dl></section>
      <nav className="publication-pagination" aria-label={t("publicationDetail.paginationAria")}>{previous ? <Link href={`/publications/openai-math/${previous.number}`}>← {t("publicationDetail.family", { number: previous.number })}</Link> : <span />}<Link href="/publications">{t("publicationDetail.back")}</Link>{next ? <Link href={`/publications/openai-math/${next.number}`}>{t("publicationDetail.family", { number: next.number })} →</Link> : <span />}</nav>
    </main><Footer />
  </div>;
}
