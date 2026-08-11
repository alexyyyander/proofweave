import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "../header";
import { Footer } from "../ui";
import { HistoryTimeline, type EvidenceTone, type HistoryMilestone } from "./HistoryTimeline";

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
    special: "jacobian",
    timelineLane: "below",
    timelinePosition: "96%",
  },
  {
    number: "08",
    date: "01 AUG 2026",
    title: "OpenAI publishes ten advances",
    system: "OpenAI · internal Astra",
    summary: "OpenAI published ten results spanning geometry, coding theory, group theory, operator algebras, quantum complexity, lattice cryptography, and extremal combinatorics.",
    aiRole: "The internal Astra system generated the mathematical arguments and then formalized each one in a Lean certificate.",
    humanRole: "OpenAI researchers prepared the manuscripts, selected the public record, and took responsibility for the formalized proofs.",
    evidence: "Ten external Lean formalizations",
    evidenceTone: "formal",
    shortTitle: "Ten advances",
    significance: "The unit of evidence changed from one headline result to a portfolio. The public repository makes all ten certificates available for independent Lake builds; Proofweave still treats them as external artifacts until a local replay receipt is submitted.",
    sources: [
      { label: "OpenAI publication", href: "https://openai.com/index/ten-advances-in-mathematics/" },
      { label: "Ten Lean certificates", href: "https://github.com/openai/ten-proofs" },
    ],
    special: "openai-ten",
    reproduction: {
      label: "Open the ten Lean certificates",
      detail: "The public repository lists one Lean 4 module for each result and documents `lake build All`.",
      href: "https://github.com/openai/ten-proofs",
      workspaceHref: "/explore",
      workspaceLabel: "Search matching Proofweave targets",
      command: "lake exe cache get · lake build All",
    },
    timelineLane: "above",
    timelinePosition: "98%",
  },
  {
    number: "09",
    date: "10 AUG 2026",
    title: "Claude improves a Riemann-zeta lower bound",
    system: "Claude · unreleased research version",
    summary: "Claude did not solve the Riemann Hypothesis, but Anthropic reports a new lower bound for the fraction of zeta zeros on the critical line: 41.6% to 67.2%.",
    aiRole: "Claude searched, tested, criticized, and formalized the argument across coordinated research sessions.",
    humanRole: "Anthropic mathematicians examined the paper, related it to prior work, and released the supporting note and formal artifact.",
    evidence: "External Lean formalization",
    evidenceTone: "formal",
    shortTitle: "Riemann bound",
    significance: "This is a substantial result about a related problem, not a proof of the Riemann Hypothesis. The exact formalization is now public and can be replayed independently; a Proofweave receipt is still not recorded.",
    sources: [
      { label: "Anthropic report", href: "https://www.anthropic.com/research/riemann-zeta" },
      { label: "Zeta23 Lean project", href: "https://github.com/anthropics/zeta-23-lean" },
    ],
    frontier: true,
    latest: true,
    special: "riemann",
    reproduction: {
      label: "Open the Zeta23 Lean formalization",
      detail: "The artifact documents a pinned Lean toolchain and headline theorems for the more-than-two-thirds result.",
      href: "https://github.com/anthropics/zeta-23-lean",
      workspaceHref: "/workbench?target=riemann-hypothesis#research-launcher",
      workspaceLabel: "Start a bounded Proofweave replay",
      command: "lake build · lake build Solution Solution.Multiplicity Solution.XiPrime",
    },
    timelineLane: "below",
    timelinePosition: "99.5%",
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
      <div className="history-hero-copy"><p className="eyebrow">AI × MATHEMATICS · PUBLIC RECORD</p><h1>From Erdős problems to a formalization frontier.</h1><p>A sourced timeline of AI contributions to open mathematics—and the evidence behind each claim. This record separates discovery, human judgment, formal checking, and public announcement.</p><div className="history-hero-actions"><a className="button button-primary" href="#timeline">Read the timeline <span aria-hidden="true">↓</span></a><Link className="history-text-link" href="#lean-replay">Open Lean replay paths <span aria-hidden="true">→</span></Link></div></div>
      <aside className="history-hero-index" aria-label="Record summary"><span>RECORD WINDOW</span><strong>JAN — AUG</strong><small>2026 · {milestones.length} milestones</small><div className="history-pulse" aria-hidden="true">{milestones.map((item) => <i key={item.number} />)}</div><p>Updated 11 August 2026</p></aside>
    </section>

    <section className="history-legend" aria-labelledby="evidence-legend-title"><div><p className="eyebrow">How to read this record</p><h2 id="evidence-legend-title">“AI solved it” is not one evidence state.</h2></div><div className="history-legend-grid">{evidenceLegend.map((item) => <article key={item.label}><span className={`history-state is-${item.tone}`}>{item.label}</span><p>{item.detail}</p></article>)}</div></section>

    <section className="history-replay" id="lean-replay" aria-labelledby="history-replay-title"><div className="history-replay-heading"><div><p className="eyebrow">Lean replay desk</p><h2 id="history-replay-title">Claim → source → executable check.</h2></div><p>These are the shortest honest paths from the public record to a kernel-checked artifact. External repositories are linked directly; Proofweave workspaces are entry points for a bounded local replay and do not imply that a result has already been verified here.</p></div><div className="history-replay-grid"><article><span className="history-replay-index">01 · OPENAI</span><h3>Ten advances</h3><p>Ten Lean 4 formalizations, with a documented all-project build and individual modules.</p><div className="history-replay-actions"><a href="https://github.com/openai/ten-proofs" rel="noreferrer" target="_blank">Open certificates <span aria-hidden="true">↗</span></a><Link href="/explore">Search matching targets <span aria-hidden="true">→</span></Link></div></article><article><span className="history-replay-index">02 · ANTHROPIC</span><h3>Zeta23</h3><p>A pinned Lean formalization for the more-than-two-thirds lower-bound result; it does not prove RH.</p><div className="history-replay-actions"><a href="https://github.com/anthropics/zeta-23-lean" rel="noreferrer" target="_blank">Open formalization <span aria-hidden="true">↗</span></a><Link href="/workbench?target=riemann-hypothesis#research-launcher">Start replay path <span aria-hidden="true">→</span></Link></div></article><article><span className="history-replay-index">03 · PROOFWEAVE</span><h3>Owner-approved replay</h3><p>Select a pinned target, connect a local Agent, run Lean locally, and publish only the checkpoint you approve.</p><div className="history-replay-actions"><Link href="/workbench?target=riemann-hypothesis#research-launcher">Open workspace <span aria-hidden="true">→</span></Link><Link href="/demo#verification-console">Inspect verification demo <span aria-hidden="true">→</span></Link></div></article></div></section>

    <HistoryTimeline milestones={milestones} />

    <section className="history-method"><div><p className="eyebrow">A record, not a leaderboard</p><h2>The unit of history should be a verifiable contribution.</h2></div><div className="history-method-flow" aria-label="Contribution evidence chain"><span>Problem selection</span><i aria-hidden="true">→</i><span>AI exploration</span><i aria-hidden="true">→</i><span>Human judgment</span><i aria-hidden="true">→</i><span>Exact evidence</span><i aria-hidden="true">→</i><span>Independent record</span></div><p>Proof search, problem selection, literature review, formal verification, and publication are different contributions. This archive preserves those boundaries instead of awarding a whole result to the most dramatic headline.</p></section>

    <section className="history-cta"><div><p className="eyebrow">The next entry</p><h2>Make the next mathematical advance reproducible from the start.</h2></div><div><p>Proofweave turns local Agent work into signed evidence, independent replay, and contribution records attributed to the person who delegated it.</p><div className="button-row"><Link className="button button-primary" href="/explore">Explore open mathematics <span aria-hidden="true">→</span></Link><Link className="button button-secondary" href="/demo">Inspect a verified record</Link></div></div></section>
  </main><Footer /></div>;
}
