"use client";

import { SectionTitle, Field, Button, CodeBlock, FieldList, Surface, PaperSurface } from "@/app/components/ui";

import Link from "next/link";
import { useMemo } from "react";

import { StepNavigation } from "@/app/components/navigation/StepNavigation";
import { useStepPlayback } from "@/app/hooks/useStepPlayback";
import { type BuildWeekDemoVerification, type DemoJourneyStage } from "@/app/lib/build-week-demo";
import styles from "./ShowcaseExperience.module.css";

type ShowcaseStage = {
  id: "frontier" | DemoJourneyStage["id"];
  number: string;
  kicker: string;
  title: string;
  detail: string;
  actor: string;
  evidence: string;
  state: string;
  passed: boolean;
};

const stepNames = ["Target", "Delegate", "Bundle", "Verify", "Review", "Receipt"];
const artifactNames = ["Pinned declaration", "Personal delegation", "Reproducible bundle", "Recorded Lean result", "Independent attestations", "Contribution receipt"];

export function ShowcaseExperience({ verification }: { verification: BuildWeekDemoVerification }) {
  const stages = useMemo(() => buildStages(verification), [verification]);
  const { activeIndex, isPlaying, reducedMotion, sectionRef, select: selectStage, toggle } = useStepPlayback(stages.length);
  const activeStage = stages[activeIndex];

  return (
    <section ref={sectionRef} className={styles.root} id="proof-journey" aria-labelledby="showcase-journey-title">
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">One theorem · six evidence moments</p>
          <SectionTitle id="showcase-journey-title">A contribution must carry its evidence.</SectionTitle>
        </div>
        <span className={styles.reference}>Signed reference · Lean {shortLeanVersion(verification.record.leanVersion)}</span>
      </header>
      <StepNavigation className={styles.steps} label="Proof journey stages"
        items={stages.map((stage, index) => ({ id: stage.id, number: stage.number, label: stepNames[index], accessibleLabel: stage.number + " " + stepNames[index] }))}
        activeIndex={activeIndex} onSelect={selectStage} />
      <div className={styles.exhibit}>
        <PaperSurface pageKey={activeStage.id} aria-label={artifactNames[activeIndex]}
          heading={artifactNames[activeIndex]}
          meta={<>{activeIndex === 0 ? ".lean" : "signed record"} <span className={styles.pageNumber}>{activeStage.number} / 06</span></>}
          bodyClassName={styles.scene}
          footer={<><span>{activeIndex === 0 ? "Git commit" : "Evidence fingerprint"}</span><code>{shortHash(activeStage.evidence)}</code></>}>
          <EvidenceScene stage={activeStage} verification={verification} />
        </PaperSurface>
        <div className={styles.narrative}>
          <Surface as="article" key={activeStage.id} className={styles.copy} aria-live={isPlaying ? "off" : "polite"}>
            <p className={styles.moment}>Moment {activeStage.number} / 06 <span>— {activeStage.kicker}</span></p>
            <SectionTitle as="h3">{activeStage.title}</SectionTitle>
            <p className={styles.detail}>{activeStage.detail}</p>
            <div className={styles.actor}><span>Actor</span><strong>{activeStage.actor}</strong></div>
            <p className={styles.verdict} data-passed={activeStage.passed}>
              <span aria-hidden="true">{activeStage.passed ? "✓" : "!"}</span>{activeStage.state}
            </p>
          </Surface>
          <div className={styles.controls}>
            <Button type="button" className={styles.play} disabled={reducedMotion} onClick={toggle}>
              <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▷"}</span>
              {reducedMotion ? "Manual exploration" : isPlaying ? "Pause story" : activeIndex === stages.length - 1 ? "Replay story" : "Play story"}
            </Button>
            <span className={styles.counter}>{activeStage.number} / 06</span>
            <Button type="button" aria-label="Previous moment" disabled={activeIndex === 0} onClick={() => selectStage(activeIndex - 1)}>←</Button>
            <Button type="button" aria-label="Next moment" disabled={activeIndex === stages.length - 1} onClick={() => selectStage(activeIndex + 1)}>→</Button>
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <p>Checked reference fixture. This story does not run Lean or publish work.</p>
        <div className={styles.actions}>
          <Link href="/demo#verification-console">Inspect the evidence <span aria-hidden="true">↗</span></Link>
          {activeStage.id === "receipt" && <Link href="/start">Start with my Agent <span aria-hidden="true">→</span></Link>}
        </div>
      </footer>
    </section>
  );
}

