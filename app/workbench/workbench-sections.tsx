import Link from "next/link";
import { delegation, leanSource, type GateState, type WorkbenchEvent, workbenchTarget } from "./workbench-data";

function GateRow({ state, label, detail }: { state: GateState; label: string; detail: string }) {
  const stateText = state === "waiting" ? "Complete step" : state === "preview" ? "Preview only" : "Independent";
  const symbol = state === "waiting" ? "·" : state === "preview" ? "◇" : "↗";
  return <li className={`gate-row gate-${state}`}><span className="gate-icon" aria-hidden="true">{symbol}</span><span><strong>{label}</strong><small>{detail}</small></span><em>{stateText}</em></li>;
}

export function WorkbenchHero({ isRunning }: { isRunning: boolean }) {
  return <section className="workbench-hero" aria-labelledby="workbench-title">
    <div>
      <p className="eyebrow">Personal workspace <span className="preview-marker">Local preview</span></p>
      <h1 id="workbench-title">Your research agent</h1>
      <p>One focused proof branch, its evidence, and the next action required to move it forward.</p>
    </div>
    <div className="agent-identity-card">
      <div className="agent-identity-top"><span className={isRunning ? "agent-live" : "agent-paused"}><i aria-hidden="true" />{isRunning ? "Ready for a bounded step" : "Agent paused"}</span><span className="record-chip">Delegation active</span></div>
      <strong>{delegation.agentName}</strong>
      <code>{delegation.agentId}</code>
      <span>Owner&nbsp; <code>{delegation.ownerId}</code></span>
    </div>
  </section>;
}

export function DelegationSummary() {
  return <section className="delegation-summary" aria-label="Delegation certificate">
    <div className="delegation-title"><span className="micro-label">Active delegation</span><strong>{delegation.certificate}</strong><small>Key fingerprint · {delegation.fingerprint}</small></div>
    <div><span className="micro-label">Allowed work</span><p className="scope-list">{delegation.scopes.map((scope) => <b key={scope}>{scope}</b>)}</p></div>
    <div><span className="micro-label">Valid until</span><strong>{delegation.expires}</strong><small>Revocable by owner</small></div>
    <div className="delegation-note"><span className="micro-label">Credit rule</span><small>Same-owner Agents cannot independently verify this branch.</small></div>
  </section>;
}

export function FocusAction({ isRunning, hasRunStep, onRun, onToggleAgent }: { isRunning: boolean; hasRunStep: boolean; onRun: () => void; onToggleAgent: () => void }) {
  const primaryLabel = hasRunStep ? "Bounded step recorded" : isRunning ? "Run next bounded step" : "Agent is paused";
  return <section className="focus-layout" aria-label="Current focus and next action">
    <div className="focus-summary"><span className="micro-label">Current focus</span><h2>{workbenchTarget.title}</h2><p>Branch B-07 · finite-density reduction</p><div className="toolbar-links"><Link className="text-link" href={`/explore/${workbenchTarget.slug}`}>Inspect target <span>→</span></Link><Link className="text-link" href="/receipt/abc-l1">View receipt model <span>→</span></Link></div></div>
    <div className="next-action-card"><span className="micro-label">Recommended next action</span><strong>{hasRunStep ? "Inspect the staged event below" : "Record one bounded exploration step"}</strong><p id="next-action-help">{hasRunStep ? "The preview event is ready; the bundle checklist below now has its local prerequisite." : "This creates a local preview event only. It does not run Lean or submit work to the network."}</p><div className="next-action-controls"><button className="button button-primary focus-primary" type="button" disabled={!isRunning || hasRunStep} onClick={onRun}>{primaryLabel}</button><button className="workspace-pause-button" type="button" onClick={onToggleAgent}>{isRunning ? "Pause agent" : "Resume agent"}</button></div></div>
  </section>;
}

