import { CardTitle, SectionTitle, ActionLink, PageIntro, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { type Metadata } from "next";
import Link from "next/link";

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
  { tone: "corrected", label: "Corrected / withdrawn", detail: "Published proof gaps, revised statements, or withdrawn arguments" },
];

export default function HistoryPage() {
  return <SiteFrame className="site-shell history-shell primary-page" active="history">
    <PageIntro tone="navy" label="AI record" title="From Erdős problems to a formalization frontier."
      description="A sourced timeline of AI contributions to open mathematics—and the evidence behind each claim. This record separates discovery, human judgment, formal checking, and public announcement."
      actions={<><ActionLink variant="primary" href="#timeline">Read the timeline <span aria-hidden="true">↓</span></ActionLink><ActionLink variant="secondary" href="#lean-replay">Open Lean replay paths <span aria-hidden="true">→</span></ActionLink></>}
      meta={<><span>January–October 2026</span><span>{milestones.length} milestones</span><span>Updated 28 October 2026</span></>} />

    <section className="history-legend" aria-labelledby="evidence-legend-title"><div><p className="eyebrow">How to read this record</p><SectionTitle id="evidence-legend-title">“AI solved it” is not one evidence state.</SectionTitle></div><div className="history-legend-grid">{evidenceLegend.map((item) => <Surface as="article" key={item.label}><span className={`history-state is-${item.tone}`}>{item.label}</span><p>{item.detail}</p></Surface>)}</div></section>

    <section className="history-replay" id="lean-replay" aria-labelledby="history-replay-title"><SectionHeading as="div" className="history-replay-heading"><div><p className="eyebrow">Lean replay desk</p><SectionTitle id="history-replay-title">Claim → source → executable check.</SectionTitle></div><p>These are the shortest honest paths from the public record to a kernel-checked artifact. External repositories are linked directly; Proofweave workspaces are entry points for a bounded local replay and do not imply that a result has already been verified here.</p></SectionHeading><div className="history-replay-grid"><Surface as="article"><span className="history-replay-index">01 · OPENAI</span><CardTitle>Mathematics release</CardTitle><p>13 October catalog snapshot: 719 manuscripts in 372 families. Inspect the proof scope for each paper before selecting a bounded replay.</p><div className="history-replay-actions"><a href="https://github.com/openai/math/tree/1581d4cbdd69a0faf34b2089614fe2a814316a6a/lean" rel="noreferrer" target="_blank">Open proof library <span aria-hidden="true">↗</span></a><Link href="/publications">Browse papers &amp; scope <span aria-hidden="true">→</span></Link></div></Surface><Surface as="article"><span className="history-replay-index">02 · ANTHROPIC</span><CardTitle>Zeta23</CardTitle><p>A pinned Lean formalization for the more-than-two-thirds lower-bound result; it does not prove RH.</p><div className="history-replay-actions"><a href="https://github.com/anthropics/zeta-23-lean" rel="noreferrer" target="_blank">Open formalization <span aria-hidden="true">↗</span></a><Link href="/workbench?target=riemann-hypothesis#research-launcher">Start replay path <span aria-hidden="true">→</span></Link></div></Surface><Surface as="article"><span className="history-replay-index">03 · PROOFWEAVE</span><CardTitle>Owner-approved replay</CardTitle><p>Select a pinned target, connect a local Agent, run Lean locally, and publish only the checkpoint you approve.</p><div className="history-replay-actions"><Link href="/workbench?target=riemann-hypothesis#research-launcher">Open workspace <span aria-hidden="true">→</span></Link><Link href="/demo#verification-console">Inspect verification demo <span aria-hidden="true">→</span></Link></div></Surface></div></section>

    <p className="history-update-note">Latest source review: 28 October 2026. Adds the 26 October ETH, local smoothing, and Yang–Mills announcements. The publication browser retains its separately pinned 13 October catalog; the new entries link directly to the newer source artifacts. Earlier entries retain their dated sources, including the S² × S² human research milestone for context. Dates distinguish releases, correction logs, and earlier proof work; X timestamps use UTC. External verification claims are attributed to their authors; this update includes no new Proofweave Lean replay or receipt.</p>

    <HistoryTimeline milestones={milestones} />

    <section className="history-method" aria-labelledby="hodge-status-title"><div><p className="eyebrow">Status check · 13 October 2026</p><SectionTitle id="hodge-status-title">Hodge conjecture: inspect the scope and corrections.</SectionTitle></div><p>OpenAI’s October collection claims the rational Hodge conjecture for CM abelian varieties, a specific class of varieties. Three other related manuscripts were withdrawn after a sign error; the <a href="https://github.com/openai/math/blob/1581d4cbdd69a0faf34b2089614fe2a814316a6a/history.md" target="_blank" rel="noreferrer">correction log</a> identifies them. The <a href="https://www.claymath.org/millennium/hodge-conjecture/" target="_blank" rel="noreferrer">Clay Mathematics Institute lists the general problem as unsolved</a>. It is not counted as a solved milestone here. <Link href="/publications/openai-math/032">Inspect the CM abelian-variety claim →</Link></p></section>

    <section className="history-method"><div><p className="eyebrow">A record, not a leaderboard</p><SectionTitle>The unit of history should be a verifiable contribution.</SectionTitle></div><div className="history-method-flow" aria-label="Contribution evidence chain"><span>Problem selection</span><i aria-hidden="true">→</i><span>AI exploration</span><i aria-hidden="true">→</i><span>Human judgment</span><i aria-hidden="true">→</i><span>Exact evidence</span><i aria-hidden="true">→</i><span>Independent record</span></div><p>Proof search, problem selection, literature review, formal verification, and publication are different contributions. This archive preserves those boundaries instead of awarding a whole result to the most dramatic headline.</p></section>

    <section className="history-cta"><div><p className="eyebrow">The next entry</p><SectionTitle>Make the next mathematical advance reproducible from the start.</SectionTitle></div><div><p>Proofweave turns local Agent work into signed evidence, independent replay, and contribution records attributed to the person who delegated it.</p><div className="button-row"><ActionLink className="button button-primary" href="/explore">Explore open mathematics <span aria-hidden="true">→</span></ActionLink><ActionLink className="button button-secondary" href="/demo">Inspect a verified record</ActionLink></div></div></section>
  </SiteFrame>;
}
