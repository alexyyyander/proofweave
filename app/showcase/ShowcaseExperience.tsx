"use client";

import { SectionTitle, Field, Button, CodeBlock, FieldList, Surface, PaperSurface } from "@/app/components/ui";

import Link from "next/link";
import { useMemo } from "react";

import { StepNavigation } from "@/app/components/navigation/StepNavigation";
import { useStepPlayback } from "@/app/hooks/useStepPlayback";
import { type BuildWeekDemoVerification, type DemoJourneyStage } from "@/app/lib/build-week-demo";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
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

const stepKeys: readonly TranslationKey[] = ["showcase.step.target", "showcase.step.delegate", "showcase.step.bundle", "showcase.step.verify", "showcase.step.review", "showcase.step.receipt"];
const artifactKeys: readonly TranslationKey[] = ["showcase.artifact.target", "showcase.artifact.delegate", "showcase.artifact.bundle", "showcase.artifact.lean", "showcase.artifact.review", "showcase.artifact.receipt"];

const journeyCopy: Record<DemoJourneyStage["id"], { kicker: TranslationKey; title: TranslationKey; detail: TranslationKey; actor: TranslationKey }> = {
  delegate: { kicker: "showcase.stage.delegate.kicker", title: "showcase.stage.delegate.title", detail: "showcase.stage.delegate.detail", actor: "showcase.stage.delegate.actor" },
  bundle: { kicker: "showcase.stage.bundle.kicker", title: "showcase.stage.bundle.title", detail: "showcase.stage.bundle.detail", actor: "showcase.stage.bundle.actor" },
  lean: { kicker: "showcase.stage.lean.kicker", title: "showcase.stage.lean.title", detail: "showcase.stage.lean.detail", actor: "showcase.stage.lean.actor" },
  review: { kicker: "showcase.stage.review.kicker", title: "showcase.stage.review.title", detail: "showcase.stage.review.detail", actor: "showcase.stage.review.actor" },
  receipt: { kicker: "showcase.stage.receipt.kicker", title: "showcase.stage.receipt.title", detail: "showcase.stage.receipt.detail", actor: "showcase.stage.receipt.actor" },
};

