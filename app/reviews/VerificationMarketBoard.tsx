"use client";

import { SectionTitle, CardTitle, Badge, Field, ActionLink, Button, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { type PublicVerificationJob } from "@/db/repositories/verification-market";
import { useI18n } from "@/app/i18n/client";

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
  const { t, locale } = useI18n();
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
      if (!response.ok) throw new Error(locale === "en" ? body?.error?.message ?? "The verification job could not be claimed." : t("marketBoard.error"));
      router.push("/reviews#my-review-work");
    } catch (cause) {
      setError(locale === "en" && cause instanceof Error ? cause.message : t("marketBoard.error"));
    } finally {
      setBusyId(null);
    }
  };

  return <section className="verification-market" id="open-review-work" aria-labelledby="verification-market-title">
    <SectionHeading as="div" className="verification-market-heading">
      <div><p className="eyebrow">{t("marketBoard.eyebrow")}</p><SectionTitle id="verification-market-title">{t("marketBoard.title")}</SectionTitle><p>{t("marketBoard.body")}</p></div>
      <Badge className="record-chip">{t("marketBoard.open", { count: jobs.length })}</Badge>
    </SectionHeading>
    {error && <p className="review-message is-error" role="status">{error}</p>}
    {jobs.length === 0
      ? <EmptyState as="div" className="verification-market-empty"><strong>{t("marketBoard.emptyTitle")}</strong><p>{t("marketBoard.emptyBody")}</p></EmptyState>
      : <div className="verification-job-grid">{jobs.map((job) => <Surface as="article" className="verification-job-card" key={job.id}>
        <div className="verification-job-top"><span className="micro-label">{t("marketBoard.jobLabel", { slug: job.target.projectSlug, kind: isReceiptGate(job.claimType) ? t("marketBoard.receiptGate") : t("marketBoard.qualityReview") })}</span><span className="review-share-chip">{t(job.rewardWeight === 1 ? "reviewCard.share.one" : "reviewCard.share.other", { count: job.rewardWeight })}</span></div>
        <CardTitle>{job.label}</CardTitle>
        <p className="verification-job-target">{job.target.title}</p>
        <FieldList>
          <Field label={t("marketBoard.evidenceRequired")}>{job.evidenceRequirement}</Field>
          <Field label={t("marketBoard.bundle")}><code>{shortHash(job.artifactBundleManifestHash)}</code></Field>
          <Field label={t("marketBoard.pool")}>{t("marketBoard.poolValue", { credits: job.pool.totalCredits.toLocaleString(locale), percent: job.pool.verificationBucketPercentage })}</Field>
          <Field label={t("marketBoard.submittedBy")}>{job.submittingAgentLabel}</Field>
        </FieldList>
        <div className="verification-job-actions">
          <Link className="text-link" href={`/explore/${encodeURIComponent(job.target.problemSlug)}`}>{t("marketBoard.inspectTarget")} <span>→</span></Link>
          {!signedIn
            ? <ActionLink className="button button-primary verification-claim" href={signInPath}>{t("marketBoard.signIn")}</ActionLink>
            : hasReviewDelegation
              ? <Button className="button button-primary verification-claim" type="button" disabled={busyId === job.id} onClick={() => claim(job)}>{busyId === job.id ? t("marketBoard.claiming") : t("marketBoard.claim")}</Button>
              : <ActionLink className="button button-primary verification-claim" href="/integrations#review-agent">{t("marketBoard.enableAgent")}</ActionLink>}
        </div>
      </Surface>)}</div>}
    <p className="verification-market-boundary"><strong>{t("marketBoard.boundaryTitle")}</strong> {t("marketBoard.boundaryBody")}</p>
  </section>;
}

function shortHash(value: string) {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

function isReceiptGate(claimType: string) {
  return claimType === "bundle_reproducible" || claimType === "kernel_accepted" || claimType === "project_accepted";
}
