import type { PublicationReadingGuide } from "@/app/lib/publications";
import { MathText } from "./MathText";

export function ReadingGuide({ guide }: { guide: PublicationReadingGuide }) {
  return <section className="publication-reading-guide" id="reading-guide" aria-labelledby="reading-guide-title">
    <div className="reading-guide-heading"><p className="eyebrow">Proofweave reading guide</p><span>AI-assisted source reading · Introduction and main statements</span></div>
    <h2 id="reading-guide-title">{guide.title}</h2>
    <p className="reading-guide-summary">{guide.summary}</p>
    <p className="reading-guide-attribution">Based on OpenAI manuscripts and proof materials. Proofweave replay and independent mathematical review remain pending.</p>
    <div className="reading-guide-context"><div><h3>Research question</h3><p>{guide.question}</p></div><div><h3>Why it matters</h3><p><MathText text={guide.whyItMatters} /></p></div></div>
    <h3>Main claim in the paper</h3><p><MathText text={guide.paperClaim} /></p>
    <div className="reading-guide-scope"><span>{guide.scopeLabel}</span><h3>Manuscript and Lean coverage</h3><p><MathText text={guide.scopeNotes} /></p><p className="reading-guide-boundary"><MathText text={guide.boundary} /></p></div>
    <h3>Published proof outline</h3><p className="reading-guide-caption">Summarized from the proof overview in the introduction. Detailed proofs still need separate review.</p>
    <ol className="reading-guide-route">{guide.proofRoute.map((step) => <li key={step}><MathText text={step} /></li>)}</ol>
    <details className="reading-guide-details"><summary>Terms and next checks</summary><dl>{guide.terms.map((term) => <div key={term.term}><dt>{term.term}</dt><dd><MathText text={term.explanation} /></dd></div>)}</dl><h3>What to check next</h3><ul>{guide.nextChecks.map((check) => <li key={check}>{check}</li>)}</ul></details>
    <details className="reading-guide-details"><summary>Reading scope and sources ({guide.sources.length})</summary><p>{guide.limitations}</p><p>{guide.comparatorNote}</p><ul className="reading-guide-sources">{guide.sources.map((source) => <li key={source.path}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a><small>Lines read {source.readLines[0]}–{source.readLines[1]} · SHA-256 <code>{source.sha256}</code></small></li>)}</ul></details>
  </section>;
}
