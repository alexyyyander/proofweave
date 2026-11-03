import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../header";
import { Footer } from "../ui";
import { openaiMathCollection as collection, type PublicationFamily } from "../lib/publications";
import { publicationBrowseHref, searchPublicationFamilies } from "@/packages/domain/publication-catalog.mjs";
import { MathText } from "./MathText";
import { getI18n } from "@/app/i18n/server";
import "./publications.css";
import "katex/dist/katex.min.css";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("publications.metaTitle"), description: t("publications.metaDescription") };
}

type Query = Record<string, string | string[] | undefined>;
const one = (value: Query[string]) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export default async function PublicationsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const { t } = await getI18n();
  const params = await searchParams;
  const result = searchPublicationFamilies(collection, {
    q: one(params.q), subject: one(params.subject), evidence: one(params.evidence), page: one(params.page),
  });
  const families = result.families as PublicationFamily[];
  const browseHref = (page: number) => publicationBrowseHref({ ...result, page });
  const manuscriptCount = (count: number) => t(count === 1 ? "publications.results.manuscript.one" : "publications.results.manuscript.other", { count });
  return <div className="site-shell app-shell">
    <Header active="publications" />
    <main id="main-content" tabIndex={-1} className="page-main publications-main">
      <div className="breadcrumb"><Link href="/explore">{t("nav.primary.research")}</Link><span> / </span><span>{t("nav.item.publications")}</span></div>
      <section className="publications-hero">
        <div>
          <p className="eyebrow">{t("publications.hero.eyebrow")}</p>
          <h1>{t("publications.hero.titleLead")}<br /><span>{t("publications.hero.titleAccent")}</span></h1>
          <p className="publications-lede">{t("publications.hero.lede")}</p>
          <p><Link href="/history#timeline">{t("publications.hero.updates")} →</Link></p>
          <div className="publications-facts"><span><strong>{collection.statistics.manuscripts}</strong> {t("publications.fact.manuscripts", { count: collection.statistics.manuscripts }).replace(/^\d+\s*/, "")}</span><span><strong>{collection.statistics.families}</strong> {t("publications.fact.families", { count: collection.statistics.families }).replace(/^\d+\s*/, "")}</span><span><strong>{collection.statistics.subjects}</strong> {t("publications.fact.subjects", { count: collection.statistics.subjects }).replace(/^\d+\s*/, "")}</span></div>
        </div>
        <aside className="publication-collection-note">
          <span className="micro-label">{t("publications.note.label")}</span>
          <h2>{t("publications.note.title")}</h2>
          <p>{t("publications.note.body")}</p>
          <div className="publication-source-status">{t("publications.note.status")}</div>
          <a className="text-link" href={collection.source.announcementUrl} target="_blank" rel="noreferrer">{t("publications.note.announcement")} ↗</a>
        </aside>
      </section>

      <nav className="publication-collection-bar" aria-label={t("publications.bar.aria")}>
        <span>{t("publications.bar.indexed", { date: collection.indexedAt.slice(0, 10) })}</span>
        <div><a href="#collection-notes">{t("publications.bar.notes")}</a><a href="#withdrawals">{t("publications.bar.withdrawals", { count: collection.withdrawals.length })}</a><Link href="/proof-evolution">{t("publications.bar.proofMaps")}</Link><Link href="/proof-evolution/landau-siegel">{t("publications.bar.landauSiegel")}</Link><a href="/api/publications/openai-math?download=1" download="proofweave-openai-math.json">{t("publications.bar.download")} ↓</a></div>
      </nav>

      <section aria-labelledby="publication-browse-title" className="publication-browser" id="browse">
        <div className="publication-browse-heading"><div><p className="eyebrow">{t("publications.browse.eyebrow")}</p><h2 id="publication-browse-title">{t("publications.browse.title")}</h2></div><span>{t("publications.browse.hint")}</span></div>
        <form className="publication-filters" action="/publications" method="get">
          <label className="publication-search">{t("publications.search")}<input type="search" name="q" defaultValue={result.query} maxLength={240} placeholder={t("publications.searchPlaceholder")} /></label>
          <label>{t("publications.subject")}<select aria-label={t("publications.subject")} name="subject" defaultValue={result.subject}><option value="">{t("publications.subjectAll", { count: collection.statistics.subjects })}</option>{collection.subjects.map((subject) => <option key={subject.name} value={subject.name}>{subject.name} ({subject.families})</option>)}</select></label>
          <label>{t("publications.evidence")}<select aria-label={t("publications.evidence")} name="evidence" defaultValue={result.evidence}><option value="all">{t("publications.evidence.all")}</option><option value="scope">{t("publications.evidence.scope")}</option><option value="no-scope">{t("publications.evidence.noScope")}</option></select></label>
          <button className="button button-primary" type="submit">{t("publications.searchAction")} →</button>
        </form>
        <div className="publication-results-heading"><p><strong>{result.total}</strong> {t(result.total === 1 ? "publications.results.family.one" : "publications.results.family.other", { count: result.total }).replace(/^\d+\s*/, "")} · {manuscriptCount(result.manuscriptCount).replace(/^\d+\s*/, "")}{result.query ? <> {t("publications.results.matching", { query: result.query })}</> : null}</p>{result.query || result.subject || result.evidence !== "all" ? <Link href="/publications">{t("publications.clearFilters")}</Link> : <span>{t("publications.ordered")}</span>}</div>
        {families.length ? <div className="publication-result-grid">{families.map((family) => <article className="publication-family-card" key={family.number}>
          <div className="publication-card-top"><span className="publication-family-number">{family.number}</span><span>{family.subject}</span></div>
          <h3><Link href={`/publications/openai-math/${family.number}`}><MathText text={family.title} /></Link></h3>
          <span className="publication-claim-label">{t("publications.card.claimLabel")}</span>
          <p className="publication-card-claim"><MathText text={family.claim} /></p>
          <div className="publication-card-evidence"><span>{manuscriptCount(family.manuscripts.length)}</span><span className={family.scope ? "publication-scope-badge" : "publication-scope-missing"}>{family.scope ? t("publications.card.leanScope") : t("publications.card.noScope")}</span></div>
          <Link className="publication-card-link" href={`/publications/openai-math/${family.number}`}>{t("publications.card.read")} <span aria-hidden="true">→</span></Link>
        </article>)}</div> : <div className="publication-empty"><h3>{t("publications.empty.title")}</h3><p>{t("publications.empty.body")}</p><Link className="text-link" href="/publications">{t("publications.empty.action")} →</Link></div>}
        {result.total > 0 && <nav className="publication-pagination" aria-label={t("publications.paginationAria")}>
          {result.page > 1 ? <Link href={browseHref(result.page - 1)}>← {t("publications.pagination.previous")}</Link> : <span aria-disabled="true">← {t("publications.pagination.previous")}</span>}
          <span>{t("publications.pagination.page", { page: result.page, count: result.pageCount })}</span>
          {result.page < result.pageCount ? <Link href={browseHref(result.page + 1)}>{t("publications.pagination.next")} →</Link> : <span aria-disabled="true">{t("publications.pagination.next")} →</span>}
        </nav>}
      </section>

      <section className="publication-notes-grid" id="collection-notes" aria-labelledby="collection-notes-title">
        <article><p className="eyebrow">{t("publications.notes.statusEyebrow")}</p><h2 id="collection-notes-title">{t("publications.notes.statusTitle")}</h2><p>{t("publications.notes.statusBodyA", { formalized: collection.statistics.upstreamReportedFormalizedResults, manuscripts: collection.statistics.manuscripts, documents: collection.statistics.scopeDocuments })}</p><p>{t("publications.notes.statusBodyB")}</p><a className="text-link" href={collection.source.historyUrl} target="_blank" rel="noreferrer">{t("publications.notes.statusLink")} ↗</a></article>
        <article><p className="eyebrow">{t("publications.notes.reuseEyebrow")}</p><h2>{t("publications.notes.reuseTitle")}</h2><p>{t("publications.notes.reuseBody")}</p><dl><div><dt>{t("publications.notes.source")}</dt><dd><a href={collection.source.repository} target="_blank" rel="noreferrer">openai/math ↗</a></dd></div><div><dt>{t("publications.notes.revision")}</dt><dd><code>{collection.source.revision.slice(0, 12)}</code></dd></div><div><dt>{t("publications.notes.license")}</dt><dd><a href={collection.source.licenseUrl} target="_blank" rel="noreferrer">{collection.source.license} ↗</a></dd></div></dl><Link className="text-link" href="/explore">{t("publications.notes.findTarget")} →</Link></article>
      </section>
      <section className="publication-withdrawals" id="withdrawals" aria-labelledby="withdrawals-title">
        <div className="publication-browse-heading"><div><p className="eyebrow">{t("publications.withdrawals.eyebrow")}</p><h2 id="withdrawals-title">{t("publications.withdrawals.title")}</h2></div><span>{t("publications.withdrawals.hint")}</span></div>
        <p>{t("publications.withdrawals.body")}</p>
        {collection.withdrawals.map((paper) => <a className="publication-withdrawal-row" href={paper.noticeUrl} key={paper.title} target="_blank" rel="noreferrer"><span className="publication-withdrawn-badge">{t("publications.withdrawn")}</span><strong>{paper.title}</strong><span>{t("publications.withdrawalMeta", { date: paper.date })} ↗</span></a>)}
      </section>
    </main><Footer />
  </div>;
}