export function ResearchWorkstation({ events }: { events: WorkbenchEvent[] }) {
  return <section className="workstation-grid" aria-label="Research workstation">
    <article className="workstation-panel context-panel">
      <div className="workstation-heading"><span>01 / Goal &amp; context</span><span className="record-chip">Pinned</span></div>
      <h3>Prove the next reusable fact, not the whole theorem at once.</h3>
      <p className="context-statement">Explore a finite-density reduction that can become an accepted dependency of the imported Erdős 865 target.</p>
      <dl className="context-list"><div><dt>Target statement</dt><dd>Erdos865.erdos_865 · source revision 1</dd></div><div><dt>Accepted premises</dt><dd>A pinned set-theoretic statement and its Formal Conjectures environment</dd></div><div><dt>Public rationale</dt><dd>This branch narrows a single obstruction and may yield a reusable lemma.</dd></div></dl>
      <div className="context-footer"><span>{workbenchTarget.source}</span><span>{workbenchTarget.environment}</span></div>
    </article>
    <article className="workstation-panel source-panel">
      <div className="workstation-heading"><span>02 / Lean source &amp; check</span><span className="source-good">Example check result</span></div>
      <pre><code>{leanSource}</code></pre>
      <div className="diagnostic-box"><div><span className="check-dot" aria-hidden="true" />Preview compiler result</div><p>Illustrative only · 0 errors · 0 warnings · 0 occurrences of <code>sorry</code></p></div>
      <div className="source-meta"><span>lean4:preview</span><span>mathlib:preview</span><span>manifest:sha256:example</span></div>
    </article>
    <article className="workstation-panel run-panel">
      <div className="workstation-heading"><span>03 / Agent events &amp; artifacts</span><span className="record-chip">Structured</span></div>
      <p className="run-lede">Only publication-facing evidence appears here. Private chain-of-thought is never displayed.</p>
      <ol className="event-list" aria-live="polite">{events.map((event) => <li key={event.time + event.label}><time>{event.time}</time><span className={`event-dot ${event.kind}`} aria-hidden="true" /><div><strong>{event.label}</strong><p>{event.detail}</p></div></li>)}</ol>
      <p className="event-footer">Next: attach a real signed event and reproducible bundle when services are connected.</p>
    </article>
  </section>;
}

export function SubmissionReadiness({ hasRunStep, bundleStaged, onStageBundle }: { hasRunStep: boolean; bundleStaged: boolean; onStageBundle: () => void }) {
  return <section className="submission-section" aria-labelledby="submission-title">
    <div className="submission-copy"><p className="eyebrow">Evidence before credit</p><h2 id="submission-title">Prepare a bundle only when its checks are explicit.</h2><p>A future network submission will record a source diff, pinned environment, declared dependencies, and signed Agent event. It will not create a contribution receipt until an independent owner has reviewed it.</p></div>
    <div className="submission-card"><div className="submission-card-heading"><strong>Bundle readiness</strong><span>{hasRunStep ? "1 local prerequisite met" : "1 action required"}</span></div><ul className="gate-list"><GateRow state="preview" label="Pinned environment" detail="Preview manifest shows Lean, Mathlib, and dependency revisions" /><GateRow state="preview" label="No admitted proof" detail="Preview source scan contains no sorry declarations" /><GateRow state="preview" label="Axiom audit" detail="Example audit result; not yet connected to Lean" /><GateRow state={hasRunStep ? "preview" : "waiting"} label="Signed Agent event" detail={hasRunStep ? "Local event outline attached; signing service is not connected" : "Complete the primary action above to create a local event outline"} /><GateRow state="required" label="Independent review" detail="Must be performed by a different owner" /></ul><p className="submission-hint">{hasRunStep ? "You can now stage an outline for review. It remains local until the required services are connected." : "The outline button unlocks after the recommended bounded step above."}</p><button className="button button-primary submit-button" type="button" disabled={!hasRunStep} onClick={onStageBundle}>{bundleStaged ? "Bundle outline staged" : "Prepare bundle outline"}</button>{bundleStaged && <p className="bundle-note"><span aria-hidden="true">✓</span> Local preview staged a bundle outline. Network submission remains unavailable until the signing and verifier services are connected.</p>}</div>
  </section>;
}
