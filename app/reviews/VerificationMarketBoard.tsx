"use client";

import { SectionTitle, CardTitle, Badge, Field, ActionLink, Button, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type PublicVerificationJob } from "@/db/repositories/verification-market";

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
  const router = useRouter();
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
      router.push("/reviews#my-review-work");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verification job could not be claimed.");
    } finally {
      setBusyId(null);
    }
  };

  return <section className="verification-market" id="open-review-work" aria-labelledby="verification-market-title">
    <SectionHeading as="div" className="verification-market-heading">
      <div><p className="eyebrow">Open verification work</p><SectionTitle id="verification-market-title">Choose an exact claim to check.</SectionTitle><p>Every job is pinned to one Lean-accepted Bundle and one active credit pool. Claiming creates an immutable accepted assignment; only a completed, evidence-bearing review can later share the verification bucket.</p></div>
      <Badge className="record-chip">{jobs.length} open</Badge>
    </SectionHeading>
    {error && <p className="review-message is-error" role="status">{error}</p>}
    {jobs.length === 0
      ? <EmptyState as="div" className="verification-market-empty"><strong>No open review work right now.</strong><p>Jobs appear here only after an active pool receives a complete Bundle with accepted isolated Lean evidence. Draft pools, staged-only Bundles, and provisional checkpoints never create public work.</p></EmptyState>
      : <div className="verification-job-grid">{jobs.map((job) => <Surface as="article" className="verification-job-card" key={job.id}>
        <div className="verification-job-top"><span className="micro-label">{job.target.projectSlug} · {isReceiptGate(job.claimType) ? "Receipt gate" : "quality review"}</span><span className="review-share-chip">{job.rewardWeight} {job.rewardWeight === 1 ? "share" : "shares"}</span></div>
        <CardTitle>{job.label}</CardTitle>
        <p className="verification-job-target">{job.target.title}</p>
        <FieldList>
          <Field label="Evidence required">{job.evidenceRequirement}</Field>
          <Field label="Exact Bundle"><code>{shortHash(job.artifactBundleManifestHash)}</code></Field>
          <Field label="Pool">{job.pool.totalCredits.toLocaleString()} credits · {job.pool.verificationBucketPercentage}% verification bucket</Field>
          <Field label="Submitted by">{job.submittingAgentLabel}</Field>
        </FieldList>
        <div className="verification-job-actions">
          <Link className="text-link" href={`/explore/${encodeURIComponent(job.target.problemSlug)}`}>Inspect target <span>→</span></Link>
          {!signedIn
            ? <ActionLink className="button button-primary verification-claim" href={signInPath}>Sign in to claim</ActionLink>
            : hasReviewDelegation
              ? <Button className="button button-primary verification-claim" type="button" disabled={busyId === job.id} onClick={() => claim(job)}>{busyId === job.id ? "Claiming…" : "Claim review"}</Button>
              : <ActionLink className="button button-primary verification-claim" href="/integrations#review-agent">Enable review Agent</ActionLink>}
        </div>
      </Surface>)}</div>}
    <p className="verification-market-boundary"><strong>Settlement boundary.</strong> Shares are weights within a fixed review budget, not transferable assets or payment promises. Conflict declarations close work safely but do not earn a share; error bonuses require independent adjudication.</p>
  </section>;
}

function shortHash(value: string) {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

function isReceiptGate(claimType: string) {
  return claimType === "bundle_reproducible" || claimType === "kernel_accepted" || claimType === "project_accepted";
}
