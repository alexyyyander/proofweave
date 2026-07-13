"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { projects } from "../lib/content";

type Gate = "passed" | "waiting" | "required" | "preview";

const target = projects[0];
const leanSource = ["lemma height_auxiliary_bound", "    (a b c : ℕ) (h : a + b = c)", "    (coprime : Nat.Coprime a b) :", "    True := by", "  trivial"].join("\n");

const initialEvents = [
  { time: "09:42", label: "Pinned research bundle", detail: "Lean 4, Mathlib revision, and target statement are fixed for branch B-07.", kind: "evidence" },
  { time: "09:44", label: "Opened proof branch B-07", detail: "Branch inherits the accepted statement and declared dependencies only.", kind: "branch" },
  { time: "09:46", label: "Preview source scan", detail: "Illustrative compiler and source-scan output is shown until a Lean runtime is connected.", kind: "check" },
];

function GateRow({ state, label, detail }: { state: Gate; label: string; detail: string }) {
  const stateText = state === "passed" ? "Ready" : state === "waiting" ? "Awaiting run" : state === "preview" ? "Preview only" : "Independent";
  const symbol = state === "passed" ? "✓" : state === "waiting" ? "·" : state === "preview" ? "◇" : "↗";
  return <li className={`gate-row gate-${state}`}><span className="gate-icon" aria-hidden="true">{symbol}</span><span><strong>{label}</strong><small>{detail}</small></span><em>{stateText}</em></li>;
}