export function ShowcaseExperience({ verification }: { verification: BuildWeekDemoVerification }) {
  const { t } = useI18n();
  const stages = useMemo(() => buildStages(verification, t), [verification, t]);
  const { activeIndex, isPlaying, reducedMotion, sectionRef, select: selectStage, toggle } = useStepPlayback(stages.length);
  const activeStage = stages[activeIndex];
  const activeArtifact = t(artifactKeys[activeIndex]);

  return (
    <section ref={sectionRef} className={styles.root} id="proof-journey" aria-labelledby="showcase-journey-title">
      <header className={styles.heading}>
        <div>
          <p className="eyebrow">{t("showcase.eyebrow")}</p>
          <SectionTitle id="showcase-journey-title">{t("showcase.title")}</SectionTitle>
        </div>
        <span className={styles.reference}>{t("showcase.reference", { version: shortLeanVersion(verification.record.leanVersion) })}</span>
      </header>
      <StepNavigation className={styles.steps} label={t("showcase.stepsAria")}
        items={stages.map((stage, index) => ({ id: stage.id, number: stage.number, label: t(stepKeys[index]), accessibleLabel: stage.number + " " + t(stepKeys[index]) }))}
        activeIndex={activeIndex} onSelect={selectStage} />
      <div className={styles.exhibit}>
        <PaperSurface pageKey={activeStage.id} aria-label={activeArtifact}
          heading={activeArtifact}
          meta={<>{activeIndex === 0 ? t("showcase.meta.lean") : t("showcase.meta.signed")} <span className={styles.pageNumber}>{t("showcase.pageNumber", { current: activeStage.number })}</span></>}
          bodyClassName={styles.scene}
          footer={<><span>{activeIndex === 0 ? t("showcase.footer.gitCommit") : t("showcase.footer.fingerprint")}</span><code>{shortHash(activeStage.evidence)}</code></>}>
          <EvidenceScene stage={activeStage} verification={verification} />
        </PaperSurface>
        <div className={styles.narrative}>
          <Surface as="article" key={activeStage.id} className={styles.copy} aria-live={isPlaying ? "off" : "polite"}>
            <p className={styles.moment}>{t("showcase.moment", { number: activeStage.number })} <span>— {activeStage.kicker}</span></p>
            <SectionTitle as="h3">{activeStage.title}</SectionTitle>
            <p className={styles.detail}>{activeStage.detail}</p>
            <div className={styles.actor}><span>{t("showcase.actorLabel")}</span><strong>{activeStage.actor}</strong></div>
            <p className={styles.verdict} data-passed={activeStage.passed}>
              <span aria-hidden="true">{activeStage.passed ? "✓" : "!"}</span>{activeStage.state}
            </p>
          </Surface>
          <div className={styles.controls}>
            <Button type="button" className={styles.play} disabled={reducedMotion} onClick={toggle}>
              <span aria-hidden="true">{isPlaying ? "Ⅱ" : "▷"}</span>
              {reducedMotion
                ? t("showcase.controls.manual")
                : isPlaying
                  ? t("showcase.controls.pause")
                  : activeIndex === stages.length - 1
                    ? t("showcase.controls.replay")
                    : t("showcase.controls.play")}
            </Button>
            <span className={styles.counter}>{t("showcase.pageNumber", { current: activeStage.number })}</span>
            <Button type="button" aria-label={t("showcase.controls.previous")} disabled={activeIndex === 0} onClick={() => selectStage(activeIndex - 1)}>←</Button>
            <Button type="button" aria-label={t("showcase.controls.next")} disabled={activeIndex === stages.length - 1} onClick={() => selectStage(activeIndex + 1)}>→</Button>
          </div>
        </div>
      </div>
      <footer className={styles.footer}>
        <p>{t("showcase.footer.note")}</p>
        <div className={styles.actions}>
          <Link href="/demo#verification-console">{t("showcase.footer.inspect")} <span aria-hidden="true">↗</span></Link>
          {activeStage.id === "receipt" && <Link href="/start">{t("showcase.footer.start")} <span aria-hidden="true">→</span></Link>}
        </div>
      </footer>
    </section>
  );
}

