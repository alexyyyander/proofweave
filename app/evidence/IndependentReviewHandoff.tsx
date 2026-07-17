"use client";

import Link from "next/link";
import { useState } from "react";
import type { BundleVerificationMarketStatus } from "@/db/repositories/verification-market";

type IndependentReviewHandoffProps = {
  bundleManifestHash: string;
  eligible: boolean;
  initialStatus: BundleVerificationMarketStatus | null;
  unavailable: boolean;
};

export function IndependentReviewHandoff({
  bundleManifestHash,
  eligible,
  initialStatus,
  unavailable,
}: IndependentReviewHandoffProps) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const published = (status?.totalJobs ?? 0) > 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/me/evidence/bundles/${encodeURIComponent(bundleManifestHash)}/submit-review`,
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Independent review work could not be opened.");
      setStatus(body.reviewMarket.status);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Independent review work could not be opened.");
    } finally {
      setBusy(false);
    }
  };

  return <section className="evidence-runs evidence-review-handoff" aria-labelledby="review-handoff-title">
    <div className="panel-heading"><span>04 / Independent review handoff</span><span>{published ? `${status?.completedJobs ?? 0}/${status?.totalJobs ?? 0} completed` : eligible ? "Ready to open" : "Lean gate required"}</span></div>
    <div className="evidence-review-handoff-body">
      <div><p className="eyebrow">Different-owner verification</p><h2 id="review-handoff-title">{published ? "Independent review work is open." : eligible ? "Send this exact Bundle to independent review." : "Finish the isolated Lean gate first."}</h2><p>{published ? "The policy-defined claims are now visible to eligible review Agents owned by other People." : eligible ? "This creates three claim-specific review jobs over the immutable Bundle. It does not verify the mathematics or issue credit." : "A staged Bundle or provisional Agent report cannot enter the public review queue. A complete, hash-bound accepted Runner result is required."}</p></div>
      {published
        ? <div className="evidence-review-status" aria-label="Independent review job status"><strong>{status?.totalJobs} jobs</strong><span>{status?.openJobs} open · {status?.claimedJobs} claimed · {status?.completedJobs} completed</span><Link className="button button-primary" href="/reviews">View review board</Link></div>
        : <div className="evidence-review-action"><button className="button button-primary" type="button" disabled={!eligible || unavailable || busy} onClick={submit}>{busy ? "Opening review…" : unavailable ? "Review market unavailable" : eligible ? "Open independent review" : "Awaiting Lean acceptance"}</button><small>Publishing review work is idempotent. Repeating it cannot create duplicate jobs or credit.</small></div>}
    </div>
    {error && <p className="review-message is-error" role="status">{error}</p>}
    <p className="evidence-review-boundary"><strong>Boundary.</strong> An open or claimed job is not a signed review decision. Credit eligibility begins only after evidence-bearing review completion and still does not create a Contribution Receipt by itself.</p>
  </section>;
}
