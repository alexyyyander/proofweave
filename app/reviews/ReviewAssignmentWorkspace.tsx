"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  ReviewAssignmentDetail,
  ReviewAssignmentSummary,
} from "@/db/repositories/reviews";
import {
  reviewClaimLabel,
  reviewDecisionLabel,
  reviewEventLabel,
  reviewStatusDetail,
} from "./review-presentation";

type ReviewAssignmentWorkspaceProps = {
  initialReview: ReviewAssignmentDetail;
  hasReviewDelegation: boolean;
};

export function ReviewAssignmentWorkspace({ initialReview, hasReviewDelegation }: ReviewAssignmentWorkspaceProps) {
  const [review, setReview] = useState(initialReview);
  const [busy, setBusy] = useState<"accept" | "decline" | "refresh" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assignment = review.assignment;
  const state = reviewStatusDetail(assignment, hasReviewDelegation);

  const loadReview = async (action?: "accept" | "decline") => {
    const operation = action ?? "refresh";
    setBusy(operation);
    setError(null);
    setNotice(null);
    try {
      const suffix = action ? `/${action}` : "";
      const response = await fetch(`/api/me/review-assignments/${encodeURIComponent(assignment.id)}${suffix}`, action ? { method: "POST" } : undefined);
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "The review record could not be updated.");
      setReview(body.review as ReviewAssignmentDetail);
      setNotice(action === "accept" ? "Review accepted. The evidence workflow is ready." : action === "decline" ? "Review declined and preserved in the audit record." : "Review status refreshed from the control plane.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The review record could not be updated.");
    } finally {
      setBusy(null);
    }
  };

  return <>
    <section className="review-workspace-heading">
      <div><p className="eyebrow">Independent review · {reviewClaimLabel(assignment.claimType)}</p><h1>{assignment.target.title}</h1><p><code>{assignment.target.declaration}</code></p></div>
      <div className="review-workspace-heading-state"><span className={`review-status is-${state.tone}`}>{state.label}</span><button className="quiet-action" type="button" disabled={busy !== null} onClick={() => void loadReview()}>{busy === "refresh" ? "Refreshing…" : "Refresh status"}</button></div>
    </section>

    {(notice || error) && <p className={error ? "review-message is-error" : "review-message"} role="status">{error ?? notice}</p>}

    <ReviewProgress assignment={assignment} />

    <div className="review-workspace-grid">
      <div className="review-workspace-primary">
        <section className="review-workspace-panel" aria-labelledby="review-evidence-title">
          <div className="panel-heading"><span>01 / Evidence brief</span><Link className="text-link" href={`/evidence/${encodeURIComponent(assignment.artifactBundleManifestHash)}`}>Inspect controlled Bundle <span>→</span></Link></div>
          <div className="review-evidence-brief">
            <div><p className="eyebrow">Exact claim</p><h2 id="review-evidence-title">{reviewClaimLabel(assignment.claimType)}</h2><p>{claimRequirement(assignment.claimType)}</p></div>
            <ul>{claimChecklist(assignment.claimType).map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <dl className="review-metadata review-workspace-metadata">
            <div><dt>Assignment</dt><dd><code>{assignment.id}</code></dd></div>
            <div><dt>Exact Bundle</dt><dd><code>{assignment.artifactBundleManifestHash}</code></dd></div>
            <div><dt>Submitting Agent</dt><dd>{assignment.attempt.agentLabel ?? assignment.attempt.agentId ?? "Agent record unavailable"}</dd></div>
            <div><dt>Assigned</dt><dd>{assignment.assignedAt}</dd></div>
            <div><dt>Fresh replay requests</dt><dd>{assignment.freshReplayCount}</dd></div>
            <div><dt>Terminal replay evidence</dt><dd>{assignment.freshReplayEvidenceCount}</dd></div>
          </dl>
        </section>

        <section className="review-workspace-panel" aria-labelledby="review-audit-title">
          <div className="panel-heading"><span>02 / Immutable history</span><span>{review.events.length} events</span></div>
          <h2 className="visually-hidden" id="review-audit-title">Immutable review history</h2>
          <ol className="review-audit-trail review-workspace-audit">{review.events.map((event) => <li key={event.id}><span>{event.sequence}</span><div><strong>{reviewEventLabel(event.eventType)}</strong><small>{event.occurredAt}</small></div><code>{event.payloadHash}</code></li>)}</ol>
        </section>
      </div>

      <aside className="review-workspace-sidebar" aria-label="Recommended next action">
        <ReviewAction
          assignment={assignment}
          hasReviewDelegation={hasReviewDelegation}
          busy={busy}
          onTransition={loadReview}
        />
        <section className="review-boundary-card"><p className="eyebrow">Settlement boundary</p><strong>No decision, Receipt, or credit is created by opening this page.</strong><p>A completed signed review may become eligible for a fixed verification share only if the target later closes through a valid Contribution Receipt.</p></section>
      </aside>
    </div>
  </>;
}

