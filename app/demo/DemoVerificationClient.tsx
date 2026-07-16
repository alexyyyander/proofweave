"use client";

import { useState } from "react";
import type { BuildWeekDemoVerification } from "@/app/lib/build-week-demo";

export function DemoVerificationClient({ initial }: { initial: BuildWeekDemoVerification }) {
  const [verification, setVerification] = useState(initial);
  const [activeStageIndex, setActiveStageIndex] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runChecks = async () => {
    if (isChecking) return;
    setIsChecking(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/verify", {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload || !Array.isArray(payload.checks)) {
        throw new Error("The reference evidence could not be verified.");
      }
      setVerification(payload as BuildWeekDemoVerification);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reference evidence could not be verified.");
    } finally {
      setIsChecking(false);
    }
  };

  const passedCount = verification.checks.filter((check) => check.passed).length;
  const activeStage = verification.journey[activeStageIndex];
  const isLastStage = activeStageIndex === verification.journey.length - 1;

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
                  if (isLastStage) void runChecks();
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
          <p>Each check runs against the checked-in bytes and detached Ed25519 signatures. The endpoint returns a bounded verification projection, never private keys.</p>
        </div>
        <div className={`demo-verdict ${verification.status === "verified" ? "is-verified" : "is-failed"}`} aria-live="polite">
          <span>{verification.status === "verified" ? "All checks passed" : "Verification failed"}</span>
          <strong>{passedCount}/{verification.checks.length}</strong>
        </div>
      </div>

      <div className="demo-console-grid">
        <ol className="demo-check-list" aria-label="Reference evidence checks">
          {verification.checks.map((check, index) => (
            <li key={check.id} className={check.passed ? "is-passed" : "is-failed"}>
              <span className="demo-check-index">{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{check.label}</strong><p>{check.detail}</p></div>
              <span className="demo-check-state">{check.passed ? "Passed" : "Failed"}</span>
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
          <button className="button button-primary demo-run-button" type="button" onClick={() => { void runChecks(); }} disabled={isChecking}>
            {isChecking ? "Checking signatures…" : "Re-run all checks"}<span aria-hidden="true">↻</span>
          </button>
          <p className="demo-checked-at">Last checked {formatTime(verification.checkedAt)}</p>
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
    return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
  } catch {
    return "just now";
  }
}

function modeLabel(mode: BuildWeekDemoVerification["journey"][number]["actorMode"]) {
  if (mode === "mock_second_account") return "Mock second account";
  if (mode === "protocol_issuer") return "Protocol issuer";
  return "Local reference";
}
