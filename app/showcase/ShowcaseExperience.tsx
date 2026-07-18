"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { BuildWeekDemoVerification, DemoJourneyStage } from "@/app/lib/build-week-demo";

type ShowcaseStage = {
  id: "frontier" | DemoJourneyStage["id"];
  number: string;
  kicker: string;
  title: string;
  detail: string;
  actor: string;
  evidence: string;
  state: string;
};

export function ShowcaseExperience({ verification }: { verification: BuildWeekDemoVerification }) {
  const stages = useMemo(() => buildStages(verification), [verification]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setReducedMotion(media.matches);
      if (media.matches) setIsPlaying(false);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isPlaying || reducedMotion) return;
    const timer = window.setTimeout(() => {
      setActiveIndex((current) => (current + 1) % stages.length);
    }, 5_400);
    return () => window.clearTimeout(timer);
  }, [activeIndex, isPlaying, reducedMotion, stages.length]);

  const activeStage = stages[activeIndex];
  const sourceLines = verification.record.source.split("\n").filter(Boolean).slice(0, 7);

  const selectStage = (index: number) => {
    setActiveIndex(index);
    setIsPlaying(false);
  };

  return (
    <section className="showcase-experience" id="proof-journey" aria-labelledby="showcase-journey-title">
      <div className="showcase-experience-topline">
        <div>
          <p className="eyebrow">One theorem · six evidence moments</p>
          <h2 id="showcase-journey-title">A contribution must carry its evidence.</h2>
        </div>
        <div className="showcase-playback-status" aria-live="polite">
          <i className={isPlaying ? "is-playing" : ""} aria-hidden="true" />
          <span>{reducedMotion ? "Motion reduced" : isPlaying ? "Story playing" : "Story paused"}</span>
        </div>
      </div>

      <div className="showcase-progress" aria-hidden="true">
        <span style={{ width: `${((activeIndex + 1) / stages.length) * 100}%` }} />
      </div>

      <div className="showcase-layout">
        <div className="showcase-visual-column">
          <div className="showcase-canvas" data-stage={activeStage.id} aria-hidden="true">
            <div className="showcase-grid-plane" />
            <div className="showcase-boundary showcase-boundary-local"><span>Private · this computer</span></div>
            <div className="showcase-boundary showcase-boundary-public"><span>Public · minimum evidence</span></div>

            <div className="showcase-person-node"><i /><span>Person</span></div>
            <div className="showcase-agent-node"><i>∴</i><span>Local Agent</span></div>
            <div className="showcase-review-node"><i>R</i><span>Different owner</span></div>

            <div className="showcase-evidence-line showcase-line-person" />
            <div className="showcase-evidence-line showcase-line-review" />

            <div className="showcase-paper-stack">
              <div className="showcase-paper-shadow showcase-paper-shadow-one" />
              <div className="showcase-paper-shadow showcase-paper-shadow-two" />
              <article className="showcase-proof-paper">
                <div className="showcase-paper-heading"><span>PW / LEAN EVIDENCE</span><i>{activeStage.number}</i></div>
                <div className="showcase-paper-title">{verification.record.target}</div>
                <div className="showcase-source-lines">
                  {sourceLines.map((line, index) => <span key={`${line}-${index}`} style={{ width: `${Math.max(42, 94 - index * 7)}%` }}>{line}</span>)}
                </div>
                <div className="showcase-branch-graph">
                  <i className="branch-line branch-line-a" /><i className="branch-line branch-line-b" /><i className="branch-line branch-line-c" /><i className="branch-line branch-line-d" />
                  <span className="branch-node branch-node-root" /><span className="branch-node branch-node-a" /><span className="branch-node branch-node-b" /><span className="branch-node branch-node-c" /><span className="branch-node branch-node-d" />
                </div>
                <div className="showcase-kernel-scan" />
                <div className="showcase-kernel-seal"><span>✓</span><small>Kernel accepted</small></div>
                <div className="showcase-bundle-band"><span>Signed bundle</span><code>{shortHash(verification.record.bundleHash)}</code></div>
              </article>
              <div className="showcase-review-copy"><span>Independent replay</span><i>✓</i></div>
            </div>

            <div className="showcase-receipt-card">
              <div><span>CONTRIBUTION RECEIPT</span><i>PW</i></div>
              <strong>Credited to Person</strong>
              <p>{verification.record.owner}</p>
              <code>{shortHash(verification.record.receiptHash)}</code>
              <small>Signed · reproducible · attributable</small>
            </div>
          </div>
          <p className="showcase-visual-caption"><span>Checked reference</span> The animation is driven by the same verified fixture used by the public Demo; live network evidence is shown separately above.</p>
        </div>

        <div className="showcase-story-column">
          <ol className="showcase-stage-rail" aria-label="Proof journey stages">
            {stages.map((stage, index) => (
              <li key={stage.id}>
                <button
                  type="button"
                  className={index === activeIndex ? "is-active" : index < activeIndex ? "is-complete" : ""}
                  aria-current={index === activeIndex ? "step" : undefined}
                  onClick={() => selectStage(index)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                      event.preventDefault();
                      selectStage((index + 1) % stages.length);
                    }
                    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                      event.preventDefault();
                      selectStage((index - 1 + stages.length) % stages.length);
                    }
                  }}
                >
                  <span>{stage.number}</span><strong>{stage.kicker}</strong><i aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>

          <article className="showcase-stage-copy" aria-live="polite">
            <div className="showcase-stage-label"><span>{activeStage.kicker}</span><strong>{activeStage.state}</strong></div>
            <p className="showcase-stage-index">Moment {activeStage.number}</p>
            <h3>{activeStage.title}</h3>
            <p>{activeStage.detail}</p>
            <dl>
              <div><dt>Actor</dt><dd>{activeStage.actor}</dd></div>
              <div><dt>Bound record</dt><dd><code>{shortHash(activeStage.evidence)}</code></dd></div>
            </dl>
            <div className="showcase-controls">
              <button type="button" aria-label="Previous moment" onClick={() => selectStage((activeIndex - 1 + stages.length) % stages.length)}>←</button>
              <button className="showcase-play-button" type="button" onClick={() => setIsPlaying((value) => !value)} disabled={reducedMotion}>
                {isPlaying ? "Pause story" : "Play story"}
              </button>
              <button type="button" aria-label="Next moment" onClick={() => selectStage((activeIndex + 1) % stages.length)}>→</button>
            </div>
            {activeStage.id === "receipt" && <div className="showcase-final-actions">
              <Link href="/demo#verification-console">Verify this Receipt <span>→</span></Link>
              <Link href="/start">Start with my Agent <span>→</span></Link>
            </div>}
          </article>
        </div>
      </div>
    </section>
  );
}

