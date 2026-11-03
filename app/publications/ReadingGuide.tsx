import type { PublicationReadingGuide } from "@/app/lib/publications";
import type { Translator } from "@/app/i18n/translate";
import { MathText } from "./MathText";

export function ReadingGuide({ guide, t }: { guide: PublicationReadingGuide; t: Translator }) {
  return <section className="publication-reading-guide" id="reading-guide" aria-labelledby="reading-guide-title">
    <div className="reading-guide-heading"><p className="eyebrow">{t("readingGuide.heading")}</p><span>{t("readingGuide.scope")}</span></div>
    <h2 id="reading-guide-title">{guide.title}</h2>
    <p className="reading-guide-summary">{guide.summary}</p>
    <p className="reading-guide-attribution">{t("readingGuide.attribution")}</p>
    <div className="reading-guide-context"><div><h3>{t("readingGuide.question")}</h3><p>{guide.question}</p></div><div><h3>{t("readingGuide.matters")}</h3><p><MathText text={guide.whyItMatters} /></p></div></div>
    <h3>{t("readingGuide.claim")}</h3><p><MathText text={guide.paperClaim} /></p>
    <div className="reading-guide-scope"><span>{guide.scopeLabel}</span><h3>{t("readingGuide.manuscript")}</h3><p><MathText text={guide.scopeNotes} /></p><p className="reading-guide-boundary"><MathText text={guide.boundary} /></p></div>
    <h3>{t("readingGuide.outline")}</h3><p className="reading-guide-caption">{t("readingGuide.outlineNote")}</p>
    <ol className="reading-guide-route">{guide.proofRoute.map((step) => <li key={step}><MathText text={step} /></li>)}</ol>
    <details className="reading-guide-details"><summary>{t("readingGuide.terms")}</summary><dl>{guide.terms.map((term) => <div key={term.term}><dt>{term.term}</dt><dd><MathText text={term.explanation} /></dd></div>)}</dl><h3>{t("readingGuide.next")}</h3><ul>{guide.nextChecks.map((check) => <li key={check}>{check}</li>)}</ul></details>
    <details className="reading-guide-details"><summary>{t("readingGuide.sources", { count: guide.sources.length })}</summary><p>{guide.limitations}</p><p>{guide.comparatorNote}</p><ul className="reading-guide-sources">{guide.sources.map((source) => <li key={source.path}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a><small>{t("readingGuide.lines", { start: source.readLines[0], end: source.readLines[1] })} · SHA-256 <code>{source.sha256}</code></small></li>)}</ul></details>
  </section>;
}