function EvidenceScene({ stage, verification }: { stage: ShowcaseStage; verification: BuildWeekDemoVerification }) {
  const { t } = useI18n();
  const record = verification.record;
  const checkIds: Record<ShowcaseStage["id"], string[]> = {
    frontier: [], delegate: ["delegation"], bundle: ["bundle", "objects"],
    lean: ["runner"], review: ["review"], receipt: ["receipt"],
  };
  return (
    <>
      {stage.id === "frontier" ? <>
        <p className={styles.sceneLabel}>{t("showcase.scene.frontier.label")}</p>
        <h4 className={styles.target}>{record.target}</h4>
        <CodeBlock className={styles.source}><code>{record.source.trim().split("\n").filter((line) => line.trim()).join("\n")}</code></CodeBlock>
        <p className={styles.sceneNote}>{t("showcase.scene.frontier.note", { version: shortLeanVersion(record.leanVersion) })}</p>
      </> : stage.id === "delegate" ? <>
        <p className={styles.sceneLabel}>{t("showcase.scene.delegate.label")}</p>
        <div className={styles.handoff}>
          <div><span>{t("showcase.scene.delegate.person")}</span><code>{record.owner}</code></div>
          <span className={styles.arrow} aria-hidden="true">→</span>
          <div><span>{t("showcase.scene.delegate.agent")}</span><code>{record.agent}</code></div>
        </div>
        <FieldList className={styles.fields}><Field label={t("showcase.scene.delegate.scopeLabel")}>{t("showcase.scene.delegate.scopeValue")}</Field><Field label={t("showcase.scene.delegate.boundaryLabel")}>{t("showcase.scene.delegate.boundaryValue")}</Field></FieldList>
      </> : stage.id === "bundle" ? <>
        <p className={styles.sceneLabel}>{t("showcase.scene.bundle.label")}</p>
        <h4 className={styles.target}>{record.target}</h4>
        <FieldList className={styles.fields}>
          <Field label={t("showcase.scene.bundle.repository")}>{record.repository}</Field>
          <Field label={t("showcase.scene.bundle.commit")}><code>{shortHash(record.commitSha)}</code></Field>
          <Field label={t("showcase.scene.bundle.environment")}>Lean {shortLeanVersion(record.leanVersion)}</Field>
          <Field label={t("showcase.scene.bundle.contents")}>{t("showcase.scene.bundle.contentsValue")}</Field>
        </FieldList>
      </> : stage.id === "lean" ? <>
        <p className={styles.sceneLabel}>{t("showcase.scene.lean.label")}</p>
        <div className={styles.result} data-passed={stage.passed}>
          <span aria-hidden="true">{stage.passed ? "✓" : "!"}</span>
          <div><h4>{stage.passed ? t("showcase.scene.lean.accepted") : t("showcase.scene.lean.failed")}</h4><p>{t("showcase.scene.lean.run", { version: shortLeanVersion(record.leanVersion) })}</p></div>
        </div>
        <FieldList className={styles.fields}><Field label={t("showcase.scene.lean.target")}>{record.target}</Field><Field label={t("showcase.scene.lean.replay")}>{t("showcase.scene.lean.replayValue")}</Field></FieldList>
      </> : stage.id === "review" ? <>
        <p className={styles.sceneLabel}>{t("showcase.scene.review.label")}</p>
        <FieldList className={styles.fields}>
          <Field label={t("showcase.scene.review.researcher")}><code>{record.owner}</code></Field>
          {record.reviewers.map((owner, index) => <div key={owner}><dt>{t("showcase.scene.review.reviewer", { number: index + 1 })}</dt><dd><code>{owner}</code></dd></div>)}
        </FieldList>
        <p className={styles.sceneNote}>{t("showcase.scene.review.note")}</p>
      </> : <>
        <p className={styles.sceneLabel}>{t("showcase.scene.receipt.label")}</p>
        <div className={styles.result} data-passed={stage.passed}>
          <span aria-hidden="true">{stage.passed ? "✓" : "!"}</span>
          <div><h4>{stage.passed ? t("showcase.scene.receipt.recorded") : t("showcase.scene.receipt.failed")}</h4><p>{record.owner}</p></div>
        </div>
        <FieldList className={styles.fields}><Field label={t("showcase.scene.receipt.target")}>{record.target}</Field><Field label={t("showcase.scene.receipt.bundle")}><code>{shortHash(record.bundleHash)}</code></Field><Field label={t("showcase.scene.receipt.attribution")}>{t("showcase.scene.receipt.attributionValue")}</Field></FieldList>
      </>}
      {verification.checks.filter((check) => checkIds[stage.id].includes(check.id)).map((check) => (
        <p className={styles.check} data-passed={check.passed} key={check.id}>
          <span aria-hidden="true">{check.passed ? "✓" : "!"}</span>{check.result}
        </p>
      ))}
    </>
  );
}

function buildStages(verification: BuildWeekDemoVerification, t: Translator): ShowcaseStage[] {
  const journey = new Map(verification.journey.map((stage) => [stage.id, stage]));
  const stage = (id: DemoJourneyStage["id"]) => {
    const result = journey.get(id);
    if (!result) throw new Error(`Missing showcase journey stage: ${id}`);
    return result;
  };

  return [
    {
      id: "frontier",
      number: "01",
      kicker: t("showcase.stage.frontier.kicker"),
      title: t("showcase.stage.frontier.title"),
      detail: t("showcase.stage.frontier.detail"),
      actor: t("showcase.stage.frontier.actor"),
      evidence: verification.record.commitSha,
      state: t("showcase.stage.frontier.state"),
      passed: true,
    },
    fromJourney(stage("delegate"), "02", t),
    fromJourney(stage("bundle"), "03", t),
    fromJourney(stage("lean"), "04", t),
    fromJourney(stage("review"), "05", t),
    fromJourney(stage("receipt"), "06", t),
  ];
}

function fromJourney(stage: DemoJourneyStage, number: string, t: Translator): ShowcaseStage {
  const copy = journeyCopy[stage.id];
  return {
    id: stage.id,
    number,
    kicker: t(copy.kicker),
    title: t(copy.title),
    detail: t(copy.detail),
    actor: t(copy.actor),
    evidence: stage.evidence,
    state: stage.passed ? t("showcase.state.passed") : t("showcase.state.failed"),
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
