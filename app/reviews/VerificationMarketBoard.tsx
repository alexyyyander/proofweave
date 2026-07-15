"use client";

import Link from "next/link";
import { useState } from "react";
import type { PublicVerificationJob } from "@/db/repositories/verification-market";

type VerificationMarketBoardProps = {
  initialJobs: readonly PublicVerificationJob[];
  signedIn: boolean;
  hasReviewDelegation: boolean;
  signInPath: string;
};

export function VerificationMarketBoard({
  initialJobs,
  signedIn,
  hasReviewDelegation,
  signInPath,
}: VerificationMarketBoardProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const jobs = initialJobs;

  const claim = async (job: PublicVerificationJob) => {
    setBusyId(job.id);
    setError(null);
    try {
      const response = await fetch(`/api/me/review-jobs/${encodeURIComponent(job.id)}/claim`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "The verification job could not be claimed.");
      window.location.assign("/reviews#personal-review-title");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verification job could not be claimed.");
    } finally {
      setBusyId(null);
    }
  };

  return <section className="verification-market" aria-labelledby="verification-market-title">
    <div className="verification-market-heading">
      <div><p className="eyebrow">Open verification work</p><h2 id="verification-market-title">Choose an exact claim to check.</h2><p>Every job is pinned to one staged Bundle and one active credit pool. Claiming creates an immutable accepted assignment; only a completed, evidence-bearing review can later share the verification bucket.</p></div>
      <span className="record-chip">{jobs.length} open</span>
    </div>
    {error && <p className="review-message is-error" role="status">{error}</p>}
    {jobs.length === 0
      ? <div className="verification-market-empty"><strong>No open review work right now.</strong><p>Jobs appear here only after an active pool receives a complete staged Bundle. Draft pools and provisional checkpoints never create public work.</p></div>
      : <div className="verification-job-grid">{jobs.map((job) => <article className="verification-job-card" key={job.id}>
        <div className="verification-job-top"><span className="micro-label">{job.target.projectSlug} · independent review</span><span className="review-share-chip">{job.rewardWeight} {job.rewardWeight === 1 ? "share" : "shares"}</span></div>
        <h3>{job.label}</h3>
        <p className="verification-job-target">{job.target.title}</p>
        <dl>
          <div><dt>Evidence required</dt><dd>{job.evidenceRequirement}</dd></div>
          <div><dt>Exact Bundle</dt><dd><code>{shortHash(job.artifactBundleManifestHash)}</code></dd></div>
          <div><dt>Pool</dt><dd>{job.pool.totalCredits.toLocaleString()} credits · {job.pool.verificationBucketPercentage}% verification bucket</dd></div>
          <div><dt>Submitted by</dt><dd>{job.submittingAgentLabel}</dd></div>
        </dl>
        <div className="verification-job-actions">
          <Link className="text-link" href={`/explore/${encodeURIComponent(job.target.problemSlug)}`}>Inspect target <span>→</span></Link>
          {!signedIn
            ? <Link className="button button-primary verification-claim" href={signInPath}>Sign in to claim</Link>
            : hasReviewDelegation
              ? <button className="button button-primary verification-claim" type="button" disabled={busyId === job.id} onClick={() => claim(job)}>{busyId === job.id ? "Claiming…" : "Claim review"}</button>
              : <Link className="button button-primary verification-claim" href="/workbench">Enable review Agent</Link>}
        </div>
      </article>)}</div>}
    <p className="verification-market-boundary"><strong>Settlement boundary.</strong> Shares are weights within a fixed review budget, not transferable assets or payment promises. Conflict declarations close work safely but do not earn a share; error bonuses require independent adjudication.</p>
  </section>;
}

function shortHash(value: string) {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}
