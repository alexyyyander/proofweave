"use client";

import { useLayoutEffect, useRef, useState } from "react";
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(16);
  const [viewportWidth, setViewportWidth] = useState(1120);
  const centerRef = useRef(timelinePosition(milestones.at(-1)?.timelineDate ?? "2026-09-01") / 100);
  const dragRef = useRef<{ pointerId: number; x: number; scrollLeft: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);
  const canvasWidth = Math.max(viewportWidth, 640) * zoom;
  const layout = distributeTimelineLabels(milestones, canvasWidth);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setViewportWidth(viewport.clientWidth));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = centerRef.current * canvasWidth - viewport.clientWidth / 2;
  }, [canvasWidth]);

  function changeZoom(value: number, center?: number) {
    const viewport = viewportRef.current;
    centerRef.current = center ?? (viewport ? (viewport.scrollLeft + viewport.clientWidth / 2) / canvasWidth : centerRef.current);
    const nextZoom = Math.max(1, Math.min(32, value));
    setZoom(nextZoom);
    if (nextZoom === zoom && viewport) viewport.scrollLeft = centerRef.current * canvasWidth - viewport.clientWidth / 2;
  }

  function recentDays() {
    changeZoom(16, timelinePosition(milestones.at(-1)?.timelineDate ?? "2026-09-01") / 100);
  }
  const tracksIn = (lane: HistoryMilestone["timelineLane"]) => Math.max(2, ...layout.filter(({ item }) => item.timelineLane === lane).map(({ timelineTrack }) => timelineTrack + 1));
  const aboveTracks = tracksIn("above");
  const belowTracks = tracksIn("below");
  const nodeClearance = Math.max(0, ...layout.map(({ timelineNodeOffset }) => Math.abs(timelineNodeOffset)));

  function focusTab(index: number) {
    const nextIndex = (index + milestones.length) % milestones.length;
    const next = milestones[nextIndex];
    if (!next) return;
    setActiveNumber(next.number);
    const tab = tabRefs.current[nextIndex];
    tab?.focus({ preventScroll: true });
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollLeft = timelinePosition(next.timelineDate) / 100 * canvasWidth - viewport.clientWidth / 2;
  }

  return (
    <section className="history-timeline" id="timeline" aria-labelledby="timeline-title">
      <div className="history-timeline-heading">
        <div>
          <p className="eyebrow">{milestones.length} moments · one accelerating frontier</p>
          <h2 id="timeline-title">Follow the record across 2026.</h2>
        </div>
        <p>Zoom in to separate busy days. Drag the timeline or swipe sideways to explore. Records from the same day stay stacked; month-only records sit at mid-month.</p>
      </div>

      <div className="history-timeline-controls" aria-label="Timeline controls">
        <div className="history-timeline-presets">
          <button type="button" onClick={() => changeZoom(1, .5)}>Full record</button>
          <button type="button" onClick={recentDays}>Recent days</button>
        </div>
        <div className="history-timeline-zoom">
          <button type="button" aria-label="Zoom out timeline" disabled={zoom === 1} onClick={() => changeZoom(Math.max(1, Math.round(zoom / 1.5)))}>−</button>
          <label htmlFor="history-zoom">Zoom</label>
          <input id="history-zoom" type="range" min="1" max="32" step="1" value={zoom} aria-valuetext={`${zoom} times`} onChange={(event) => changeZoom(Number(event.target.value))} />
          <output htmlFor="history-zoom">{zoom}×</output>
          <button type="button" aria-label="Zoom in timeline" disabled={zoom === 32} onClick={() => changeZoom(Math.min(32, Math.ceil(zoom * 1.5)))}>+</button>
        </div>
        <div className="history-timeline-pan">
          <button type="button" aria-label="Earlier dates" onClick={() => viewportRef.current?.scrollBy({ left: -viewportWidth * .7 })}>←</button>
          <button type="button" aria-label="Later dates" onClick={() => viewportRef.current?.scrollBy({ left: viewportWidth * .7 })}>→</button>
        </div>
      </div>
      <div
        className={`history-timeline-viewport${dragging ? " is-dragging" : ""}`}
        ref={viewportRef}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: event.currentTarget.scrollLeft, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId || event.buttons !== 1) return;
          const distance = event.clientX - drag.x;
          if (!drag.moved && Math.abs(distance) < 5) return;
          drag.moved = true;
          setDragging(true);
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.scrollLeft = drag.scrollLeft - distance;
        }}
        onPointerUp={() => { setDragging(false); }}
        onPointerCancel={() => { dragRef.current = null; setDragging(false); }}
        onLostPointerCapture={() => setDragging(false)}
        onClickCapture={(event) => {
          if (event.detail !== 0 && dragRef.current?.moved) { event.preventDefault(); event.stopPropagation(); }
          dragRef.current = null;
        }}
        onScroll={(event) => { centerRef.current = (event.currentTarget.scrollLeft + event.currentTarget.clientWidth / 2) / canvasWidth; }}
      >
        <div className="history-time-visual" role="tablist" aria-label="AI mathematics milestones from January to September 2026" style={{ width: `${canvasWidth}px`, "--timeline-axis-y": `${84 + nodeClearance + aboveTracks * 80}px`, "--timeline-node-clearance": `${nodeClearance}px`, height: `${168 + 2 * nodeClearance + (aboveTracks + belowTracks) * 80}px` } as CSSProperties}>
          <div className="history-time-axis" aria-hidden="true">{timelineTicks(zoom).map(({ label, date }) => <span key={date} style={{ left: `${timelinePosition(date)}%` }}>{label}</span>)}</div>
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

