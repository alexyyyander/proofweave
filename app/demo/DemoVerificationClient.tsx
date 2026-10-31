"use client";

import { SectionTitle, CardTitle, Field, Button, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { StepNavigation } from "@/app/components/navigation/StepNavigation";
import { useEffect, useRef, useState } from "react";
import { type BuildWeekDemoVerification, type DemoVerificationMode } from "@/app/lib/build-week-demo";

export function DemoVerificationClient({
  initial,
  variant = "full",
}: {
  initial: BuildWeekDemoVerification;
  variant?: "full" | "console";
}) {
  const [verification, setVerification] = useState(initial);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedMode, setRequestedMode] = useState<DemoVerificationMode>(initial.mode);
  const [runSequence, setRunSequence] = useState(initial.mode === "tampered_copy" ? 1 : 0);
  const runResultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (runSequence === 0) return;
    const frame = window.requestAnimationFrame(() => {
      runResultRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [runSequence]);

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
        throw new Error("The reference evidence could not be verified.");
      }
      setVerification(payload as BuildWeekDemoVerification);
      setRunSequence((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reference evidence could not be verified.");
    } finally {
      setIsChecking(false);
    }
  };

  const passedCount = verification.checks.filter((check) => check.passed).length;
  const activeStage = verification.journey[activeStageIndex];
  const isLastStage = activeStageIndex === verification.journey.length - 1;
  const isTamperResult = verification.mode === "tampered_copy";
  const runTitle = isChecking
    ? requestedMode === "tampered_copy" ? "Testing a one-byte change…" : "Re-verifying signed evidence…"
    : isTamperResult && verification.status === "failed"
      ? "Tamper detected as expected"
      : verification.status === "verified"
        ? "Fresh verification completed"
        : "Verification failed";
  const runDetail = isChecking
    ? "The server is re-hashing current bytes and checking signatures and policy in parallel."
    : isTamperResult && verification.status === "failed"
      ? "A temporary copy changed by one byte failed artifact integrity. The signed reference fixture was not modified."
      : verification.executionBoundary.statement;
  const verdictLabel = isChecking
    ? "Verification running"
    : isTamperResult && verification.status === "failed"
      ? "Tamper detected"
      : verification.status === "verified" ? "All checks passed" : "Verification failed";
  const consoleClassName = variant === "console" ? "demo-console demo-console-compact" : "demo-console";

  return (
    <>
      {variant === "full" && <section className="demo-walkthrough" id="demo-walkthrough" aria-labelledby="walkthrough-title">
        <SectionHeading as="div" className="demo-walkthrough-heading">
          <div>
            <p className="eyebrow">Three-minute walkthrough</p>
            <SectionTitle id="walkthrough-title">One local contribution. Five evidence gates.</SectionTitle>
            <p>The researcher path is a checked local reference. The second account is intentionally mocked for demo reliability, while owner separation, keys, hashes, signatures and Receipt policy remain real.</p>
          </div>
          <span className="demo-mock-disclosure">Mock identity · real verification</span>
        </SectionHeading>

        <div className="demo-walkthrough-layout">
          <StepNavigation className="demo-stage-tabs" label="Demo evidence gates"
            items={verification.journey.map((stage) => ({
              id: stage.id, number: stage.number, label: <strong>{stage.title}</strong>,
              accessibleLabel: stage.number + " " + stage.title,
              meta: <i aria-label={stage.passed ? "passed" : "failed"}>{stage.passed ? "Passed" : "Failed"}</i>,
            }))}
            activeIndex={activeStageIndex} onSelect={setActiveStageIndex} />

          <Surface as="article" className="demo-stage-detail" aria-live="polite">
            <div className="demo-stage-detail-topline">
              <span>{modeLabel(activeStage.actorMode)}</span>
              <strong>{activeStage.passed ? "Evidence gate passed" : "Evidence gate failed"}</strong>
            </div>
            <p className="demo-stage-number">Gate {activeStage.number}</p>
            <CardTitle>{activeStage.title}</CardTitle>
            <p>{activeStage.detail}</p>
            <FieldList>
              <Field label="Actor">{activeStage.actor}</Field>
              <Field label="Bound evidence"><code>{shortHash(activeStage.evidence)}</code></Field>
              {activeStage.actorMode === "mock_second_account" && <div><dt>Owner check</dt><dd>{verification.mockReviewer.independentFromResearcher ? "Different Person ID" : "Conflict"}</dd></div>}
            </FieldList>

            {isLastStage && <div className="demo-credit-preview">
              <div><span>Researcher preview</span><strong>{verification.creditPreview.researcher[0]?.value ?? 0}</strong><small>{verification.creditPreview.researcher[0]?.label}</small></div>
              <div><span>Mock reviewer preview</span><strong>{verification.creditPreview.mockReviewer[0]?.value ?? 0}</strong><small>{verification.creditPreview.mockReviewer[0]?.label}</small></div>
              <p>Receipt-derived, non-transferable and not settled as a Token.</p>
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
                {isLastStage ? (isChecking ? "Checking signatures…" : "Verify complete chain") : "Next evidence gate"}
                <span aria-hidden="true">{isLastStage ? "↻" : "→"}</span>
              </Button>
              {activeStageIndex > 0 && <Button className="demo-text-button" type="button" onClick={() => setActiveStageIndex(0)}>Restart walkthrough</Button>}
            </div>
          </Surface>
        </div>
      </section>}

      <section className={consoleClassName} id="verification-console" aria-labelledby="verification-title">
      <SectionHeading as="div" className="demo-console-heading">
        <div>
          <p className="eyebrow">Live protocol verification</p>
          <SectionTitle id="verification-title">Verify the evidence, not the story.</SectionTitle>
          <p>Each request re-hashes the checked-in bytes and verifies detached Ed25519 signatures and policy. The recorded Runner result is checked here; Lean itself is not restarted.</p>
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
          <Field label="Request"><code>{isChecking ? "new request" : verification.verificationId}</code></Field>
          <Field label="Mode">{isChecking ? modeLabelForRun(requestedMode) : modeLabelForRun(verification.mode)}</Field>
          <Field label="Protocol">{verification.protocolVersion}</Field>
          <Field label="Server time">{isChecking ? "measuring…" : formatDuration(verification.durationMs)}</Field>
        </FieldList>
      </div>

      <div className="demo-console-grid">
        <ol className="demo-check-list" aria-label="Reference evidence checks" aria-busy={isChecking}>
          {verification.checks.map((check, index) => (
            <li key={check.id} className={isChecking ? "is-running" : check.passed ? "is-passed" : "is-failed"}>
              <span className="demo-check-index">{String(index + 1).padStart(2, "0")}</span>
              <div className="demo-check-copy">
                <strong>{check.label}</strong><p>{check.detail}</p>
                <details className="demo-check-evidence">
                  <summary>Inspect computed evidence</summary>
                  <FieldList>
                    <Field label="Method">{check.method}</Field>
                    <Field label="Input">{check.input}</Field>
                    <Field label="Evidence"><code>{check.evidence}</code></Field>
                    <Field label="Result">{check.result}</Field>
                    <Field label="Duration">{formatDuration(check.durationMs)}</Field>
                  </FieldList>
                </details>
              </div>
              <span className="demo-check-state">{isChecking ? "Checking" : check.passed ? "Passed" : "Failed"}</span>
            </li>
          ))}
        </ol>

        <aside className="demo-record-card" aria-label="Verified reference record">
          <span className="micro-label">Bound reference record</span>
          <CardTitle>{verification.record.target}</CardTitle>
          <FieldList>
            <Field label="Lean">{shortLeanVersion(verification.record.leanVersion)}</Field>
            <Field label="Git commit"><code>{shortHash(verification.record.commitSha)}</code></Field>
            <Field label="Bundle"><code>{shortHash(verification.record.bundleHash)}</code></Field>
            <Field label="Receipt"><code>{shortHash(verification.record.receiptHash)}</code></Field>
            <Field label="Credited to">{verification.record.owner}</Field>
            <Field label="Review owners">{verification.record.reviewers.length} independent</Field>
          </FieldList>
          <div className="demo-execution-boundary">
            <strong>What this control does</strong>
            <p>Re-hashes evidence bytes and verifies signatures, owner separation, Runner claims and Receipt policy.</p>
            <strong>What it does not do</strong>
            <p>It does not start Lean. A fresh Lean replay is the separate local end-to-end command below.</p>
          </div>
          {isTamperResult && verification.status === "failed" && <div className="demo-tamper-result" role="note">
            <span>Tampering blocked</span>
            <strong>The signed original is unchanged.</strong>
            <p>Only a temporary request copy failed artifact integrity.</p>
          </div>}
          <Button className="button button-primary demo-run-button" type="button" onClick={() => { void runChecks("reference"); }} disabled={isChecking}>
            {isChecking && requestedMode === "reference" ? "Re-hashing & verifying…" : isTamperResult ? "Verify original evidence" : "Re-verify signed evidence"}<span aria-hidden="true">↻</span>
          </Button>
          <Button className="demo-tamper-button" type="button" onClick={() => { void runChecks("tampered_copy"); }} disabled={isChecking}>
            {isChecking && requestedMode === "tampered_copy" ? "Changing one byte…" : "Tamper-test a copy"}
          </Button>
          <p className="demo-tamper-note">Changes one byte in a temporary request copy. The signed original remains untouched.</p>
          <div className="demo-report-links">
            <a href={isTamperResult ? "/api/demo/verify?tamper=artifact" : "/api/demo/verify"} target="_blank" rel="noreferrer">View verification JSON <span aria-hidden="true">↗</span></a>
            <span>Checked {formatTime(verification.checkedAt)} · {formatDuration(verification.durationMs)}</span>
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

function modeLabelForRun(mode: DemoVerificationMode) {
  return mode === "tampered_copy" ? "Tamper-test copy" : "Signed reference";
}

function modeLabel(mode: BuildWeekDemoVerification["journey"][number]["actorMode"]) {
  if (mode === "mock_second_account") return "Mock second account";
  if (mode === "protocol_issuer") return "Protocol issuer";
  return "Local reference";
}
