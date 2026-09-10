"use client";

import { useRef, useState } from "react";
import type { CSSProperties } from "react";

export type EvidenceTone = "formal" | "reviewed" | "reproduced" | "announced";

export type HistoryMilestone = {
  number: string;
  date: string;
  title: string;
  system: string;
  summary: string;
  aiRole: string;
  humanRole: string;
  evidence: string;
  evidenceTone: EvidenceTone;
  significance: string;
  sources: Array<{ label: string; href: string }>;
  reproduction?: {
    label: string;
    detail: string;
    href: string;
    workspaceHref?: string;
    workspaceLabel?: string;
    command?: string;
  };
  frontier?: boolean;
  boundary?: string;
  latest?: boolean;
  special?: "jacobian" | "openai-ten" | "riemann";
  shortTitle: string;
  timelineDate: string;
  timelineLane: "above" | "below";
};

export function HistoryTimeline({ milestones }: { milestones: HistoryMilestone[] }) {
  const [activeNumber, setActiveNumber] = useState(milestones.at(-1)?.number ?? milestones[0]?.number);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const layout = distributeTimelineLabels(milestones);
  const tracksIn = (lane: HistoryMilestone["timelineLane"]) => Math.max(2, ...layout.filter(({ item }) => item.timelineLane === lane).map(({ timelineTrack }) => timelineTrack + 1));
  const aboveTracks = tracksIn("above");
  const belowTracks = tracksIn("below");
  const nodeClearance = Math.max(0, ...layout.map(({ timelineNodeOffset }) => Math.abs(timelineNodeOffset)));

  function focusTab(index: number) {
    const nextIndex = (index + milestones.length) % milestones.length;
    const next = milestones[nextIndex];
    if (!next) return;
    setActiveNumber(next.number);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <section className="history-timeline" id="timeline" aria-labelledby="timeline-title">
      <div className="history-timeline-heading">
        <div>
          <p className="eyebrow">{milestones.length} moments · one accelerating frontier</p>
          <h2 id="timeline-title">Follow the record across 2026.</h2>
        </div>
        <p>Spacing follows publication or announcement time. Clustered nodes show activity accelerating—not stronger evidence. Month-only records sit at mid-month.</p>
      </div>

      <div className="history-timeline-viewport">
        <div className="history-time-visual" role="tablist" aria-label="AI mathematics milestones from January to September 2026" style={{ "--timeline-axis-y": `${84 + nodeClearance + aboveTracks * 58}px`, "--timeline-node-clearance": `${nodeClearance}px`, height: `${168 + 2 * nodeClearance + (aboveTracks + belowTracks) * 58}px` } as CSSProperties}>
          <div className="history-time-axis" aria-hidden="true">{[{ label: "JAN", date: "2026-01-01" }, { label: "MAR", date: "2026-03-01" }, { label: "MAY", date: "2026-05-01" }, { label: "JUL", date: "2026-07-01" }, { label: "SEP", date: "2026-09-01" }].map(({ label, date }) => <span key={label} style={{ left: `${timelinePosition(date)}%` }}>{label}</span>)}</div>
          {layout.map(({ item, timelineTrack, timelineNodeOffset }, index) => {
              const isActive = item.number === activeNumber;
              const position = timelinePosition(item.timelineDate);
              const edgeClass = position >= 94 ? " is-edge-end" : position <= 6 ? " is-edge-start" : "";
              const nodeClass = timelineNodeOffset < 0 ? " is-node-above" : timelineNodeOffset > 0 ? " is-node-below" : "";
              return (
                <button
                  aria-controls={`history-panel-${item.number}`}
                  aria-label={`${item.date}: ${item.title}. ${item.evidence}`}
                  aria-selected={isActive}
                  className={`history-timepoint is-${item.timelineLane} tone-${item.evidenceTone}${isActive ? " is-active" : ""}${item.latest ? " is-latest" : ""}${edgeClass}${nodeClass}`}
                  id={`history-tab-${item.number}`}
                  key={item.number}
                  onClick={() => setActiveNumber(item.number)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                      event.preventDefault();
                      focusTab(index + 1);
                    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
                      event.preventDefault();
                      focusTab(index - 1);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      focusTab(0);
                    } else if (event.key === "End") {
                      event.preventDefault();
                      focusTab(milestones.length - 1);
                    }
                  }}
                  ref={(element) => { tabRefs.current[index] = element; }}
                  role="tab"
                  style={{
                    "--timeline-label-track": timelineTrack,
                    "--timeline-node-bridge": `${Math.max(Math.abs(timelineNodeOffset) - 18, 0)}px`,
                    "--timeline-node-offset": `${timelineNodeOffset}px`,
                    left: `${position}%`,
                  } as CSSProperties}
                  tabIndex={isActive ? 0 : -1}
                  type="button"
                >
                  <span className="history-timepoint-copy"><time dateTime={item.timelineDate}>{item.date}</time><strong>{item.shortTitle}</strong>{item.latest ? <em>Latest entry</em> : null}</span>
                  <span className="history-timepoint-node"><b>{item.number}</b></span>
                </button>
              );
            })}
        </div>
      </div>

      <div className="history-panels">
          {milestones.map((item) => {
            const isActive = item.number === activeNumber;
            return (
              <article
                aria-labelledby={`history-tab-${item.number}`}
                className={`history-panel${item.frontier ? " is-frontier" : ""}`}
                hidden={!isActive}
                id={`history-panel-${item.number}`}
                key={item.number}
                role="tabpanel"
                tabIndex={0}
              >
                <header>
                  <div><p className="history-system">{item.system}</p><h3>{item.title}</h3></div>
                  <span className={`history-state is-${item.evidenceTone}`}>{item.evidence}</span>
                </header>
                <p className="history-entry-summary">{item.summary}</p>

                {item.special === "jacobian" ? <>
                  <div className="history-jacobian-proof"><div><span>CONSTANT JACOBIAN</span><strong>det JF = −2</strong></div><div><span>NON-INJECTIVITY</span><strong>3 inputs → (−¼, 0, 0)</strong></div></div>
                  <details className="history-jacobian-formula"><summary>Inspect the exact polynomial map <span aria-hidden="true">+</span></summary><div><code>F₁ = (1 + xy)³z + y²(1 + xy)(4 + 3xy)</code><code>F₂ = y + 3x(1 + xy)²z + 3xy²(4 + 3xy)</code><code>F₃ = 2x − 3x²y − x³z</code><p><strong>Collision:</strong> (0, 0, −¼), (1, −3/2, 13/2), and (−1, 3/2, 13/2) all map to (−¼, 0, 0).</p></div></details>
                </> : item.special === "openai-ten" ? <div className="history-ten-proofs"><div><span>PORTFOLIO</span><strong>10 results</strong></div><div><span>PUBLIC ARTIFACT</span><strong>Lean 4 modules</strong></div><details><summary>Show the ten result areas <span aria-hidden="true">+</span></summary><ol><li>Sphere packing</li><li>Binary and spherical codes</li><li>Non-sofic groups</li><li>Connes&apos;s rigidity</li><li>Arithmetic circuit complexity</li><li>Quantum parallel repetition</li><li>Closest vector problem</li><li>Ehrhart&apos;s volume conjecture</li><li>Multicolor Ramsey numbers</li><li>Extremal number conjectures</li></ol></details></div> : item.special === "riemann" ? <div className="history-riemann-proof"><div><span>KNOWN LOWER BOUND</span><strong>41.6% → 67.2%</strong></div><div><span>RH ITSELF</span><strong>Not proved</strong></div></div> : null}

                {item.reproduction ? <div className="history-reproduction-inline"><div><span className="history-reproduction-label">Lean replay path</span><strong>{item.reproduction.label}</strong><p>{item.reproduction.detail}</p>{item.reproduction.command ? <code>{item.reproduction.command}</code> : null}</div><div className="history-reproduction-links"><a href={item.reproduction.href} rel="noreferrer" target="_blank">Open artifact <span aria-hidden="true">↗</span></a>{item.reproduction.workspaceHref && item.reproduction.workspaceLabel ? <a href={item.reproduction.workspaceHref}>{item.reproduction.workspaceLabel} <span aria-hidden="true">→</span></a> : null}</div></div> : null}

                <dl className="history-role-grid"><div><dt>AI contribution</dt><dd>{item.aiRole}</dd></div><div><dt>Human contribution</dt><dd>{item.humanRole}</dd></div><div><dt>{item.frontier ? "Evidence today" : "Why it mattered"}</dt><dd>{item.significance}</dd></div></dl>

                {item.frontier ? <div className="history-frontier-boundary"><strong>What this does—and does not—establish</strong><p>{item.boundary ?? (item.special === "riemann" ? "This improves a lower bound for a related zeta-zero problem. It does not prove or disprove the Riemann Hypothesis; the formal artifact is public, while a Proofweave replay receipt is still pending." : "The displayed algebraic claims can be checked now. The scholarly publication and attribution record are still forming, and the two-dimensional Jacobian Conjecture remains open.")}</p></div> : null}

                <footer>{item.sources.map((source) => <a href={source.href} key={source.href} rel="noreferrer" target="_blank">{source.label} <span aria-hidden="true">↗</span></a>)}</footer>
              </article>
            );
          })}
      </div>
    </section>
  );
}

