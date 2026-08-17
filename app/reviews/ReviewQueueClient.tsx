"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReviewAssignmentSummary } from "@/db/repositories/reviews";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";
import {
  reviewClaimLabel,
  reviewDecisionLabel,
  reviewStatusDetail,
} from "./review-presentation";

type ReviewQueueClientProps = {
  initialAssignments: readonly ReviewAssignmentSummary[];
  hasReviewDelegation: boolean;
};

export function ReviewQueueClient({ initialAssignments, hasReviewDelegation }: ReviewQueueClientProps) {
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
      if (!response.ok) throw new Error(body?.error?.message ?? "The review assignment could not be updated.");
      const next = body.review.assignment as ReviewAssignmentSummary;
      setAssignments((current) => current.map((candidate) => candidate.id === next.id ? next : candidate));
      setNotice(action === "accept" ? "Review accepted. Open its workspace to begin the evidence check." : "Review declined. The immutable assignment remains inspectable.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The review assignment could not be updated.");
    } finally {
      setBusyId(null);
    }
  };

  return <>
    <section className="review-authority" aria-label="Review authority status">
      <div><p className="eyebrow">Your verification boundary</p><strong>{hasReviewDelegation ? "A scoped review delegation is active." : "No active review delegation yet."}</strong><p>{hasReviewDelegation ? "Your local review Agent can request a fresh replay, prepare its signed decision locally, and submit only the exact attestation you approve." : "You may inspect or respond to an assignment, but an Agent needs an active `review` delegation before any attestation can be accepted."} Closed alpha permits at most {closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active independent reviews per Person, regardless of Agent count.</p></div>
      <div className="review-authority-actions"><span className="record-chip" aria-label={`${activeAssignmentCount} of ${closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active independent reviews`}>{activeAssignmentCount}/{closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active</span><Link className="text-link" href={hasReviewDelegation ? "/settings#delegation-setup" : "/integrations#review-agent"}>{hasReviewDelegation ? "Manage Agent authority" : "Connect a review Agent"} <span>→</span></Link></div>
    </section>
    {(notice || error) && <p className={error ? "review-message is-error" : "review-message"} role="status">{error ?? notice}</p>}
    {assignments.length === 0
      ? <section className="review-empty"><p className="eyebrow">No assigned work</p><h2>Your review queue is clear.</h2><p>Independent review is assigned to a Person, never merely to an Agent. New assignments will appear here when an eligible Bundle is routed to you.</p><Link className="text-link" href="/explore">Explore current research targets <span>→</span></Link></section>
      : <section className="review-list" aria-label="Assigned independent reviews">{assignments.map((assignment) => <ReviewCard assignment={assignment} busy={busyId === assignment.id} canAttest={hasReviewDelegation} onTransition={transition} key={assignment.id} />)}</section>}
  </>;
}

function ReviewCard({ assignment, busy, canAttest, onTransition }: {
  assignment: ReviewAssignmentSummary;
  busy: boolean;
  canAttest: boolean;
  onTransition: (assignment: ReviewAssignmentSummary, action: "accept" | "decline") => void;
}) {
  const state = reviewStatusDetail(assignment, canAttest);
  return <article className="review-card review-queue-card">
    <div className="review-card-top"><span className="micro-label">Independent review · {reviewClaimLabel(assignment.claimType)}</span><div className="review-card-badges">{assignment.market && <span className="review-share-chip">{assignment.market.rewardWeight} {assignment.market.rewardWeight === 1 ? "share" : "shares"}</span>}<span className={`review-status is-${state.tone}`}>{state.label}</span></div></div>
    <div className="review-card-copy"><h2>{assignment.target.title}</h2><p><code>{assignment.target.declaration}</code></p></div>
    <dl className="review-queue-facts">
      <div><dt>Assigned</dt><dd>{formatReviewTime(assignment.assignedAt)}</dd></div>
      <div><dt>Exact Bundle</dt><dd><code>{shortHash(assignment.artifactBundleManifestHash)}</code></dd></div>
      <div><dt>Fresh replay</dt><dd>{assignment.freshReplayEvidenceCount > 0 ? `${assignment.freshReplayEvidenceCount} terminal evidence ready` : assignment.freshReplayCount > 0 ? "Running or awaiting evidence" : "Not started"}</dd></div>
      {assignment.attestation && <div><dt>Decision</dt><dd>{reviewDecisionLabel(assignment.attestation.decision)}</dd></div>}
    </dl>
    <div className="review-card-footer">
      <div><strong>{state.title}</strong><p>{state.detail}</p></div>
      <div className="review-actions">
        <Link className="button button-secondary review-workspace-link" href={`/reviews/${encodeURIComponent(assignment.id)}`}>{assignment.status === "completed" || assignment.status === "declined" ? "Inspect review record" : "Open review workspace"} <span aria-hidden="true">→</span></Link>
        {assignment.status === "assigned" && <div className="review-action-buttons"><button className="button button-primary review-accept" type="button" disabled={busy} onClick={() => onTransition(assignment, "accept")}>{busy ? "Updating…" : "Accept"}</button><button className="quiet-action" type="button" disabled={busy} onClick={() => onTransition(assignment, "decline")}>Decline</button></div>}
      </div>
    </div>
  </article>;
}

function shortHash(value: string) {
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

function formatReviewTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