function EvidenceScene({ stage, verification }: { stage: ShowcaseStage; verification: BuildWeekDemoVerification }) {
  const record = verification.record;
  const checkIds: Record<ShowcaseStage["id"], string[]> = {
    frontier: [], delegate: ["delegation"], bundle: ["bundle", "objects"],
    lean: ["runner"], review: ["review"], receipt: ["receipt"],
  };
  return (
    <>
      {stage.id === "frontier" ? <>
        <p className={styles.sceneLabel}>The target stays fixed.</p>
        <h4 className={styles.target}>{record.target}</h4>
        <CodeBlock className={styles.source}><code>{record.source.trim().split("\n").filter((line) => line.trim()).join("\n")}</code></CodeBlock>
        <p className={styles.sceneNote}>Lean {shortLeanVersion(record.leanVersion)} · pinned repository snapshot</p>
      </> : stage.id === "delegate" ? <>
        <p className={styles.sceneLabel}>One person. One bounded delegation.</p>
        <div className={styles.handoff}>
          <div><span>Person</span><code>{record.owner}</code></div>
          <span className={styles.arrow} aria-hidden="true">→</span>
          <div><span>Local Agent</span><code>{record.agent}</code></div>
        </div>
        <FieldList className={styles.fields}><Field label="Granted scope">formalize · prove</Field><Field label="Boundary">Time-bounded, signed by the Person</Field></FieldList>
      </> : stage.id === "bundle" ? <>
        <p className={styles.sceneLabel}>A reproducible workspace, bound together.</p>
        <h4 className={styles.target}>{record.target}</h4>
        <FieldList className={styles.fields}>
          <Field label="Repository">{record.repository}</Field>
          <Field label="Commit"><code>{shortHash(record.commitSha)}</code></Field>
          <Field label="Environment">Lean {shortLeanVersion(record.leanVersion)}</Field>
          <Field label="Contents">Source · patch · Lake manifest</Field>
        </FieldList>
      </> : stage.id === "lean" ? <>
        <p className={styles.sceneLabel}>The exact workspace. The recorded result.</p>
        <div className={styles.result} data-passed={stage.passed}>
          <span aria-hidden="true">{stage.passed ? "✓" : "!"}</span>
          <div><h4>{stage.passed ? "Kernel accepted" : "Result verification failed"}</h4><p>Lean {shortLeanVersion(record.leanVersion)} · signed historical run</p></div>
        </div>
        <FieldList className={styles.fields}><Field label="Target">{record.target}</Field><Field label="Replay">Recorded local execution; Lean is not rerun here.</Field></FieldList>
      </> : stage.id === "review" ? <>
        <p className={styles.sceneLabel}>Different owners. Independently signed claims.</p>
        <FieldList className={styles.fields}>
          <Field label="Researcher"><code>{record.owner}</code></Field>
          {record.reviewers.map((owner, index) => <div key={owner}><dt>Reviewer {index + 1}</dt><dd><code>{owner}</code></dd></div>)}
        </FieldList>
        <p className={styles.sceneNote}>Demo accounts are simulated; protocol signatures are real.</p>
      </> : <>
        <p className={styles.sceneLabel}>The evidence becomes an attributable record.</p>
        <div className={styles.result} data-passed={stage.passed}>
          <span aria-hidden="true">{stage.passed ? "✓" : "!"}</span>
          <div><h4>{stage.passed ? "Contribution recorded" : "Receipt verification failed"}</h4><p>{record.owner}</p></div>
        </div>
        <FieldList className={styles.fields}><Field label="Target">{record.target}</Field><Field label="Bound bundle"><code>{shortHash(record.bundleHash)}</code></Field><Field label="Attribution">Person · Agent · independent review owners</Field></FieldList>
      </>}
      {verification.checks.filter((check) => checkIds[stage.id].includes(check.id)).map((check) => (
        <p className={styles.check} data-passed={check.passed} key={check.id}>
          <span aria-hidden="true">{check.passed ? "✓" : "!"}</span>{check.result}
        </p>
      ))}
    </>
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
      passed: true,
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
    passed: stage.passed,
  };
}

function shortHash(value: string) {
  const normalized = value.replace(/^sha256:/, "");
  return `${normalized.slice(0, 10)}…${normalized.slice(-8)}`;
}

function shortLeanVersion(value: string) {
  return value.match(/Lean \(version ([^,]+)/)?.[1] ?? value;
}
