import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../header";
import { Footer } from "../ui";
import { HistoryTimeline, type EvidenceTone, type HistoryMilestone } from "./HistoryTimeline";

export const metadata: Metadata = {
  title: "AI Mathematics Record",
  description: "A sourced history of AI contributions to open mathematics, from Erdős problems to the Jacobian frontier, with the evidence behind every claim.",
  openGraph: {
    title: "From Erdős to the Jacobian frontier",
    description: "A sourced history of AI contributions to open mathematics—and the evidence behind every claim.",
    images: ["/ai-mathematics-record-og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "From Erdős to the Jacobian frontier",
    description: "A sourced history of AI contributions to open mathematics—and the evidence behind every claim.",
    images: ["/ai-mathematics-record-og.png"],
  },
};

const milestones: HistoryMilestone[] = [
  {
    number: "01",
    date: "JAN 2026",
    title: "Erdős Problem #728",
    system: "Aristotle",
    summary: "A Lean-checked result became the first recognized Erdős problem resolved autonomously by an AI system.",
    aiRole: "Generated the proof and its Lean formalization.",
    humanRole: "Selected and presented the result, and searched the literature for prior work.",
    evidence: "Kernel-checked Lean proof",
    evidenceTone: "formal",
    shortTitle: "Erdős #728",
    significance: "The headline was bounded by an executable artifact: the mathematical proof could be replayed independently of the model narrative.",
    sources: [{ label: "Research paper", href: "https://arxiv.org/abs/2601.07421" }],
    timelineLane: "above",
    timelinePosition: "7%",
  },
  {
    number: "02",
    date: "MAR 2026",
    title: "Erdős Problem #650",
    system: "ChatGPT + Aristotle",
    summary: "A model-proposed strategy was made rigorous and formally verified, showing a distinctly collaborative path to a result.",
    aiRole: "ChatGPT proposed the strategy; Aristotle produced a detailed Lean-verified argument.",
    humanRole: "Checked the reasoning, supplied context, and wrote the final exposition.",
    evidence: "Paper + formal verification",
    evidenceTone: "formal",
    shortTitle: "Erdős #650",
    significance: "It made clear that “AI solved” can describe a chain of different systems and human decisions, not one isolated act.",
    sources: [{ label: "Research paper", href: "https://arxiv.org/abs/2603.28636" }],
    timelineLane: "below",
    timelinePosition: "30%",
  },
  {
    number: "03",
    date: "MAY 2026",
    title: "Erdős Problem #1196",
    system: "GPT-5.4 Pro + mathematicians",
    summary: "A new Markov-chain method with von Mangoldt weights emerged from model output and was refined into a mathematical paper.",
    aiRole: "Suggested the central method and an initial route through the argument.",
    humanRole: "Reworked gaps, established the rigorous result, and authored the paper.",
    evidence: "Human-reviewed preprint",
    evidenceTone: "reviewed",
    shortTitle: "Erdős #1196",
    significance: "The valuable contribution was an idea that changed the proof route—not a claim that the first generated answer was already a proof.",
    sources: [{ label: "Research paper", href: "https://arxiv.org/abs/2605.00301" }],
    timelineLane: "above",
    timelinePosition: "52%",
  },
  {
    number: "04",
    date: "20 MAY 2026",
    title: "A planar unit-distance conjecture falls",
    system: "OpenAI reasoning model",
    summary: "A general-purpose reasoning model produced a counterexample to a longstanding Erdős unit-distance conjecture.",
    aiRole: "Found the construction and the core disproof.",
    humanRole: "External mathematicians checked it, simplified the construction, and situated the result in the literature.",
    evidence: "Expert-checked counterexample",
    evidenceTone: "reviewed",
    shortTitle: "Unit distance",
    significance: "Counterexamples became a visible AI research mode: one exact construction can decisively close the wrong branch.",
    sources: [{ label: "OpenAI report", href: "https://openai.com/index/model-disproves-discrete-geometry-conjecture/" }],
    timelineLane: "below",
    timelinePosition: "61%",
  },
  {
    number: "05",
    date: "21 MAY 2026",
    title: "AlphaProof Nexus scales the search",
    system: "Google DeepMind · AlphaProof Nexus",
    summary: "A formal proof-search framework coordinated LLM prover subagents, Lean compiler feedback, optional AlphaProof calls, and evolutionary selection across open-problem benchmarks.",
    aiRole: "Generated and revised Lean proof sketches, using compiler feedback until a complete, sorry-free proof passed validation.",
    humanRole: "Formalized targets and evaluated statement fidelity, novelty, and mathematical relevance.",
    evidence: "Lean artifacts + expert validation",
    evidenceTone: "formal",
    shortTitle: "AlphaProof",
    significance: "Its reported 9/353 Erdős and 44/492 OEIS results shifted the frontier from one celebrated example to a repeatable, measurable workflow.",
    sources: [{ label: "Research paper", href: "https://arxiv.org/abs/2605.22763" }],
    timelineLane: "above",
    timelinePosition: "64.5%",
  },
  {
    number: "06",
    date: "09 JUL 2026",
    title: "Cycle Double Cover Conjecture",
    system: "GPT-5.6 Sol Ultra + Codex",
    summary: "OpenAI released a proof that every finite bridgeless loopless multigraph admits a family of cycles covering each edge exactly twice.",
    aiRole: "GPT-5.6 Sol Ultra developed the proof; Codex helped produce the write-up and the accompanying Lean formalization.",
    humanRole: "Specified the exact target and adversarial audit requirements, published the complete prompt, and opened the artifacts to independent review.",
    evidence: "Lean kernel-checked artifact",
    evidenceTone: "formal",
    shortTitle: "CDC conjecture",
    significance: "A concise flow-and-linear-algebra argument arrived with a pinned Lean project that checks the full unconditional theorem—not only a finite computation or special graph class.",
    sources: [
      { label: "Proof note", href: "https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_proof.pdf" },
      { label: "Lean formalization", href: "https://github.com/openai/cdc-lean" },
      { label: "Published prompt", href: "https://cdn.openai.com/pdf/04d1d1e4-bc75-476a-97cf-49055cd98d31/cdc_prompt.pdf" },
    ],
    timelineLane: "above",
    timelinePosition: "89%",
  },
  {
    number: "07",
    date: "20 JUL 2026",
    title: "A three-dimensional Jacobian counterexample is announced.",
    system: "Claude-Fable · reported by Levent Alpöge",
    summary: "An explicit polynomial map over ℂ was reported with constant nonzero Jacobian determinant and three distinct inputs sharing one output—the exact shape required to refute the classical Jacobian Conjecture in dimension three.",
    aiRole: "Claude-Fable produced the explicit map during an open-ended mathematical exploration.",
    humanRole: "Levent Alpöge directed the investigation, checked the construction, and announced the result with exact coordinates.",
    evidence: "Newly announced",
    evidenceTone: "announced",
    shortTitle: "Jacobian",
    significance: "The determinant and collision are directly reproducible by symbolic or exact arithmetic. Journal review and a formal Proofweave receipt are not yet recorded.",
    sources: [
      { label: "Original announcement", href: "https://x.com/__alpoge__/status/2079028340955197566" },
      { label: "Mathematical discussion", href: "https://mathoverflow.net/questions/130777/could-the-jacobian-conjecture-be-undecidable/513385" },
    ],
    frontier: true,
    timelineLane: "below",
    timelinePosition: "96%",
  },
];

const evidenceLegend: Array<{ tone: EvidenceTone; label: string; detail: string }> = [
  { tone: "formal", label: "Formalized", detail: "Executable proof checked by a proof kernel" },
  { tone: "reviewed", label: "Human-reviewed", detail: "Paper or construction checked by mathematicians" },
  { tone: "reproduced", label: "Exact reproduction", detail: "A bounded algebraic claim can be recomputed" },
  { tone: "announced", label: "Newly announced", detail: "Public claim whose scholarly record is still forming" },
];

export default function HistoryPage() {
  return <div className="site-shell history-shell"><Header active="history" /><main id="main-content" tabIndex={-1}>
    <section className="history-hero">
      <div className="history-hero-copy"><p className="eyebrow">AI × MATHEMATICS · PUBLIC RECORD</p><h1>From one Erdős problem to the Jacobian frontier.</h1><p>A sourced timeline of AI contributions to open mathematics—and the evidence behind each claim. This record separates discovery, human judgment, formal checking, and public announcement.</p><div className="history-hero-actions"><a className="button button-primary" href="#timeline">Read the timeline <span aria-hidden="true">↓</span></a><Link className="history-text-link" href="/demo">See executable evidence <span aria-hidden="true">→</span></Link></div></div>
      <aside className="history-hero-index" aria-label="Record summary"><span>RECORD WINDOW</span><strong>JAN — JUL</strong><small>2026 · seven milestones</small><div className="history-pulse" aria-hidden="true"><i /><i /><i /><i /><i /><i /><i /></div><p>Updated 20 July 2026</p></aside>
    </section>

    <section className="history-legend" aria-labelledby="evidence-legend-title"><div><p className="eyebrow">How to read this record</p><h2 id="evidence-legend-title">“AI solved it” is not one evidence state.</h2></div><div className="history-legend-grid">{evidenceLegend.map((item) => <article key={item.label}><span className={`history-state is-${item.tone}`}>{item.label}</span><p>{item.detail}</p></article>)}</div></section>

    <HistoryTimeline milestones={milestones} />

    <section className="history-method"><div><p className="eyebrow">A record, not a leaderboard</p><h2>The unit of history should be a verifiable contribution.</h2></div><div className="history-method-flow" aria-label="Contribution evidence chain"><span>Problem selection</span><i aria-hidden="true">→</i><span>AI exploration</span><i aria-hidden="true">→</i><span>Human judgment</span><i aria-hidden="true">→</i><span>Exact evidence</span><i aria-hidden="true">→</i><span>Independent record</span></div><p>Proof search, problem selection, literature review, formal verification, and publication are different contributions. This archive preserves those boundaries instead of awarding a whole result to the most dramatic headline.</p></section>

    <section className="history-cta"><div><p className="eyebrow">The next entry</p><h2>Make the next mathematical advance reproducible from the start.</h2></div><div><p>Proofweave turns local Agent work into signed evidence, independent replay, and contribution records attributed to the person who delegated it.</p><div className="button-row"><Link className="button button-primary" href="/explore">Explore open mathematics <span aria-hidden="true">→</span></Link><Link className="button button-secondary" href="/demo">Inspect a verified record</Link></div></div></section>
  </main><Footer /></div>;
}
