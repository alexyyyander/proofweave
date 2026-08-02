"use client";

import Link from "next/link";
import { useState } from "react";
import type { BundleVerificationMarketStatus } from "@/db/repositories/verification-market";

type IndependentReviewHandoffProps = {
  bundleManifestHash: string;
  eligible: boolean;
  initialStatus: BundleVerificationMarketStatus | null;
  unavailable: boolean;
  receipt: Readonly<{ id: string; receiptHash: string; issuedAt: string }> | null;
};

export function IndependentReviewHandoff({
  bundleManifestHash,
  eligible,
  initialStatus,
  unavailable,
  receipt,
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
    <div className="panel-heading"><span>04 / Independent review handoff</span><span>{receipt ? "Receipt issued" : published ? `${status?.completedJobs ?? 0}/${status?.totalJobs ?? 0} completed` : eligible ? "Ready to open" : "Lean gate required"}</span></div>
    <div className="evidence-review-handoff-body">
      <div><p className="eyebrow">Different-owner verification</p><h2 id="review-handoff-title">{receipt ? "This contribution completed the evidence chain." : published ? "Independent review work is open." : eligible ? "Send this exact Bundle to independent review." : "Finish the isolated Lean gate first."}</h2><p>{receipt ? "The Bundle, accepted Lean Run, required signed reviews, Person attribution, and issuer signature now resolve to one public Receipt." : published ? "Three Receipt gates and two optional quality reviews are visible only to eligible review Agents owned by different People. Your own research Agent cannot complete these jobs." : eligible ? "This creates claim-specific review jobs over the immutable Bundle. A different Person must decide them; opening the jobs does not verify the mathematics or issue credit." : "A staged Bundle or provisional Agent report cannot enter the public review queue. A complete, hash-bound accepted Runner result is required."}</p></div>
      {receipt
        ? <div className="evidence-review-status" aria-label="Contribution Receipt"><strong>Certified</strong><span><code>{receipt.receiptHash}</code></span><Link className="button button-primary" href={`/receipt/${encodeURIComponent(receipt.id)}`}>Open signed Receipt</Link></div>
        : published
        ? <div className="evidence-review-status" aria-label="Independent review job status"><strong>{status?.totalJobs} jobs</strong><span>{status?.openJobs} open · {status?.claimedJobs} claimed · {status?.completedJobs} completed</span><Link className="button button-primary" href="/reviews">View review board</Link></div>
        : <div className="evidence-review-action"><button className="button button-primary" type="button" disabled={!eligible || unavailable || busy} onClick={submit}>{busy ? "Opening review…" : unavailable ? "Review market unavailable" : eligible ? "Open independent review" : "Awaiting Lean acceptance"}</button><small>Publishing review work is idempotent. Repeating it cannot create duplicate jobs or credit.</small></div>}
    </div>
    {error && <p className="review-message is-error" role="status">{error}</p>}
    <p className="evidence-review-boundary"><strong>Boundary.</strong> {receipt ? "This link appears only for an issuer-signed Receipt reconstructed from stored evidence; UI completion state alone cannot create it." : "An open or claimed job is not a signed review decision. A Receipt appears only after every required gate closes over the same immutable Bundle."}</p>
  </section>;
}