function distributeTimelineLabels(milestones: HistoryMilestone[]) {
  const lastPositions: Record<HistoryMilestone["timelineLane"], number[]> = { above: [], below: [] };
  const lastNodePositions: number[] = [];
  const minimumGap = 12;
  const minimumNodeGap = 3.6;

  return milestones.map((item) => {
    const position = timelinePosition(item.timelineDate);
    const tracks = lastPositions[item.timelineLane];
    let timelineTrack = tracks.findIndex((lastPosition) => position - lastPosition >= minimumGap);
    if (timelineTrack === -1) timelineTrack = tracks.length;
    tracks[timelineTrack] = position;
    let nodeTrack = lastNodePositions.findIndex((lastPosition) => position - lastPosition >= minimumNodeGap);
    if (nodeTrack === -1) nodeTrack = lastNodePositions.length;
    lastNodePositions[nodeTrack] = position;
    const timelineNodeOffset = nodeTrack === 0 ? 0 : nodeTrack % 2 === 1 ? -36 * Math.ceil(nodeTrack / 2) : 36 * Math.ceil(nodeTrack / 2);
    return { item, timelineNodeOffset, timelineTrack };
  });
}

function timelinePosition(date: string) {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const end = Date.parse("2026-09-30T00:00:00Z");
  return 2 + 96 * (Date.parse(`${date}T00:00:00Z`) - start) / (end - start);
}
