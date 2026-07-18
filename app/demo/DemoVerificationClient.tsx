"use client";

import { useState } from "react";
import type { BuildWeekDemoVerification, DemoVerificationMode } from "@/app/lib/build-week-demo";

export function DemoVerificationClient({ initial }: { initial: BuildWeekDemoVerification }) {
  const [verification, setVerification] = useState(initial);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestedMode, setRequestedMode] = useState<DemoVerificationMode>(initial.mode);
  const [runSequence, setRunSequence] = useState(0);

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

  return (
    <>
      <section className="demo-walkthrough" id="demo-walkthrough" aria-labelledby="walkthrough-title">
        <div className="demo-walkthrough-heading">
          <div>
            <p className="eyebrow">Three-minute walkthrough</p>
            <h2 id="walkthrough-title">One local contribution. Five evidence gates.</h2>
            <p>The researcher path is a checked local reference. The second account is intentionally mocked for demo reliability, while owner separation, keys, hashes, signatures and Receipt policy remain real.</p>
          </div>
          <span className="demo-mock-disclosure">Mock identity · real verification</span>
        </div>

        <div className="demo-walkthrough-layout">
          <ol className="demo-stage-tabs" aria-label="Demo evidence gates">
            {verification.journey.map((stage, index) => (
              <li key={stage.id}>
                <button
                  type="button"
                  className={index === activeStageIndex ? "is-active" : ""}
                  aria-current={index === activeStageIndex ? "step" : undefined}
                  onClick={() => setActiveStageIndex(index)}
                >
                  <span>{stage.number}</span>
                  <strong>{stage.title}</strong>
                  <i aria-label={stage.passed ? "passed" : "failed"}>{stage.passed ? "Passed" : "Failed"}</i>
                </button>
              </li>
            ))}
          </ol>

          <article className="demo-stage-detail" aria-live="polite">
            <div className="demo-stage-detail-topline">
              <span>{modeLabel(activeStage.actorMode)}</span>
              <strong>{activeStage.passed ? "Evidence gate passed" : "Evidence gate failed"}</strong>
            </div>
            <p className="demo-stage-number">Gate {activeStage.number}</p>
            <h3>{activeStage.title}</h3>
            <p>{activeStage.detail}</p>
            <dl>
              <div><dt>Actor</dt><dd>{activeStage.actor}</dd></div>
              <div><dt>Bound evidence</dt><dd><code>{shortHash(activeStage.evidence)}</code></dd></div>
              {activeStage.actorMode === "mock_second_account" && <div><dt>Owner check</dt><dd>{verification.mockReviewer.independentFromResearcher ? "Different Person ID" : "Conflict"}</dd></div>}
            </dl>

            {isLastStage && <div className="demo-credit-preview">
              <div><span>Researcher preview</span><strong>{verification.creditPreview.researcher[0]?.value ?? 0}</strong><small>{verification.creditPreview.researcher[0]?.label}</small></div>
              <div><span>Mock reviewer preview</span><strong>{verification.creditPreview.mockReviewer[0]?.value ?? 0}</strong><small>{verification.creditPreview.mockReviewer[0]?.label}</small></div>
              <p>Receipt-derived, non-transferable and not settled as a Token.</p>
            </div>}

            <div className="demo-stage-actions">
              <button
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
              </button>
              {activeStageIndex > 0 && <button className="demo-text-button" type="button" onClick={() => setActiveStageIndex(0)}>Restart walkthrough</button>}
            </div>
          </article>
        </div>
      </section>

      <section className="demo-console" id="verification-console" aria-labelledby="verification-title">
      <div className="demo-console-heading">
        <div>
          <p className="eyebrow">Live protocol verification</p>
          <h2 id="verification-title">Verify the evidence, not the story.</h2>
          <p>Each request re-hashes the checked-in bytes and verifies detached Ed25519 signatures and policy. The recorded Runner result is checked here; Lean itself is not restarted.</p>
        </div>
        <div className={`demo-verdict ${isChecking ? "is-running" : verification.status === "verified" ? "is-verified" : isTamperResult ? "is-tamper" : "is-failed"}`} aria-live="polite">
          <span>{verdictLabel}</span>
          <strong>{isChecking ? "···" : `${passedCount}/${verification.checks.length}`}</strong>
        </div>
      </div>

      <div
        key={`${runSequence}-${isChecking ? "running" : "complete"}`}
        className={`demo-verification-run ${isChecking ? "is-running" : verification.status === "verified" ? "is-verified" : isTamperResult ? "is-tamper" : "is-failed"}`}
        role="status"
        aria-live="polite"
        aria-busy={isChecking}
      >
        <span className="demo-run-signal" aria-hidden="true">{isChecking ? "↻" : verification.status === "verified" ? "✓" : "!"}</span>
        <div className="demo-run-message"><strong>{runTitle}</strong><p>{runDetail}</p></div>
        <dl>
          <div><dt>Request</dt><dd><code>{isChecking ? "new request" : verification.verificationId}</code></dd></div>
          <div><dt>Mode</dt><dd>{isChecking ? modeLabelForRun(requestedMode) : modeLabelForRun(verification.mode)}</dd></div>
          <div><dt>Protocol</dt><dd>{verification.protocolVersion}</dd></div>
          <div><dt>Server time</dt><dd>{isChecking ? "measuring…" : formatDuration(verification.durationMs)}</dd></div>
        </dl>
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
                  <dl>
                    <div><dt>Method</dt><dd>{check.method}</dd></div>
                    <div><dt>Input</dt><dd>{check.input}</dd></div>
                    <div><dt>Evidence</dt><dd><code>{check.evidence}</code></dd></div>
                    <div><dt>Result</dt><dd>{check.result}</dd></div>
                    <div><dt>Duration</dt><dd>{formatDuration(check.durationMs)}</dd></div>
                  </dl>
                </details>
              </div>
              <span className="demo-check-state">{isChecking ? "Checking" : check.passed ? "Passed" : "Failed"}</span>
            </li>
          ))}
        </ol>

        <aside className="demo-record-card" aria-label="Verified reference record">
          <span className="micro-label">Bound reference record</span>
          <h3>{verification.record.target}</h3>
          <dl>
            <div><dt>Lean</dt><dd>{shortLeanVersion(verification.record.leanVersion)}</dd></div>
            <div><dt>Git commit</dt><dd><code>{shortHash(verification.record.commitSha)}</code></dd></div>
            <div><dt>Bundle</dt><dd><code>{shortHash(verification.record.bundleHash)}</code></dd></div>
            <div><dt>Receipt</dt><dd><code>{shortHash(verification.record.receiptHash)}</code></dd></div>
            <div><dt>Credited to</dt><dd>{verification.record.owner}</dd></div>
            <div><dt>Review owners</dt><dd>{verification.record.reviewers.length} independent</dd></div>
          </dl>
          <div className="demo-execution-boundary">
            <strong>What this control does</strong>
            <p>Re-hashes evidence bytes and verifies signatures, owner separation, Runner claims and Receipt policy.</p>
            <strong>What it does not do</strong>
            <p>It does not start Lean. A fresh Lean replay is the separate local end-to-end command below.</p>
          </div>
          <button className="button button-primary demo-run-button" type="button" onClick={() => { void runChecks("reference"); }} disabled={isChecking}>
            {isChecking && requestedMode === "reference" ? "Re-hashing & verifying…" : isTamperResult ? "Verify original evidence" : "Re-verify signed evidence"}<span aria-hidden="true">↻</span>
          </button>
          <button className="demo-tamper-button" type="button" onClick={() => { void runChecks("tampered_copy"); }} disabled={isChecking}>
            {isChecking && requestedMode === "tampered_copy" ? "Changing one byte…" : "Tamper-test a copy"}
          </button>
          <p className="demo-tamper-note">Changes one byte in a temporary request copy. The signed original remains untouched.</p>
          <div className="demo-report-links">
            <a href={isTamperResult ? "/api/demo/verify?tamper=artifact" : "/api/demo/verify"} target="_blank" rel="noreferrer">View verification JSON <span aria-hidden="true">↗</span></a>
            <span>Checked {formatTime(verification.checkedAt)} UTC · {formatDuration(verification.durationMs)}</span>
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
    return new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(new Date(value));
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