function buildStages(verification: BuildWeekDemoVerification): ShowcaseStage[] {
  const journey = new Map(verification.journey.map((stage) => [stage.id, stage]));
  const stage = (id: DemoJourneyStage["id"]) => {
    const result = journey.get(id);
    if (!result) throw new Error(`Missing showcase journey stage: ${id}`);
    return result;
  };

  const delegate = stage("delegate");
  const bundle = stage("bundle");
  const lean = stage("lean");
  const review = stage("review");
  const receipt = stage("receipt");

  return [
    {
      id: "frontier",
      number: "01",
      kicker: "Frontier question",
      title: "Begin with a target worth advancing.",
      detail: "Proofweave pins the mathematical declaration, repository snapshot and Lean environment before exploration begins. The public target stays stable while research branches evolve.",
      actor: "Public frontier catalog",
      evidence: verification.record.commitSha,
      state: "Source pinned",
    },
    fromJourney(delegate, "02", "Personal delegation", "Give one local Agent bounded authority."),
    fromJourney(bundle, "03", "Minimum evidence", "Select the reproducible work—not the private reasoning."),
    fromJourney(lean, "04", "Kernel replay", "Let Lean check the exact submitted workspace."),
    fromJourney(review, "05", "Independent review", "Replay the result from a genuinely different owner."),
    fromJourney(receipt, "06", "Durable attribution", "Credit the people whose work moved the proof forward."),
  ];
}

function fromJourney(stage: DemoJourneyStage, number: string, kicker: string, title: string): ShowcaseStage {
  return {
    id: stage.id,
    number,
    kicker,
    title,
    detail: stage.detail,
    actor: stage.actor,
    evidence: stage.evidence,
    state: stage.passed ? "Evidence passed" : "Evidence failed",
  };
}

function shortHash(value: string) {
  const normalized = value.replace(/^sha256:/, "");
  return `${normalized.slice(0, 10)}…${normalized.slice(-8)}`;
}