export function WorkbenchClient() {
  const [isRunning, setIsRunning] = useState(true);
  const [hasRunStep, setHasRunStep] = useState(false);
  const [bundleStaged, setBundleStaged] = useState(false);
  const events = useMemo(() => hasRunStep ? [
    ...initialEvents,
    { time: "09:48", label: "Bounded exploration preview", detail: "A publication-facing branch note and local event outline are ready for inspection.", kind: "evidence" },
  ] : initialEvents, [hasRunStep]);

  const runBoundedStep = () => {
    if (!isRunning) return;
    setHasRunStep(true);
    setBundleStaged(false);
  };

  return (
    <>
      <section className="workbench-hero" aria-labelledby="workbench-title">
        <div>
          <p className="eyebrow">Personal workspace <span className="preview-marker">Local preview</span></p>
          <h1 id="workbench-title">Your research agent</h1>
          <p>Supervise a bounded proof branch, inspect its evidence, and prepare an artifact bundle for independent verification.</p>
        </div>
        <div className="agent-identity-card">
          <div className="agent-identity-top"><span className={isRunning ? "agent-live" : "agent-paused"}><i aria-hidden="true" />{isRunning ? "Running" : "Paused"}</span><span className="record-chip">Delegation active</span></div>
          <strong>your-research-agent</strong>
          <code>urn:pw:agent:your-research-agent</code>
          <span>Owner&nbsp; <code>did:proofweave:you</code></span>
        </div>
      </section>

      <section className="delegation-summary" aria-label="Delegation certificate">
        <div className="delegation-title"><span className="micro-label">Active delegation</span><strong>pw:delegation:preview:agent-01</strong><small>Key fingerprint · ed25519:7f9a…e120</small></div>
        <div><span className="micro-label">Allowed work</span><p className="scope-list"><b>Formalize</b><b>Prove</b><b>Review</b></p></div>
        <div><span className="micro-label">Valid until</span><strong>13 Jul 2027</strong><small>Revocable by owner</small></div>
        <button className="quiet-action" type="button" onClick={() => setIsRunning(false)}>Pause delegation</button>
      </section>

      <section className="workbench-toolbar" aria-label="Current research focus">
        <div><span className="micro-label">Current focus</span><h2>{target.title}</h2><p>Branch B-07 · auxiliary height inequality</p></div>
        <div className="toolbar-links"><Link className="text-link" href={`/explore/${target.slug}`}>Inspect target <span>→</span></Link><Link className="text-link" href="/receipt/abc-l1">View receipt model <span>→</span></Link></div>
      </section>

      <section className="workstation-grid" aria-label="Research workstation">
        <article className="workstation-panel context-panel">
          <div className="workstation-heading"><span>01 / Goal &amp; context</span><span className="record-chip">Pinned</span></div>
          <h3>Prove the next reusable fact, not the whole theorem at once.</h3>
          <p className="context-statement">Establish a height inequality that can become an accepted dependency of the open abc-type branch.</p>
          <dl className="context-list">
            <div><dt>Target statement</dt><dd>abc_height_bound · revision 17</dd></div>
            <div><dt>Accepted premises</dt><dd>coprimality, positivity, and a pinned radical definition</dd></div>
            <div><dt>Public rationale</dt><dd>This branch narrows a single obstruction and may yield a reusable lemma.</dd></div>
          </dl>
          <div className="context-footer"><span>{target.source}</span><span>{target.environment}</span></div>
        </article>

        <article className="workstation-panel source-panel">
          <div className="workstation-heading"><span>02 / Lean source &amp; check</span><span className="source-good">Example check result</span></div>
          <pre><code>{leanSource}</code></pre>
          <div className="diagnostic-box"><div><span className="check-dot" aria-hidden="true" />Preview compiler result</div><p>Illustrative only · 0 errors · 0 warnings · 0 occurrences of <code>sorry</code></p></div>
          <div className="source-meta"><span>lean4:preview</span><span>mathlib:preview</span><span>manifest:sha256:example</span></div>
        </article>

        <article className="workstation-panel run-panel">
          <div className="workstation-heading"><span>03 / Agent run &amp; artifacts</span><span className="record-chip">Structured events</span></div>
          <p className="run-lede">The workbench exposes evidence and publication-facing notes, not private chain-of-thought.</p>
          <ol className="event-list">
            {events.map((event) => <li key={event.time + event.label}><time>{event.time}</time><span className={`event-dot ${event.kind}`} aria-hidden="true" /><div><strong>{event.label}</strong><p>{event.detail}</p></div></li>)}
          </ol>
          <div className="run-controls">
            <button className="button button-secondary" type="button" onClick={() => setIsRunning((value) => !value)}>{isRunning ? "Pause agent" : "Resume agent"}</button>
            <button className="button button-primary" type="button" disabled={!isRunning || hasRunStep} onClick={runBoundedStep}>{hasRunStep ? "Bounded step recorded" : "Run next bounded step"}</button>
          </div>
        </article>
      </section>

      <section className="submission-section" aria-labelledby="submission-title">
        <div className="submission-copy"><p className="eyebrow">Evidence before credit</p><h2 id="submission-title">Prepare a bundle only when its checks are explicit.</h2><p>A future network submission will record a source diff, pinned environment, declared dependencies, and signed Agent event. It will not create a contribution receipt until an independent owner has reviewed it.</p></div>
        <div className="submission-card">
          <ul className="gate-list">
            <GateRow state="preview" label="Pinned environment" detail="Preview manifest shows Lean, Mathlib, and dependency revisions" />
            <GateRow state="preview" label="No admitted proof" detail="Preview source scan contains no sorry declarations" />
            <GateRow state="preview" label="Axiom audit" detail="Example audit result; not yet connected to Lean" />
            <GateRow state={hasRunStep ? "preview" : "waiting"} label="Signed Agent event" detail={hasRunStep ? "Local event outline attached; signing service is not connected" : "Run one bounded step to create a local event outline"} />
            <GateRow state="required" label="Independent review" detail="Must be performed by a different owner" />
          </ul>
          <button className="button button-primary submit-button" type="button" disabled={!hasRunStep} onClick={() => setBundleStaged(true)}>{bundleStaged ? "Bundle outline staged" : "Prepare bundle outline"}</button>
          {bundleStaged && <p className="bundle-note"><span aria-hidden="true">✓</span> Local preview staged a bundle outline. Network submission remains unavailable until the signing and verifier services are connected.</p>}
        </div>
      </section>
    </>
  );
}
