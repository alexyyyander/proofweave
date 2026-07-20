"use client";

import { useRef, useState } from "react";

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
  frontier?: boolean;
};

export function HistoryTimeline({ milestones }: { milestones: HistoryMilestone[] }) {
  const [activeNumber, setActiveNumber] = useState(milestones.at(-1)?.number ?? milestones[0]?.number);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

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
          <p className="eyebrow">Seven moments · four evidence states</p>
          <h2 id="timeline-title">Select a moment in the record.</h2>
        </div>
        <p>Each entry separates what the AI produced, what people contributed, and what evidence can be checked today.</p>
      </div>

      <div className="history-timeline-workspace">
        <div className="history-tablist" role="tablist" aria-label="AI mathematics milestones">
          {milestones.map((item, index) => {
            const isActive = item.number === activeNumber;
            return (
              <button
                aria-controls={`history-panel-${item.number}`}
                aria-selected={isActive}
                className={`history-tab${isActive ? " is-active" : ""}`}
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
                tabIndex={isActive ? 0 : -1}
                type="button"
              >
                <span className="history-tab-meta"><b>{item.number}</b><time>{item.date}</time>{item.frontier ? <em>Live</em> : null}</span>
                <strong>{item.title}</strong>
                <span className={`history-tab-evidence is-${item.evidenceTone}`}>{item.evidence}</span>
              </button>
            );
          })}
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

                {item.frontier ? <>
                  <div className="history-jacobian-proof"><div><span>CONSTANT JACOBIAN</span><strong>det JF = −2</strong></div><div><span>NON-INJECTIVITY</span><strong>3 inputs → (−¼, 0, 0)</strong></div></div>
                  <details className="history-jacobian-formula"><summary>Inspect the exact polynomial map <span aria-hidden="true">+</span></summary><div><code>F₁ = (1 + xy)³z + y²(1 + xy)(4 + 3xy)</code><code>F₂ = y + 3x(1 + xy)²z + 3xy²(4 + 3xy)</code><code>F₃ = 2x − 3x²y − x³z</code><p><strong>Collision:</strong> (0, 0, −¼), (1, −3/2, 13/2), and (−1, 3/2, 13/2) all map to (−¼, 0, 0).</p></div></details>
                </> : null}

                <dl className="history-role-grid"><div><dt>AI contribution</dt><dd>{item.aiRole}</dd></div><div><dt>Human contribution</dt><dd>{item.humanRole}</dd></div><div><dt>{item.frontier ? "Evidence today" : "Why it mattered"}</dt><dd>{item.significance}</dd></div></dl>

                {item.frontier ? <div className="history-frontier-boundary"><strong>What this does—and does not—establish</strong><p>The displayed algebraic claims can be checked now. The scholarly publication and attribution record are still forming, and the two-dimensional Jacobian Conjecture remains open.</p></div> : null}

                <footer>{item.sources.map((source) => <a href={source.href} key={source.href} rel="noreferrer" target="_blank">{source.label} <span aria-hidden="true">↗</span></a>)}</footer>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
