"use client";

import { CardTitle, SectionTitle, Badge, Field, ActionLink, Button, EmptyState, FieldList, Surface } from "@/app/components/ui";

import Link from "next/link";
import { useState } from "react";
import { type ReviewAssignmentSummary } from "@/db/repositories/reviews";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";
import { reviewClaimLabel, reviewDecisionLabel, reviewStatusDetail } from "./review-presentation";
import { useI18n } from "@/app/i18n/client";

type ReviewQueueClientProps = {
  initialAssignments: readonly ReviewAssignmentSummary[];
  hasReviewDelegation: boolean;
};

export function ReviewQueueClient({ initialAssignments, hasReviewDelegation }: ReviewQueueClientProps) {
  const { t, locale } = useI18n();
  const [assignments, setAssignments] = useState(initialAssignments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeAssignmentCount = assignments.filter((assignment) => assignment.status === "assigned" || assignment.status === "accepted").length;

  const transition = async (assignment: ReviewAssignmentSummary, action: "accept" | "decline") => {
    setBusyId(assignment.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/me/review-assignments/${encodeURIComponent(assignment.id)}/${action}`, {
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(locale === "en" ? body?.error?.message ?? "The review assignment could not be updated." : t("reviewQueue.error"));
      const next = body.review.assignment as ReviewAssignmentSummary;
      setAssignments((current) => current.map((candidate) => candidate.id === next.id ? next : candidate));
      setNotice(action === "accept" ? t("reviewQueue.notice.accepted") : t("reviewQueue.notice.declined"));
    } catch (cause) {
      setError(locale === "en" && cause instanceof Error ? cause.message : t("reviewQueue.error"));
    } finally {
      setBusyId(null);
    }
  };

  return <>
    <section className="review-authority" aria-label={t("reviewQueue.authority.aria")}>
      <div><p className="eyebrow">{t("reviewQueue.authority.eyebrow")}</p><strong>{hasReviewDelegation ? t("reviewQueue.authority.activeTitle") : t("reviewQueue.authority.noTitle")}</strong><p>{hasReviewDelegation ? t("reviewQueue.authority.activeBody") : t("reviewQueue.authority.noBody")} {t("reviewQueue.authority.limit", { max: closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson })}</p></div>
      <div className="review-authority-actions"><Badge className="record-chip" aria-label={t("reviewQueue.authority.badgeAria", { active: activeAssignmentCount, max: closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson })}>{t("reviewQueue.authority.activeBadge", { active: activeAssignmentCount, max: closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson })}</Badge><Link className="text-link" href={hasReviewDelegation ? "/settings#delegation-setup" : "/integrations#review-agent"}>{hasReviewDelegation ? t("reviewQueue.authority.manage") : t("reviewQueue.authority.connect")} <span>→</span></Link></div>
    </section>
    {(notice || error) && <p className={error ? "review-message is-error" : "review-message"} role="status">{error ?? notice}</p>}
    {assignments.length === 0
      ? <EmptyState as="section" className="review-empty"><p className="eyebrow">{t("reviewQueue.empty.eyebrow")}</p><SectionTitle>{t("reviewQueue.empty.title")}</SectionTitle><p>{t("reviewQueue.empty.body")}</p><Link className="text-link" href="/explore">{t("reviewQueue.empty.action")} <span>→</span></Link></EmptyState>
      : <section className="review-list" aria-label={t("reviewQueue.listAria")}>{assignments.map((assignment) => <ReviewCard assignment={assignment} busy={busyId === assignment.id} canAttest={hasReviewDelegation} onTransition={transition} key={assignment.id} />)}</section>}
  </>;
}

function ReviewCard({ assignment, busy, canAttest, onTransition }: {
  assignment: ReviewAssignmentSummary;
  busy: boolean;
  canAttest: boolean;
  onTransition: (assignment: ReviewAssignmentSummary, action: "accept" | "decline") => void;
}) {
  const { t, locale } = useI18n();
  const state = reviewStatusDetail(assignment, canAttest, t, locale);
  return <Surface as="article" className="review-card review-queue-card">
    <div className="review-card-top"><span className="micro-label">{t("reviewCard.label", { claim: reviewClaimLabel(assignment.claimType, t) })}</span><div className="review-card-badges">{assignment.market && <span className="review-share-chip">{t(assignment.market.rewardWeight === 1 ? "reviewCard.share.one" : "reviewCard.share.other", { count: assignment.market.rewardWeight })}</span>}<span className={`review-status is-${state.tone}`}>{state.label}</span></div></div>
    <div className="review-card-copy"><CardTitle as="h2">{assignment.target.title}</CardTitle><p><code>{assignment.target.declaration}</code></p></div>
    <FieldList layout="stacked" className="review-queue-facts">
      <Field label={t("reviewCard.assigned")}>{formatReviewTime(assignment.assignedAt, locale)}</Field>
      <Field label={t("reviewCard.bundle")}><code>{shortHash(assignment.artifactBundleManifestHash)}</code></Field>
      <Field label={t("reviewCard.replay")}>{assignment.freshReplayEvidenceCount > 0 ? t("reviewCard.replayReady", { count: assignment.freshReplayEvidenceCount }) : assignment.freshReplayCount > 0 ? t("reviewCard.replayRunning") : t("reviewCard.replayNotStarted")}</Field>
      {assignment.attestation && <div><dt>{t("reviewCard.decision")}</dt><dd>{reviewDecisionLabel(assignment.attestation.decision, t)}</dd></div>}
    </FieldList>
    <div className="review-card-footer">
      <div><strong>{state.title}</strong><p>{state.detail}</p></div>
      <div className="review-actions">
        <ActionLink className="button button-secondary review-workspace-link" href={`/reviews/${encodeURIComponent(assignment.id)}`}>{assignment.status === "completed" || assignment.status === "declined" ? t("reviewCard.inspectRecord") : t("reviewCard.openWorkspace")} <span aria-hidden="true">→</span></ActionLink>
        {assignment.status === "assigned" && <div className="review-action-buttons"><Button className="button button-primary review-accept" type="button" disabled={busy} onClick={() => onTransition(assignment, "accept")}>{busy ? t("reviewCard.updating") : t("reviewCard.accept")}</Button><Button className="quiet-action" type="button" disabled={busy} onClick={() => onTransition(assignment, "decline")}>{t("reviewCard.decline")}</Button></div>}
      </div>
    </div>
  </Surface>;
}

function shortHash(value: string) {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

function formatReviewTime(value: string, locale: "en" | "zh-CN") {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