function ReviewProgress({ assignment }: { assignment: ReviewAssignmentSummary }) {
  const accepted = assignment.status === "accepted" || assignment.status === "completed";
  const replayed = assignment.freshReplayEvidenceCount > 0;
  const completed = assignment.status === "completed";
  const steps = [
    { label: "Accept", detail: accepted ? "Recorded" : assignment.status === "declined" ? "Declined" : "Waiting", done: accepted },
    { label: "Inspect", detail: accepted ? "Bundle available" : "After acceptance", done: accepted },
    { label: "Evidence", detail: replayed ? "Fresh replay ready" : completed ? "Decision evidence recorded" : "Agent check", done: replayed || completed },
    { label: "Sign", detail: completed ? "Decision recorded" : "Owner confirmation", done: completed },
  ];
  return <ol className="review-workflow-steps" aria-label="Independent review progress">{steps.map((step, index) => <li className={step.done ? "is-done" : index === steps.findIndex((candidate) => !candidate.done) ? "is-current" : ""} key={step.label}><span>{step.done ? "✓" : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol>;
}

function ReviewAction({ assignment, hasReviewDelegation, busy, onTransition }: {
  assignment: ReviewAssignmentSummary;
  hasReviewDelegation: boolean;
  busy: "accept" | "decline" | "refresh" | null;
  onTransition: (action?: "accept" | "decline") => Promise<void>;
}) {
  if (assignment.status === "assigned") return <section className="review-next-action is-assigned"><p className="eyebrow">Recommended next action</p><h2>Accept this bounded review.</h2><p>Acceptance assigns the work to your Person record. It does not attest the claim or reserve credit.</p><div className="review-next-buttons"><button className="button button-primary" type="button" disabled={busy !== null} onClick={() => void onTransition("accept")}>{busy === "accept" ? "Accepting…" : "Accept review"}</button><button className="quiet-action" type="button" disabled={busy !== null} onClick={() => void onTransition("decline")}>{busy === "decline" ? "Declining…" : "Decline"}</button></div></section>;

  if (assignment.status === "declined") return <section className="review-next-action is-terminal"><p className="eyebrow">Review closed</p><h2>This assignment was declined.</h2><p>The decision to decline remains in the immutable history. No mathematical claim or review share was created.</p><Link className="button button-secondary" href="/reviews">Return to review queue</Link></section>;

  if (assignment.status === "completed") return <section className="review-next-action is-complete"><p className="eyebrow">Signed decision recorded</p><h2>{assignment.attestation ? reviewDecisionLabel(assignment.attestation.decision) : "Review completed"}</h2><p>{assignment.attestation ? `Evidence ${assignment.attestation.evidenceHash} is bound to this exact claim.` : "The completed state has no readable attestation summary."}</p>{assignment.attestation && <dl><div><dt>Attestation</dt><dd><code>{assignment.attestation.id}</code></dd></div><div><dt>Recorded</dt><dd>{assignment.attestation.attestedAt}</dd></div></dl>}<Link className="button button-secondary" href={`/evidence/${encodeURIComponent(assignment.artifactBundleManifestHash)}`}>Inspect evidence record</Link></section>;

  if (!hasReviewDelegation) return <section className="review-next-action"><p className="eyebrow">Agent authority required</p><h2>Connect a review-scoped Agent.</h2><p>The assigned Person must explicitly delegate review authority before an Agent can request a replay or sign a decision.</p><Link className="button button-primary" href="/integrations#review-agent">Connect review Agent <span aria-hidden="true">→</span></Link></section>;

  return <section className="review-next-action"><p className="eyebrow">Recommended next action</p><h2>{assignment.freshReplayEvidenceCount > 0 ? "Prepare the evidence-bound decision." : assignment.freshReplayCount > 0 ? "Check the fresh replay." : "Continue with your review Agent."}</h2><p>{assignment.freshReplayEvidenceCount > 0 ? "The infrastructure replay is terminal. Your Agent must still perform the requested claim check and show you the exact signed draft before submission." : assignment.freshReplayCount > 0 ? "A replay request exists but no terminal evidence is visible yet. Ask your Agent to inspect the exact replay state." : "Your Agent will inspect this assignment and Bundle first. It must wait for your approval before starting execution or preparing a signed conclusion."}</p><ReviewAgentPrompt assignment={assignment} /><Link className="text-link" href="/integrations#review-agent">Review Agent connection <span>→</span></Link></section>;
}

function ReviewAgentPrompt({ assignment }: { assignment: ReviewAssignmentSummary }) {
  const [copied, setCopied] = useState(false);
  const prompt = reviewAgentPrompt(assignment);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };
  return <button className="button button-primary review-agent-prompt" type="button" onClick={() => void copy()}>{copied ? "Agent task copied" : assignment.freshReplayEvidenceCount > 0 ? "Copy decision task" : assignment.freshReplayCount > 0 ? "Copy replay check" : "Copy Agent task"}</button>;
}

function reviewAgentPrompt(assignment: ReviewAssignmentSummary) {
  const claimTask = {
    bundle_reproducible: "Request one fresh isolated replay if none exists, poll it to a terminal result, and use only that exact replay evidence hash for any positive bundle_reproducible decision.",
    statement_faithful: "Compare the source-pinned informal statement, Lean declaration, normalized patch, hypotheses, and conclusion. Identify scope drift or hidden assumptions. A fresh replay is supporting infrastructure evidence, not sufficient statement-fidelity evidence.",
    novelty_reviewed: "Build a cited, date-stamped search record across the stated upstream sources and relevant current literature. Separate formal novelty from mathematical novelty. A Lean replay is not novelty evidence.",
  }[assignment.claimType] ?? "Inspect the exact claim and collect immutable evidence that directly supports or refutes it.";
  return `Continue my Proofweave independent review. Use list_review_assignments to locate assignment ${assignment.id}, then use get_review_assignment and verify that its Bundle hash is ${assignment.artifactBundleManifestHash} and its claim is ${assignment.claimType}. Summarize the controlled target, existing replay state, and evidence requirement before taking action. ${claimTask} If the needed evidence is not in Proofweave's immutable artifact index, stop and tell me what evidence still needs to be staged. Once you reach an evidence-based decision, use prepare_verification_attestation and show me the exact assignment, Bundle hash, claim, decision, evidence hash, and payload hash. Do not call submit_prepared_verification_attestation unless I explicitly approve that unchanged signed draft.`;
}

function claimRequirement(claimType: string) {
  return {
    bundle_reproducible: "Rebuild this exact content-addressed Bundle in a new isolated workspace and bind any positive conclusion to that replay's terminal evidence hash.",
    statement_faithful: "Compare the source-pinned mathematical intent with the exact formal declaration, including hypotheses, quantifiers, domains, and conclusion.",
    novelty_reviewed: "Produce a current, cited search record that distinguishes a new formal artifact from a genuinely new mathematical result.",
  }[claimType] ?? "Check the requested claim against evidence that is immutable, specific, and independently attributable.";
}

function claimChecklist(claimType: string) {
  if (claimType === "bundle_reproducible") return [
    "Use a fresh isolated workspace owned by the reviewer Agent.",
    "Match the exact Bundle manifest and pinned Lean environment.",
    "Bind a positive decision to the terminal replay evidence hash.",
  ];
  if (claimType === "statement_faithful") return [
    "Read the cited upstream statement and source revision.",
    "Compare every hypothesis, quantifier, domain, and conclusion.",
    "Record mismatches or a source-linked fidelity report as immutable evidence.",
  ];
  if (claimType === "novelty_reviewed") return [
    "Search the named upstream project and current literature.",
    "Cite queries, sources, dates, and the closest prior results.",
    "State whether novelty is formal, mathematical, or unresolved.",
  ];
  return ["Inspect the exact Bundle.", "Record claim-specific evidence.", "Sign only the conclusion the evidence supports."];
}
