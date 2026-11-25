"use client";

import { SectionTitle, CardTitle, Field, Button, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { StepNavigation } from "@/app/components/navigation/StepNavigation";
import { useEffect, useRef, useState } from "react";
import { type BuildWeekDemoVerification, type DemoVerificationMode } from "@/app/lib/build-week-demo";
import { useI18n } from "@/app/i18n/client";
import type { Translator } from "@/app/i18n/translate";

const homeGateLabels = {
  delegation: "demo.home.gate.delegation", bundle: "demo.home.gate.bundle",
  objects: "demo.home.gate.objects", runner: "demo.home.gate.runner",
  review: "demo.home.gate.review", receipt: "demo.home.gate.receipt",
} as const;

export function DemoVerificationClient({
  initial,
  variant = "full",
}: {
  initial: BuildWeekDemoVerification;
  variant?: "full" | "console" | "home";
}) {
  const { t } = useI18n();
  const [verification, setVerification] = useState(initial);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedMode, setRequestedMode] = useState<DemoVerificationMode>(initial.mode);
  const [runSequence, setRunSequence] = useState(initial.mode === "tampered_copy" ? 1 : 0);
  const runResultRef = useRef<HTMLDivElement>(null);
  const homePanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (runSequence === 0) return;
    const frame = window.requestAnimationFrame(() => {
      if (variant === "home") {
        const panel = homePanelRef.current;
        if (!panel || !window.matchMedia("(max-width: 600px)").matches) return;
        const score = panel.querySelector(".rh-result");
        const lastDetail = panel.querySelector(".rh-byte-diff") ?? panel.querySelector(".rh-console-action");
        const headerHeight = document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0;
        if (score && lastDetail && (score.getBoundingClientRect().top < headerHeight ||
          lastDetail.getBoundingClientRect().bottom > window.innerHeight)) {
          panel.scrollIntoView({ block: "start", behavior: "instant" });
        }
        return;
      }
      runResultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [runSequence, variant]);

  const runChecks = async (mode: DemoVerificationMode = "reference") => {
    if (isChecking) return;
    setRequestedMode(mode);
    setIsChecking(true);
    setError(null);
    try {
      const endpoint = mode === "tampered_copy" ? "/api/demo/verify?tamper=artifact" : "/api/demo/verify";
      const response = await fetch(endpoint, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || !Array.isArray(payload.checks) || typeof payload.verificationId !== "string") {
        throw new Error(t("demo.error"));
      }
      setVerification(payload as BuildWeekDemoVerification);
      setRunSequence((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("demo.error"));
    } finally {
      setIsChecking(false);
    }
  };

  const passedCount = verification.checks.filter((check) => check.passed).length;
  const activeStage = verification.journey[activeStageIndex];
  const isLastStage = activeStageIndex === verification.journey.length - 1;
  const isTamperResult = verification.mode === "tampered_copy";
  const runTitle = isChecking
    ? requestedMode === "tampered_copy" ? t("demo.run.testingTamper") : t("demo.run.reverifying")
    : isTamperResult && verification.status === "failed"
      ? t("demo.run.tamperExpected")
      : verification.status === "verified"
        ? t("demo.run.freshComplete")
        : t("demo.run.failed");
  const runDetail = isChecking
    ? t("demo.run.verifyingDetail")
    : isTamperResult && verification.status === "failed"
      ? t("demo.run.tamperDetail")
      : verification.executionBoundary.statement;
  const verdictLabel = isChecking
    ? t("demo.verdict.running")
    : isTamperResult && verification.status === "failed"
      ? t("demo.verdict.tamper")
      : verification.status === "verified" ? t("demo.verdict.allPassed") : t("demo.verdict.failed");
  if (variant === "home") {
    const rejected = verification.status === "failed";
    const report = isTamperResult ? "/api/demo/verify?tamper=artifact" : "/api/demo/verify";
    return <section ref={homePanelRef} className="rh-console" id="verification-console" aria-labelledby="rh-console-title">
      <div className="rh-console-head">
        <h2 id="rh-console-title">{t("demo.home.heading")}</h2>
        <button className="rh-console-action" disabled={isChecking}
          onClick={() => void runChecks(isTamperResult ? "reference" : "tampered_copy")}>
          {isChecking ? t("demo.checkState.checking") : isTamperResult ? t("demo.home.restore") : t("demo.home.tamper")}
        </button>
      </div>
      <div className="rh-console-body">
        <div className="rh-verdict">
          <div className={rejected ? "rh-result rejected" : "rh-result"} role="status">
            <strong>{isChecking ? "…" : passedCount}<small>/{verification.checks.length}</small></strong>
            <span>{isChecking ? t("demo.checkState.checking") : rejected ? (isTamperResult ? t("demo.home.rejected") : t("demo.verdict.failed")) : t("demo.home.accepted")}</span>
          </div>
          <p>{isTamperResult && rejected ? t("demo.home.rejectReason") : t("demo.home.scope")}</p>
          <a href="/demo">{t("demo.home.audit")} →</a>
          {!isTamperResult && <button className="rh-recheck" disabled={isChecking} onClick={() => void runChecks("reference")}>{t("demo.home.check")} ↻</button>}
          {error && <p role="alert">{error}</p>}
        </div>
        <ol className="rh-checks" aria-busy={isChecking}>
          {verification.checks.map((check, index) => <li key={check.id} className={check.passed ? undefined : "failed"}>
            <details key={verification.verificationId} open={!check.passed || undefined}>
              <summary><span className="rh-check-number">{String(index + 1).padStart(2, "0")}</span>
                <strong>{check.id in homeGateLabels ? t(homeGateLabels[check.id as keyof typeof homeGateLabels]) : check.label}</strong><span className="rh-duration">{isChecking ? "—" : formatDuration(check.durationMs)}</span>
                <span className="rh-check-state">{isChecking ? "…" : check.passed ? "✓" : "×"}
                  <span className="sr-only">{isChecking ? t("demo.checkState.checking") : check.passed ? t("demo.checkState.passed") : t("demo.checkState.failed")}</span>
                </span><span aria-hidden="true" className="rh-chevron">⌄</span></summary>
              <div className="rh-check-detail">
                {check.id === "objects" && !check.passed && verification.mutation && <div className="rh-byte-diff">
                  <p><code>{verification.mutation.filename}</code> · {t("demo.home.offset", {offset: verification.mutation.offset})}</p>
                  {([["demo.home.expected", verification.mutation.before], ["demo.home.changed", verification.mutation.after]] as const).map(([label, bytes]) =>
                    <div className="rh-byte-line" key={label}><span>{t(label)}</span>
                      <code>{bytes.slice(0,-1).join(" ")} <b>{bytes[bytes.length - 1]}</b></code></div>)}
                </div>}
                <p>{check.result}</p>
                <details className="rh-raw" open={check.passed || undefined}><summary>{t("demo.check.inspect")}</summary>
                  <p>{check.method}</p><code>{check.evidence}</code>
                  <p>Git <code>{verification.record.commitSha}</code></p>
                  <a href={report} target="_blank" rel="noreferrer">{t("demo.report.viewJson")} ↗</a>
                </details>
              </div>
            </details>
          </li>)}
        </ol>
      </div>
    </section>;
  }
  const consoleClassName = variant === "console" ? "demo-console demo-console-compact" : "demo-console";

  return (
    <>
      {variant === "full" && <section className="demo-walkthrough" id="demo-walkthrough" aria-labelledby="walkthrough-title">
        <SectionHeading as="div" className="demo-walkthrough-heading">
          <div>
            <p className="eyebrow">{t("demo.walkthrough.eyebrow")}</p>
            <SectionTitle id="walkthrough-title">{t("demo.walkthrough.title")}</SectionTitle>
            <p>{t("demo.walkthrough.body")}</p>
          </div>
          <span className="demo-mock-disclosure">{t("demo.walkthrough.badge")}</span>
        </SectionHeading>

        <div className="demo-walkthrough-layout">
          <StepNavigation className="demo-stage-tabs" label={t("demo.walkthrough.gatesAria")}
            items={verification.journey.map((stage) => ({
              id: stage.id, number: stage.number, label: <strong>{stage.title}</strong>,
              accessibleLabel: stage.number + " " + stage.title,
              meta: <i aria-label={stage.passed ? t("demo.checkState.passed") : t("demo.checkState.failed")}>{stage.passed ? t("demo.checkState.passed") : t("demo.checkState.failed")}</i>,
            }))}
            activeIndex={activeStageIndex} onSelect={setActiveStageIndex} />

          <Surface as="article" className="demo-stage-detail" aria-live="polite">
            <div className="demo-stage-detail-topline">
              <span>{modeLabel(activeStage.actorMode, t)}</span>
              <strong>{activeStage.passed ? t("demo.stage.gatePassed") : t("demo.stage.gateFailed")}</strong>
            </div>
            <p className="demo-stage-number">{t("demo.stage.gate", { number: activeStage.number })}</p>
            <CardTitle>{activeStage.title}</CardTitle>
            <p>{activeStage.detail}</p>
            <FieldList>
              <Field label={t("demo.field.actor")}>{activeStage.actor}</Field>
              <Field label={t("demo.field.boundEvidence")}><code>{shortHash(activeStage.evidence)}</code></Field>
              {activeStage.actorMode === "mock_second_account" && <div><dt>{t("demo.field.ownerCheck")}</dt><dd>{verification.mockReviewer.independentFromResearcher ? t("demo.ownerCheck.different") : t("demo.ownerCheck.conflict")}</dd></div>}
            </FieldList>

            {isLastStage && <div className="demo-credit-preview">
              <div><span>{t("demo.credit.researcherPreview")}</span><strong>{verification.creditPreview.researcher[0]?.value ?? 0}</strong><small>{verification.creditPreview.researcher[0]?.label}</small></div>
              <div><span>{t("demo.credit.mockReviewerPreview")}</span><strong>{verification.creditPreview.mockReviewer[0]?.value ?? 0}</strong><small>{verification.creditPreview.mockReviewer[0]?.label}</small></div>
              <p>{t("demo.credit.note")}</p>
            </div>}

            <div className="demo-stage-actions">
              <Button
                className="button button-primary"
                type="button"
                onClick={() => {
                  if (isLastStage) void runChecks("reference");
                  else setActiveStageIndex((value) => Math.min(value + 1, verification.journey.length - 1));
                }}
                disabled={isLastStage && isChecking}
              >
                {isLastStage ? (isChecking ? t("demo.action.checkingSignatures") : t("demo.action.verifyChain")) : t("demo.action.nextGate")}
                <span aria-hidden="true">{isLastStage ? "↻" : "→"}</span>
              </Button>
              {activeStageIndex > 0 && <Button className="demo-text-button" type="button" onClick={() => setActiveStageIndex(0)}>{t("demo.action.restart")}</Button>}
            </div>
          </Surface>
        </div>
      </section>}

      <section className={consoleClassName} id="verification-console" aria-labelledby="verification-title">
      <SectionHeading as="div" className="demo-console-heading">
        <div>
          <p className="eyebrow">{t("demo.console.eyebrow")}</p>
          <SectionTitle id="verification-title">{t("demo.console.title")}</SectionTitle>
          <p>{t("demo.console.body")}</p>
        </div>
        <div className={`demo-verdict ${isChecking ? "is-running" : verification.status === "verified" ? "is-verified" : isTamperResult ? "is-tamper" : "is-failed"}`} aria-live="polite">
          <span>{verdictLabel}</span>
          <strong>{isChecking ? "···" : `${passedCount}/${verification.checks.length}`}</strong>
        </div>
      </SectionHeading>

      <div
        ref={runResultRef}
        key={`${runSequence}-${isChecking ? "running" : "complete"}`}
        className={`demo-verification-run ${isChecking ? "is-running" : verification.status === "verified" ? "is-verified" : isTamperResult ? "is-tamper" : "is-failed"}`}
        role="status"
        aria-live="polite"
        aria-busy={isChecking}
      >
        <span className="demo-run-signal" aria-hidden="true">{isChecking ? "↻" : verification.status === "verified" ? "✓" : "!"}</span>
        <EmptyState as="div" className="demo-run-message"><strong>{runTitle}</strong><p>{runDetail}</p></EmptyState>
        <FieldList>
          <Field label={t("demo.run.field.request")}><code>{isChecking ? t("demo.run.newRequest") : verification.verificationId}</code></Field>
          <Field label={t("demo.run.field.mode")}>{isChecking ? modeLabelForRun(requestedMode, t) : modeLabelForRun(verification.mode, t)}</Field>
          <Field label={t("demo.run.field.protocol")}>{verification.protocolVersion}</Field>
          <Field label={t("demo.run.field.serverTime")}>{isChecking ? t("demo.run.measuring") : formatDuration(verification.durationMs)}</Field>
        </FieldList>
      </div>

      <div className="demo-console-grid">
        <ol className="demo-check-list" aria-label={t("demo.checksAria")} aria-busy={isChecking}>
          {verification.checks.map((check, index) => (
            <li key={check.id} className={isChecking ? "is-running" : check.passed ? "is-passed" : "is-failed"}>
              <span className="demo-check-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="demo-check-copy">
                <strong>{check.label}</strong><p>{check.detail}</p>
                <details className="demo-check-evidence">
                  <summary>{t("demo.check.inspect")}</summary>
                  <FieldList>
                    <Field label={t("demo.check.method")}>{check.method}</Field>
                    <Field label={t("demo.check.input")}>{check.input}</Field>
                    <Field label={t("demo.check.evidence")}><code>{check.evidence}</code></Field>
                    <Field label={t("demo.check.result")}>{check.result}</Field>
                    <Field label={t("demo.check.duration")}>{formatDuration(check.durationMs)}</Field>
                  </FieldList>
                </details>
              </div>
              <span className="demo-check-state">{isChecking ? t("demo.checkState.checking") : check.passed ? t("demo.checkState.passed") : t("demo.checkState.failed")}</span>
            </li>
          ))}
        </ol>

        <aside className="demo-record-card" aria-label={t("demo.record.aria")}>
          <span className="micro-label">{t("demo.record.bound")}</span>
          <CardTitle>{verification.record.target}</CardTitle>
          <FieldList>
            <Field label={t("demo.record.lean")}>{shortLeanVersion(verification.record.leanVersion)}</Field>
            <Field label={t("demo.record.gitCommit")}><code>{shortHash(verification.record.commitSha)}</code></Field>
            <Field label={t("demo.record.bundle")}><code>{shortHash(verification.record.bundleHash)}</code></Field>
            <Field label={t("demo.record.receipt")}><code>{shortHash(verification.record.receiptHash)}</code></Field>
            <Field label={t("demo.record.creditedTo")}>{verification.record.owner}</Field>
            <Field label={t("demo.record.reviewOwners")}>{t("demo.record.independent", { count: verification.record.reviewers.length })}</Field>
          </FieldList>
          <div className="demo-execution-boundary">
            <strong>{t("demo.boundary.controlTitle")}</strong>
            <p>{t("demo.boundary.controlBody")}</p>
            <strong>{t("demo.boundary.notTitle")}</strong>
            <p>{t("demo.boundary.notBody")}</p>
          </div>
          {isTamperResult && verification.status === "failed" && <div className="demo-tamper-result" role="note">
            <span>{t("demo.tamper.title")}</span>
            <strong>{t("demo.tamper.body")}</strong>
            <p>{t("demo.tamper.detail")}</p>
          </div>}
          <Button className="button button-primary demo-run-button" type="button" onClick={() => { void runChecks("reference"); }} disabled={isChecking}>
            {isChecking && requestedMode === "reference" ? t("demo.action.rehashing") : isTamperResult ? t("demo.action.verifyOriginal") : t("demo.action.reverify")}<span aria-hidden="true">↻</span>
          </Button>
          <Button className="demo-tamper-button" type="button" onClick={() => { void runChecks("tampered_copy"); }} disabled={isChecking}>
            {isChecking && requestedMode === "tampered_copy" ? t("demo.action.tampering") : t("demo.action.tamperTest")}
          </Button>
          <p className="demo-tamper-note">{t("demo.tamper.note")}</p>
          <div className="demo-report-links">
            <a href={isTamperResult ? "/api/demo/verify?tamper=artifact" : "/api/demo/verify"} target="_blank" rel="noreferrer">{t("demo.report.viewJson")} <span aria-hidden="true">↗</span></a>
            <span>{t("demo.report.checked", { time: formatTime(verification.checkedAt), duration: formatDuration(verification.durationMs) })}</span>
          </div>
          {error && <p className="demo-check-error" role="alert">{error}</p>}
        </aside>
      </div>
      </section>
    </>
  );
}

function shortHash(value: string) {
  const normalized = value.replace(/^sha256:/, "");
  return `${normalized.slice(0, 10)}…${normalized.slice(-8)}`;
}

function shortLeanVersion(value: string) {
  return value.match(/Lean \(version ([^,]+)/)?.[1] ?? value;
}

function formatTime(value: string) {
  try {
    return `${new Date(value).toISOString().slice(11, 19)} UTC`;
  } catch {
    return "just now";
  }
}

function formatDuration(value: number) {
  if (value < 1) return "<1 ms";
  return `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

function modeLabelForRun(mode: DemoVerificationMode, t: Translator) {
  return mode === "tampered_copy" ? t("demo.mode.tamper") : t("demo.mode.reference");
}

function modeLabel(mode: BuildWeekDemoVerification["journey"][number]["actorMode"], t: Translator) {
  if (mode === "mock_second_account") return t("demo.stage.mode.mock");
  if (mode === "protocol_issuer") return t("demo.stage.mode.protocolIssuer");
  return t("demo.stage.mode.localReference");
}
