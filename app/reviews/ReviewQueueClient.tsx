"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReviewAssignmentEvent, ReviewAssignmentSummary } from "@/db/repositories/reviews";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";

type ReviewQueueClientProps = {
  initialAssignments: readonly ReviewAssignmentSummary[];
  hasReviewDelegation: boolean;
};

export function ReviewQueueClient({ initialAssignments, hasReviewDelegation }: ReviewQueueClientProps) {
  const [assignments, setAssignments] = useState(initialAssignments);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<Record<string, readonly ReviewAssignmentEvent[]>>({});
  const [openAuditId, setOpenAuditId] = useState<string | null>(null);
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
      const events = body.review.events as readonly ReviewAssignmentEvent[];
      setAssignments((current) => current.map((candidate) => candidate.id === next.id ? next : candidate));
      setAuditEvents((current) => ({ ...current, [next.id]: events }));
      setNotice(action === "accept" ? "Review accepted. The event is now part of the immutable review history." : "Review declined. The assignment remains historically inspectable.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The review assignment could not be updated.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleAudit = async (assignmentId: string) => {
    setError(null);
    setNotice(null);
    if (openAuditId === assignmentId) {
      setOpenAuditId(null);
      return;
    }
    if (auditEvents[assignmentId]) {
      setOpenAuditId(assignmentId);
      return;
    }
    try {
      const response = await fetch(`/api/me/review-assignments/${encodeURIComponent(assignmentId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "The audit history could not be loaded.");
      const events = body.review.events as readonly ReviewAssignmentEvent[];
      setAuditEvents((current) => ({ ...current, [assignmentId]: events }));
      setOpenAuditId(assignmentId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The audit history could not be loaded.");
    }
  };

  return <>
    <section className="review-authority" aria-label="Review authority status">
      <div><p className="eyebrow">Your verification boundary</p><strong>{hasReviewDelegation ? "A scoped review delegation is active." : "No active review delegation yet."}</strong><p>{hasReviewDelegation ? "Your local review Agent can request a fresh replay, prepare its signed decision locally, and submit only the exact attestation you approve." : "You may inspect or respond to an assignment, but an Agent needs an active `review` delegation before any attestation can be accepted."} Closed alpha permits at most {closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active independent reviews per Person, regardless of Agent count.</p></div>
      <div className="review-authority-actions"><span className="record-chip" aria-label={`${activeAssignmentCount} of ${closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active independent reviews`}>{activeAssignmentCount}/{closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active</span><Link className="text-link" href={hasReviewDelegation ? "/settings#delegation-setup" : "/integrations#review-agent"}>{hasReviewDelegation ? "Manage Agent authority" : "Connect a review Agent"} <span>→</span></Link></div>
    </section>
    {(notice || error) && <p className={error ? "review-message is-error" : "review-message"} role="status">{error ?? notice}</p>}
    {assignments.length === 0
      ? <section className="review-empty"><p className="eyebrow">No assigned work</p><h2>Your review queue is clear.</h2><p>Independent review is assigned to a Person, never merely to an Agent. New assignments will appear here when an eligible bundle is routed to you.</p><Link className="text-link" href="/explore">Explore current research targets <span>→</span></Link></section>
      : <section className="review-list" aria-label="Assigned independent reviews">{assignments.map((assignment) => <ReviewCard assignment={assignment} auditEvents={auditEvents[assignment.id]} busy={busyId === assignment.id} canAttest={hasReviewDelegation} isAuditOpen={openAuditId === assignment.id} onToggleAudit={toggleAudit} onTransition={transition} key={assignment.id} />)}</section>}
  </>;
}

function ReviewCard({ assignment, auditEvents, busy, canAttest, isAuditOpen, onToggleAudit, onTransition }: {
  assignment: ReviewAssignmentSummary;
  auditEvents: readonly ReviewAssignmentEvent[] | undefined;
  busy: boolean;
  canAttest: boolean;
  isAuditOpen: boolean;
  onToggleAudit: (assignmentId: string) => void;
  onTransition: (assignment: ReviewAssignmentSummary, action: "accept" | "decline") => void;
}) {
  const state = statusDetail(assignment, canAttest);
  return <article className="review-card">
    <div className="review-card-top"><span className="micro-label">Independent review · {claimLabel(assignment.claimType)}</span><div className="review-card-badges">{assignment.market && <span className="review-share-chip">Market · {assignment.market.rewardWeight} {assignment.market.rewardWeight === 1 ? "share" : "shares"}</span>}<span className={`review-status is-${state.tone}`}>{state.label}</span></div></div>
    <div className="review-card-copy"><h2>{assignment.target.title}</h2><p><code>{assignment.target.declaration}</code></p></div>
    <dl className="review-metadata">
      <div><dt>Project</dt><dd>{assignment.target.projectSlug}</dd></div>
      <div><dt>Assigned</dt><dd>{assignment.assignedAt}</dd></div>
      <div><dt>Submitting Agent</dt><dd>{assignment.attempt.agentLabel ?? assignment.attempt.agentId ?? "Agent record unavailable"}</dd></div>
      <div><dt>Evidence bundle</dt><dd><code>{assignment.artifactBundleManifestHash}</code></dd></div>
      <div><dt>Fresh workspace replays</dt><dd>{assignment.freshReplayCount} recorded</dd></div>
      <div><dt>Terminal replay evidence</dt><dd>{assignment.freshReplayEvidenceCount} ready</dd></div>
      {assignment.market && <><div><dt>Market pool</dt><dd><code>{assignment.market.poolId}</code></dd></div><div><dt>Settlement basis</dt><dd>{assignment.market.rewardWeight} weighted {assignment.market.rewardWeight === 1 ? "share" : "shares"}; no credits reserved</dd></div></>}
      {assignment.attestation && <><div><dt>Signed decision</dt><dd>{decisionLabel(assignment.attestation.decision)}</dd></div><div><dt>Decision evidence</dt><dd><code>{assignment.attestation.evidenceHash}</code></dd></div></>}
    </dl>
    <div className="review-card-footer">
      <div><strong>{state.title}</strong><p>{state.detail}</p></div>
      <div className="review-actions">
        <Link className="text-link" href={`/explore/${encodeURIComponent(assignment.target.problemSlug)}`}>Inspect target <span>→</span></Link>
        <Link className="text-link" href={`/evidence/${encodeURIComponent(assignment.artifactBundleManifestHash)}`}>Inspect evidence <span>→</span></Link>
        <button className="quiet-action review-audit-toggle" type="button" onClick={() => onToggleAudit(assignment.id)}>{isAuditOpen ? "Hide audit trail" : "View audit trail"}</button>
        {assignment.status === "assigned" && <div className="review-action-buttons"><button className="button button-primary review-accept" type="button" disabled={busy} onClick={() => onTransition(assignment, "accept")}>{busy ? "Updating…" : "Accept review"}</button><button className="quiet-action" type="button" disabled={busy} onClick={() => onTransition(assignment, "decline")}>Decline</button></div>}
      </div>
    </div>
    {assignment.status === "accepted" && <aside className="review-replay-guide"><div><span className="micro-label">Fresh replay · Agent action</span><strong>{assignment.freshReplayEvidenceCount > 0 ? `${assignment.freshReplayEvidenceCount} terminal replay evidence ${assignment.freshReplayEvidenceCount === 1 ? "object is" : "objects are"} ready` : assignment.freshReplayCount > 0 ? "Replay is running or awaiting terminal evidence" : "No fresh workspace replay yet"}</strong><p>Send this review to the connected Agent with one click. It first inspects the assignment and canonical Bundle, then requests a fresh replay with its own idempotency key. A positive <code>bundle_reproducible</code> attestation still needs the terminal evidence hash and a separate owner confirmation.</p></div><ReviewCodexPrompt assignmentId={assignment.id} /></aside>}
    {isAuditOpen && <ol className="review-audit-trail" aria-label="Immutable review history">{(auditEvents ?? []).map((event) => <li key={event.id}><span>{event.sequence}</span><div><strong>{eventLabel(event.eventType)}</strong><small>{event.occurredAt}</small></div><code>{event.payloadHash}</code></li>)}</ol>}
  </article>;
}

function ReviewCodexPrompt({ assignmentId }: { assignmentId: string }) {
  const [copied, setCopied] = useState(false);
  const request = `Continue my accepted Proofweave review assignment ${assignmentId}. First use get_review_assignment and summarize the target, requested claim, canonical Bundle manifest, and existing replay state. Wait for me before requesting a fresh replay or preparing any signed decision.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(request);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return <button className="button button-secondary" type="button" onClick={() => { void copy(); }}>
    {copied ? "Review request copied" : "Send this review to Codex"}
  </button>;
}

function claimLabel(value: string) {
  return {
    bundle_reproducible: "Bundle reproduction",
    kernel_accepted: "Kernel acceptance",
    statement_faithful: "Statement fidelity",
    novelty_reviewed: "Novelty review",
    project_accepted: "Project acceptance",
  }[value] ?? value;
}

function statusDetail(assignment: ReviewAssignmentSummary, canAttest: boolean) {
  if (assignment.status === "assigned") return {
    label: "Awaiting response",
    tone: "assigned",
    title: "Decide whether to take this review.",
    detail: "Acceptance and decline are immutable review events. Neither action creates a mathematical claim.",
  };
  if (assignment.status === "accepted") return {
    label: "Accepted",
    tone: "accepted",
    title: canAttest ? "Prepare signed Agent evidence outside the browser." : "Set up a review-scoped Agent before attesting.",
    detail: canAttest ? "The local Connector prepares the Agent signature on this computer and submits only the exact owner-approved attestation against this Bundle hash." : "This queue never fabricates an Agent signature or lets a Person attest with a non-review authority.",
  };
  if (assignment.status === "completed") return completedStatusDetail(assignment);
  return {
    label: "Declined",
    tone: "declined",
    title: "This review was not taken.",
    detail: `Declined at ${assignment.declinedAt ?? "the recorded time"}. The assignment remains in the audit history.`,
  };
}

function completedStatusDetail(assignment: ReviewAssignmentSummary) {
  const decision = assignment.attestation?.decision;
  const completedAt = assignment.attestation?.attestedAt ?? assignment.completedAt ?? "the recorded attestation time";
  if (decision === "attested") return {
    label: "Attested",
    tone: "completed",
    title: "A signed attestation is recorded.",
    detail: `The exact claim was attested at ${completedAt}. Its certificate and evidence stay immutable.`,
  };
  if (decision === "rejected") return {
    label: "Rejected",
    tone: "rejected",
    title: "A signed rejection is recorded.",
    detail: `This claim was rejected at ${completedAt}; it cannot satisfy a receipt gate. The evidence remains available for audit.`,
  };
  if (decision === "request_changes") return {
    label: "Changes requested",
    tone: "request-changes",
    title: "A signed request for changes is recorded.",
    detail: `The review closed at ${completedAt} without attesting this claim. A revised Bundle requires a new immutable review assignment.`,
  };
  if (decision === "conflict_declared") return {
    label: "Conflict declared",
    tone: "rejected",
    title: "A signed conflict declaration is recorded.",
    detail: `The reviewer declared a conflict at ${completedAt}. This assignment is closed and cannot satisfy a receipt gate; route any replacement review to another Person.`,
  };
  if (decision === "integrity_flagged") return {
    label: "Integrity flag",
    tone: "rejected",
    title: "A signed evidence-integrity flag is recorded.",
    detail: `The reviewer flagged the covered evidence at ${completedAt}. It is not a mathematical conclusion or an automatic retraction, but this assignment cannot satisfy a receipt gate and needs curator follow-up.`,
  };
  return {
    label: "Decision unavailable",
    tone: "declined",
    title: "The completed review has no readable signed decision.",
    detail: "This record cannot be treated as an attestation or a receipt gate until its immutable evidence is available.",
  };
}

function decisionLabel(value: NonNullable<ReviewAssignmentSummary["attestation"]>["decision"]) {
  return {
    attested: "Attested",
    rejected: "Rejected",
    request_changes: "Changes requested",
    conflict_declared: "Conflict declared",
    integrity_flagged: "Integrity flag",
  }[value];
}

function eventLabel(value: ReviewAssignmentEvent["eventType"]) {
  return {
    assignment_created: "Assignment created",
    assignment_accepted: "Review accepted",
    assignment_declined: "Review declined",
    attestation_recorded: "Signed attestation recorded",
  }[value];
}
