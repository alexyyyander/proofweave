import type { PublicationReadingGuide } from "@/app/lib/publications";
import { MathText } from "./MathText";

export function ReadingGuide({ guide }: { guide: PublicationReadingGuide }) {
  return <section className="publication-reading-guide" id="reading-guide" lang="zh-CN" aria-labelledby="reading-guide-title">
    <div className="reading-guide-heading"><p className="eyebrow">Proofweave 中文导读</p><span>AI 辅助整理 · 引言与主声明阅读</span></div>
    <h2 id="reading-guide-title">{guide.titleZh}</h2>
    <p className="reading-guide-summary">{guide.summaryZh}</p>
    <p className="reading-guide-attribution">以下解释依据 OpenAI 稿件及证明材料整理。Proofweave 证明复验与独立数学审阅均待完成。</p>
    <div className="reading-guide-context"><div><h3>在研究什么？</h3><p>{guide.questionZh}</p></div><div><h3>为什么值得读？</h3><p><MathText text={guide.whyItMattersZh} /></p></div></div>
    <h3>论文给出的主结论</h3><p><MathText text={guide.paperClaimZh} /></p>
    <div className="reading-guide-scope"><span>{guide.scopeLabelZh}</span><h3>论文与 Lean 覆盖范围</h3><p><MathText text={guide.scopeNotesZh} /></p><p className="reading-guide-boundary"><MathText text={guide.boundaryZh} /></p></div>
    <h3>如何读证明路线</h3><p className="reading-guide-caption">依据论文引言中的证明概述归纳；详细证明仍需另行审阅。</p>
    <ol className="reading-guide-route">{guide.proofRouteZh.map((step) => <li key={step}><MathText text={step} /></li>)}</ol>
    <details className="reading-guide-details"><summary>术语与后续核对</summary><dl>{guide.terms.map((term) => <div key={term.term}><dt>{term.term}</dt><dd><MathText text={term.explanationZh} /></dd></div>)}</dl><h3>下一步核对什么？</h3><ul>{guide.nextChecksZh.map((check) => <li key={check}>{check}</li>)}</ul></details>
    <details className="reading-guide-details"><summary>阅读范围与来源（{guide.sources.length} 处）</summary><p>{guide.limitationsZh}</p><p>{guide.comparatorNoteZh}</p><ul className="reading-guide-sources">{guide.sources.map((source) => <li key={source.path}><a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a><small>所读行 {source.readLines[0]}–{source.readLines[1]} · SHA-256 <code>{source.sha256}</code></small></li>)}</ul></details>
  </section>;
}
