"use client";

import { SectionTitle, ActionLink, Button } from "@/app/components/ui";

import { useState } from "react";
import { type BundleVerificationMarketStatus } from "@/db/repositories/verification-market";
import { useI18n } from "@/app/i18n/client";

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
  const { t, locale } = useI18n();
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
      if (!response.ok) throw new Error(locale === "en" ? body?.error?.message ?? "Independent review work could not be opened." : t("handoff.error"));
      setStatus(body.reviewMarket.status);
    } catch (cause) {
      setError(locale === "en" && cause instanceof Error ? cause.message : t("handoff.error"));
    } finally {
      setBusy(false);
    }
  };

  return <section className="evidence-runs evidence-review-handoff" aria-labelledby="review-handoff-title">
    <div className="panel-heading"><span>{t("handoff.panel")}</span><span>{receipt ? t("handoff.statusReceipt") : published ? t("handoff.statusProgress", { done: status?.completedJobs ?? 0, total: status?.totalJobs ?? 0 }) : eligible ? t("handoff.statusReady") : t("handoff.statusLeanGate")}</span></div>
    <div className="evidence-review-handoff-body">
      <div><p className="eyebrow">{t("handoff.eyebrow")}</p><SectionTitle id="review-handoff-title">{receipt ? t("handoff.titleReceipt") : published ? t("handoff.titlePublished") : eligible ? t("handoff.titleEligible") : t("handoff.titleNeedsLean")}</SectionTitle><p>{receipt ? t("handoff.bodyReceipt") : published ? t("handoff.bodyPublished") : eligible ? t("handoff.bodyEligible") : t("handoff.bodyNeedsLean")}</p></div>
      {receipt
        ? <div className="evidence-review-status" aria-label={t("handoff.statusReceipt")}><strong>{t("handoff.certified")}</strong><span><code>{receipt.receiptHash}</code></span><ActionLink className="button button-primary" href={`/receipt/${encodeURIComponent(receipt.id)}`}>{t("handoff.openReceipt")}</ActionLink></div>
        : published
        ? <div className="evidence-review-status" aria-label={t("handoff.statusPublished")}><strong>{t("handoff.jobs", { count: status?.totalJobs ?? 0 })}</strong><span>{t("handoff.jobStatus", { open: status?.openJobs ?? 0, claimed: status?.claimedJobs ?? 0, completed: status?.completedJobs ?? 0 })}</span><ActionLink className="button button-primary" href="/reviews">{t("handoff.viewBoard")}</ActionLink></div>
        : <div className="evidence-review-action"><Button className="button button-primary" type="button" disabled={!eligible || unavailable || busy} onClick={submit}>{busy ? t("handoff.opening") : unavailable ? t("handoff.unavailable") : eligible ? t("handoff.open") : t("handoff.awaiting")}</Button><small>{t("handoff.idempotent")}</small></div>}
    </div>
    {error && <p className="review-message is-error" role="status">{error}</p>}
    <p className="evidence-review-boundary"><strong>{t("handoff.boundaryTitle")}</strong> {receipt ? t("handoff.boundaryReceipt") : t("handoff.boundaryDefault")}</p>
  </section>;
}
