"use client";

import { useState } from "react";
import type { BuildWeekDemoVerification } from "@/app/lib/build-week-demo";

export function DemoVerificationClient({ initial }: { initial: BuildWeekDemoVerification }) {
  const [verification, setVerification] = useState(initial);
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

  return (
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
