import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../header";
import { Footer } from "../ui";
import { openaiMathCollection as collection, type PublicationFamily } from "../lib/publications";
import { publicationBrowseHref, searchPublicationFamilies } from "@/packages/domain/publication-catalog.mjs";
import { MathText } from "./MathText";
import "./publications.css";
import "katex/dist/katex.min.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Mathematics publications",
  description: "Browse OpenAI's mathematics manuscripts by subject, result family, and formalization scope. Inspect sources, citations, and revisions.",
};

type Query = Record<string, string | string[] | undefined>;
const one = (value: Query[string]) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export default async function PublicationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const params = await searchParams;
  const result = searchPublicationFamilies(collection, {
    q: one(params.q), subject: one(params.subject), evidence: one(params.evidence), page: one(params.page),
  });
  const families = result.families as PublicationFamily[];
  const browseHref = (page: number) => publicationBrowseHref({ ...result, page });
  return <div className="site-shell app-shell">
    <Header active="publications" />
    <main id="main-content" tabIndex={-1} className="page-main publications-main">
      <div className="breadcrumb"><Link href="/explore">Research</Link><span> / </span><span>Publications</span></div>
      <section className="publications-hero">
        <div>
          <p className="eyebrow">Mathematics publications</p>
          <h1>Read the mathematics.<br /><span>Inspect the evidence.</span></h1>
          <p className="publications-lede">A source-linked library of mathematical results, manuscripts, and formal proofs. Start with a subject, read a result, and see exactly what its proof artifacts cover.</p>
          <p><Link href="/history#timeline">26 October updates: ETH, local smoothing, and Yang–Mills →</Link></p>
          <div className="publications-facts"><span><strong>{collection.statistics.manuscripts}</strong> manuscripts</span><span><strong>{collection.statistics.families}</strong> result families</span><span><strong>{collection.statistics.subjects}</strong> subjects</span></div>
        </div>
        <aside className="publication-collection-note">
          <span className="micro-label">First collection</span>
          <h2>OpenAI mathematics release</h2>
          <p>Released 6 October 2026; this catalog is the 13 October snapshot. Related papers stay together, with citations, revised editions, and formalization scope attached.</p>
          <div className="publication-source-status">Upstream results · Proofweave replay pending</div>
          <a className="text-link" href={collection.source.announcementUrl} target="_blank" rel="noreferrer">Read the release announcement ↗</a>
        </aside>
      </section>

      <nav className="publication-collection-bar" aria-label="Collection resources">
        <span>OpenAI · Indexed {collection.indexedAt.slice(0, 10)}</span>
        <div><a href="#collection-notes">Collection notes</a><a href="#withdrawals">{collection.withdrawals.length} withdrawals</a><a href="/api/publications/openai-math?download=1" download="proofweave-openai-math.json">Download catalog JSON ↓</a></div>
      </nav>

      <section aria-labelledby="publication-browse-title" className="publication-browser" id="browse">
        <div className="publication-browse-heading"><div><p className="eyebrow">Browse the collection</p><h2 id="publication-browse-title">Find a result to build on.</h2></div><span>Search titles, abstracts, subjects, or family numbers.</span></div>
        <form className="publication-filters" action="/publications" method="get">
          <label className="publication-search">Search<input type="search" name="q" defaultValue={result.query} maxLength={240} placeholder="Erdős, Ramsey, elliptic curves…" /></label>
          <label>Subject<select aria-label="Subject" name="subject" defaultValue={result.subject}><option value="">All {collection.statistics.subjects} subjects</option>{collection.subjects.map((subject) => <option key={subject.name} value={subject.name}>{subject.name} ({subject.families})</option>)}</select></label>
          <label>Evidence<select aria-label="Evidence" name="evidence" defaultValue={result.evidence}><option value="all">All results</option><option value="scope">With Lean scope notes</option><option value="no-scope">Scope notes not linked</option></select></label>
          <button className="button button-primary" type="submit">Search →</button>
        </form>
        <div className="publication-results-heading"><p><strong>{result.total}</strong> {result.total === 1 ? "result family" : "result families"} · {result.manuscriptCount} {result.manuscriptCount === 1 ? "manuscript" : "manuscripts"}{result.query ? <> matching “{result.query}”</> : null}</p>{result.query || result.subject || result.evidence !== "all" ? <Link href="/publications">Clear filters</Link> : <span>Ordered by upstream family number</span>}</div>
        {families.length ? <div className="publication-result-grid">{families.map((family) => <article className="publication-family-card" key={family.number}>
          <div className="publication-card-top"><span className="publication-family-number">{family.number}</span><span>{family.subject}</span></div>
          <h3><Link href={`/publications/openai-math/${family.number}`}><MathText text={family.title} /></Link></h3>
          <span className="publication-claim-label">Result described by OpenAI</span>
          <p className="publication-card-claim"><MathText text={family.claim} /></p>
          <div className="publication-card-evidence"><span>{family.manuscripts.length} {family.manuscripts.length === 1 ? "manuscript" : "manuscripts"}</span><span className={family.scope ? "publication-scope-badge" : "publication-scope-missing"}>{family.scope ? "Lean scope notes" : "Scope notes not linked"}</span></div>
          <Link className="publication-card-link" href={`/publications/openai-math/${family.number}`}>Read papers & evidence <span aria-hidden="true">→</span></Link>
        </article>)}</div> : <div className="publication-empty"><h3>No results match these filters.</h3><p>Try a shorter query, another subject, or all evidence types.</p><Link className="text-link" href="/publications">Browse the full collection →</Link></div>}
        {result.total > 0 && <nav className="publication-pagination" aria-label="Publication pages">
          {result.page > 1 ? <Link href={browseHref(result.page - 1)}>← Previous</Link> : <span aria-disabled="true">← Previous</span>}
          <span>Page <strong>{result.page}</strong> of {result.pageCount}</span>
          {result.page < result.pageCount ? <Link href={browseHref(result.page + 1)}>Next →</Link> : <span aria-disabled="true">Next →</span>}
        </nav>}
      </section>

      <section className="publication-notes-grid" id="collection-notes" aria-labelledby="collection-notes-title">
        <article><p className="eyebrow">Read the status with the result</p><h2 id="collection-notes-title">Evidence has a scope.</h2><p>OpenAI reports formalizations for {collection.statistics.upstreamReportedFormalizedResults} of {collection.statistics.manuscripts} top-line results. This index links {collection.statistics.scopeDocuments} family-level scope documents. A scope document identifies the papers and conclusions its formalization covers.</p><p>Proofweave has not replayed or independently reviewed this collection. Each paper retains its original attribution. Imported claims do not create a Proofweave contribution receipt.</p><a className="text-link" href={collection.source.historyUrl} target="_blank" rel="noreferrer">Inspect the release history ↗</a></article>
        <article><p className="eyebrow">Reusable by readers and Agents</p><h2>Keep the source within reach.</h2><p>Every source link is pinned to a repository revision. Download the catalog for structured titles, abstracts, citations, paper links, and coverage notes.</p><dl><div><dt>Source</dt><dd><a href={collection.source.repository} target="_blank" rel="noreferrer">openai/math ↗</a></dd></div><div><dt>Revision</dt><dd><code>{collection.source.revision.slice(0, 12)}</code></dd></div><div><dt>License</dt><dd><a href={collection.source.licenseUrl} target="_blank" rel="noreferrer">{collection.source.license} ↗</a></dd></div></dl><Link className="text-link" href="/explore">Find a research target →</Link></article>
      </section>
      <section className="publication-withdrawals" id="withdrawals" aria-labelledby="withdrawals-title">
        <div className="publication-browse-heading"><div><p className="eyebrow">Release corrections</p><h2 id="withdrawals-title">Withdrawn manuscripts</h2></div><span>Retained for provenance · excluded from the current catalog</span></div>
        <p>The release history records three withdrawals following a sign error in a stabilization-trace argument and its dependent constructions. Read each notice for the affected proof.</p>
        {collection.withdrawals.map((paper) => <a className="publication-withdrawal-row" href={paper.noticeUrl} key={paper.title} target="_blank" rel="noreferrer"><span className="publication-withdrawn-badge">Withdrawn</span><strong>{paper.title}</strong><span>{paper.date} · Read notice ↗</span></a>)}
      </section>
    </main><Footer />
  </div>;
}
