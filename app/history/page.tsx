import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../header";
import { Footer } from "../ui";
import { HistoryTimeline, type EvidenceTone } from "./HistoryTimeline";
import { milestones } from "./milestones";

export const metadata: Metadata = {
  title: "AI Mathematics Record",
  description: "A sourced history of AI contributions to open mathematics, with the evidence, Lean artifacts, and replay paths behind every claim.",
  openGraph: {
    title: "AI Mathematics Record: evidence and Lean replay paths",
    description: "A sourced history of AI contributions to open mathematics—with Lean artifacts and replay paths behind each claim.",
    images: ["/ai-mathematics-record-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Mathematics Record: evidence and Lean replay paths",
    description: "A sourced history of AI contributions to open mathematics—with Lean artifacts and replay paths behind each claim.",
    images: ["/ai-mathematics-record-og.png"],
  },
};


const evidenceLegend: Array<{ tone: EvidenceTone; label: string; detail: string }> = [
  { tone: "formal", label: "Formalized", detail: "Executable proof checked by a proof kernel" },
  { tone: "reviewed", label: "Human-reviewed", detail: "Paper or construction checked by mathematicians" },
  { tone: "reproduced", label: "Exact reproduction", detail: "A bounded algebraic claim can be recomputed" },
  { tone: "announced", label: "Newly announced", detail: "Public claim whose scholarly record is still forming" },
];

export default function HistoryPage() {
  return <div className="site-shell history-shell"><Header active="history" /><main id="main-content" tabIndex={-1}>
    <section className="history-hero">
      <div className="history-hero-copy"><p className="eyebrow">AI × MATHEMATICS · PUBLIC RECORD</p><h1>From Erdős problems to a formalization frontier.</h1><p>A sourced timeline of AI contributions to open mathematics—and the evidence behind each claim. This record separates discovery, human judgment, formal checking, and public announcement.</p><div className="history-hero-actions"><a className="button button-primary" href="#timeline">Read the timeline <span aria-hidden="true">↓</span></a><Link className="history-text-link" href="#lean-replay">Open Lean replay paths <span aria-hidden="true">→</span></Link></div></div>
      <aside className="history-hero-index" aria-label="Record summary"><span>RECORD WINDOW</span><strong>JAN — SEP</strong><small>2026 · {milestones.length} milestones</small><div className="history-pulse" aria-hidden="true">{milestones.map((item) => <i key={item.number} />)}</div><p>Updated 10 September 2026</p></aside>
    </section>

    <section className="history-legend" aria-labelledby="evidence-legend-title"><div><p className="eyebrow">How to read this record</p><h2 id="evidence-legend-title">“AI solved it” is not one evidence state.</h2></div><div className="history-legend-grid">{evidenceLegend.map((item) => <article key={item.label}><span className={`history-state is-${item.tone}`}>{item.label}</span><p>{item.detail}</p></article>)}</div></section>

    <section className="history-replay" id="lean-replay" aria-labelledby="history-replay-title"><div className="history-replay-heading"><div><p className="eyebrow">Lean replay desk</p><h2 id="history-replay-title">Claim → source → executable check.</h2></div><p>These are the shortest honest paths from the public record to a kernel-checked artifact. External repositories are linked directly; Proofweave workspaces are entry points for a bounded local replay and do not imply that a result has already been verified here.</p></div><div className="history-replay-grid"><article><span className="history-replay-index">01 · OPENAI</span><h3>Ten advances</h3><p>Ten Lean 4 formalizations, with a documented all-project build and individual modules.</p><div className="history-replay-actions"><a href="https://github.com/openai/ten-proofs" rel="noreferrer" target="_blank">Open certificates <span aria-hidden="true">↗</span></a><Link href="/explore">Search matching targets <span aria-hidden="true">→</span></Link></div></article><article><span className="history-replay-index">02 · ANTHROPIC</span><h3>Zeta23</h3><p>A pinned Lean formalization for the more-than-two-thirds lower-bound result; it does not prove RH.</p><div className="history-replay-actions"><a href="https://github.com/anthropics/zeta-23-lean" rel="noreferrer" target="_blank">Open formalization <span aria-hidden="true">↗</span></a><Link href="/workbench?target=riemann-hypothesis#research-launcher">Start replay path <span aria-hidden="true">→</span></Link></div></article><article><span className="history-replay-index">03 · PROOFWEAVE</span><h3>Owner-approved replay</h3><p>Select a pinned target, connect a local Agent, run Lean locally, and publish only the checkpoint you approve.</p><div className="history-replay-actions"><Link href="/workbench?target=riemann-hypothesis#research-launcher">Open workspace <span aria-hidden="true">→</span></Link><Link href="/demo#verification-console">Inspect verification demo <span aria-hidden="true">→</span></Link></div></article></div></section>

    <p className="history-update-note">Latest source review: 19 August–10 September 2026. Includes the S² × S² human research milestone for context. Selected X announcements are cross-checked against authors’ papers and repositories. Dates distinguish public releases from earlier proof work; X timestamps use UTC. External verification claims are attributed to their authors; this update includes no new Proofweave Lean replay or receipt.</p>

    <HistoryTimeline milestones={milestones} />

    <section className="history-method" aria-labelledby="hodge-status-title"><div><p className="eyebrow">Status check · 10 September 2026</p><h2 id="hodge-status-title">Hodge conjecture: no verified resolution recorded.</h2></div><p>Reports of a possible result under review are circulating. This source review found no public proof or official result announcement that establishes a resolution. The <a href="https://www.claymath.org/millennium/hodge-conjecture/" target="_blank" rel="noreferrer">Clay Mathematics Institute still lists it as unsolved</a>. It is therefore not counted as a solved milestone on this timeline.</p></section>

    <section className="history-method"><div><p className="eyebrow">A record, not a leaderboard</p><h2>The unit of history should be a verifiable contribution.</h2></div><div className="history-method-flow" aria-label="Contribution evidence chain"><span>Problem selection</span><i aria-hidden="true">→</i><span>AI exploration</span><i aria-hidden="true">→</i><span>Human judgment</span><i aria-hidden="true">→</i><span>Exact evidence</span><i aria-hidden="true">→</i><span>Independent record</span></div><p>Proof search, problem selection, literature review, formal verification, and publication are different contributions. This archive preserves those boundaries instead of awarding a whole result to the most dramatic headline.</p></section>

    <section className="history-cta"><div><p className="eyebrow">The next entry</p><h2>Make the next mathematical advance reproducible from the start.</h2></div><div><p>Proofweave turns local Agent work into signed evidence, independent replay, and contribution records attributed to the person who delegated it.</p><div className="button-row"><Link className="button button-primary" href="/explore">Explore open mathematics <span aria-hidden="true">→</span></Link><Link className="button button-secondary" href="/demo">Inspect a verified record</Link></div></div></section>
  </main><Footer /></div>;
}