function distributeTimelineLabels(milestones: HistoryMilestone[], width: number) {
  const lastPositions: Record<HistoryMilestone["timelineLane"], number[]> = { above: [], below: [] };
  const lastNodePositions: number[] = [];
  const minimumGap = 188 / width * 100;
  const minimumNodeGap = 48 / width * 100;

  return milestones.map((item) => {
    const position = timelinePosition(item.timelineDate);
    const tracks = lastPositions[item.timelineLane];
    let timelineTrack = tracks.findIndex((lastPosition) => position - lastPosition >= minimumGap);
    if (timelineTrack === -1) timelineTrack = tracks.length;
    tracks[timelineTrack] = position;
    let nodeTrack = lastNodePositions.findIndex((lastPosition) => position - lastPosition >= minimumNodeGap);
    if (nodeTrack === -1) nodeTrack = lastNodePositions.length;
    lastNodePositions[nodeTrack] = position;
    const timelineNodeOffset = nodeTrack === 0 ? 0 : nodeTrack % 2 === 1 ? -48 * Math.ceil(nodeTrack / 2) : 48 * Math.ceil(nodeTrack / 2);
    return { item, timelineNodeOffset, timelineTrack };
  });
}

function timelinePosition(date: string) {
  const start = Date.parse("2026-01-01T00:00:00Z");
  const end = Date.parse("2026-09-30T00:00:00Z");
  return 2 + 96 * (Date.parse(`${date}T00:00:00Z`) - start) / (end - start);
}

function timelineTicks(zoom: number) {
  const ticks: Array<{ date: string; label: string }> = [];
  const step = zoom >= 12 ? 1 : zoom >= 4 ? 7 : 0;
  const formatter = new Intl.DateTimeFormat("en", { month: "short", ...(step ? { day: "numeric" } as const : {}), timeZone: "UTC" });
  for (let day = new Date("2026-01-01T00:00:00Z"); day <= new Date("2026-09-30T00:00:00Z");) {
    ticks.push({ date: day.toISOString().slice(0, 10), label: formatter.format(day).toUpperCase() });
    if (step) day.setUTCDate(day.getUTCDate() + step);
    else day.setUTCMonth(day.getUTCMonth() + 1);
  }
  return ticks;
}
