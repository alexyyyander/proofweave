"use client";

import { PageTitle, SectionTitle, Field, ActionLink, Button, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import Link from "next/link";
import { useState } from "react";
import { type ReviewAssignmentDetail, type ReviewAssignmentSummary } from "@/db/repositories/reviews";
import { reviewClaimLabel, reviewDecisionLabel, reviewEventLabel, reviewStatusDetail } from "./review-presentation";
import { useI18n } from "@/app/i18n/client";
import type { Locale } from "@/app/i18n/config";
import type { Translator } from "@/app/i18n/translate";

type ReviewAssignmentWorkspaceProps = {
  initialReview: ReviewAssignmentDetail;
  hasReviewDelegation: boolean;
};

export function ReviewAssignmentWorkspace({ initialReview, hasReviewDelegation }: ReviewAssignmentWorkspaceProps) {
  const { t, locale } = useI18n();
  const [review, setReview] = useState(initialReview);
  const [busy, setBusy] = useState<"accept" | "decline" | "refresh" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const assignment = review.assignment;
  const state = reviewStatusDetail(assignment, hasReviewDelegation, t, locale);

  const loadReview = async (action?: "accept" | "decline") => {
    const operation = action ?? "refresh";
    setBusy(operation);
    setError(null);
    setNotice(null);
    try {
      const suffix = action ? `/${action}` : "";
      const response = await fetch(`/api/me/review-assignments/${encodeURIComponent(assignment.id)}${suffix}`, action ? { method: "POST" } : undefined);
      const body = await response.json();
      if (!response.ok) throw new Error(locale === "en" ? body?.error?.message ?? "The review record could not be updated." : t("reviewWorkspace.error"));
      setReview(body.review as ReviewAssignmentDetail);
      setNotice(action === "accept" ? t("reviewWorkspace.notice.accepted") : action === "decline" ? t("reviewWorkspace.notice.declined") : t("reviewWorkspace.notice.refreshed"));
    } catch (cause) {
      setError(locale === "en" && cause instanceof Error ? cause.message : t("reviewWorkspace.error"));
    } finally {
      setBusy(null);
    }
  };

  return <>
    <SectionHeading as="section" className="review-workspace-heading">
      <div><p className="eyebrow">{t("reviewWorkspace.eyebrow", { claim: reviewClaimLabel(assignment.claimType, t) })}</p><PageTitle>{assignment.target.title}</PageTitle><p><code>{assignment.target.declaration}</code></p></div>
      <div className="review-workspace-heading-state"><span className={`review-status is-${state.tone}`}>{state.label}</span><Button className="quiet-action" type="button" disabled={busy !== null} onClick={() => void loadReview()}>{busy === "refresh" ? t("reviewWorkspace.refreshing") : t("reviewWorkspace.refresh")}</Button></div>
    </SectionHeading>

    {(notice || error) && <p className={error ? "review-message is-error" : "review-message"} role="status">{error ?? notice}</p>}

    <ReviewProgress assignment={assignment} />

    <div className="review-workspace-grid">
      <div className="review-workspace-primary">
        <Surface as="section" className="review-workspace-panel" aria-labelledby="review-evidence-title">
          <div className="panel-heading"><span>{t("reviewWorkspace.panel.evidence")}</span><Link className="text-link" href={`/evidence/${encodeURIComponent(assignment.artifactBundleManifestHash)}`}>{t("reviewWorkspace.inspectBundle")} <span>→</span></Link></div>
          <div className="review-evidence-brief">
            <div><p className="eyebrow">{t("reviewWorkspace.exactClaim")}</p><SectionTitle id="review-evidence-title">{reviewClaimLabel(assignment.claimType, t)}</SectionTitle><p>{claimRequirement(assignment.claimType, t)}</p></div>
            <ul>{claimChecklist(assignment.claimType, t).map((item) => <li key={item}>{item}</li>)}</ul>
          </div>
          <FieldList className="review-metadata review-workspace-metadata">
            <Field label={t("reviewWorkspace.field.assignment")}><code>{assignment.id}</code></Field>
            <Field label={t("reviewWorkspace.field.bundle")}><code>{assignment.artifactBundleManifestHash}</code></Field>
            <Field label={t("reviewWorkspace.field.agent")}>{assignment.attempt.agentLabel ?? assignment.attempt.agentId ?? t("reviewWorkspace.agentUnavailable")}</Field>
            <Field label={t("reviewWorkspace.field.assigned")}>{formatReviewTime(assignment.assignedAt, locale)}</Field>
            <Field label={t("reviewWorkspace.field.freshRequests")}>{assignment.freshReplayCount}</Field>
            <Field label={t("reviewWorkspace.field.terminalEvidence")}>{assignment.freshReplayEvidenceCount}</Field>
          </FieldList>
        </Surface>

        <Surface as="section" className="review-workspace-panel" aria-labelledby="review-audit-title">
          <div className="panel-heading"><span>{t("reviewWorkspace.panel.history")}</span><span>{t("reviewWorkspace.events", { count: review.events.length })}</span></div>
          <SectionTitle className="visually-hidden" id="review-audit-title">{t("reviewWorkspace.historyTitle")}</SectionTitle>
          <ol className="review-audit-trail review-workspace-audit">{review.events.map((event) => <li key={event.id}><span>{event.sequence}</span><div><strong>{reviewEventLabel(event.eventType, t)}</strong><small>{formatReviewTime(event.occurredAt, locale)}</small></div><code>{event.payloadHash}</code></li>)}</ol>
        </Surface>
      </div>

      <aside className="review-workspace-sidebar" aria-label={t("reviewWorkspace.sidebarAria")}>
        <ReviewAction
          assignment={assignment}
          hasReviewDelegation={hasReviewDelegation}
          busy={busy}
          onTransition={loadReview}
        />
        <Surface as="section" className="review-boundary-card"><p className="eyebrow">{t("reviewWorkspace.boundary.eyebrow")}</p><strong>{t("reviewWorkspace.boundary.title")}</strong><p>{t("reviewWorkspace.boundary.body")}</p></Surface>
      </aside>
    </div>
  </>;
}

function ReviewProgress({ assignment }: { assignment: ReviewAssignmentSummary }) {
  const { t } = useI18n();
  const accepted = assignment.status === "accepted" || assignment.status === "completed";
  const replayed = assignment.freshReplayEvidenceCount > 0;
  const completed = assignment.status === "completed";
  const steps = [
    { label: t("reviewWorkspace.progress.accept"), detail: accepted ? t("reviewWorkspace.progress.recorded") : assignment.status === "declined" ? t("reviewWorkspace.progress.declined") : t("reviewWorkspace.progress.waiting"), done: accepted },
    { label: t("reviewWorkspace.progress.inspect"), detail: accepted ? t("reviewWorkspace.progress.bundleAvailable") : t("reviewWorkspace.progress.afterAcceptance"), done: accepted },
    { label: t("reviewWorkspace.progress.evidence"), detail: replayed ? t("reviewWorkspace.progress.freshReady") : completed ? t("reviewWorkspace.progress.decisionRecorded") : t("reviewWorkspace.progress.agentCheck"), done: replayed || completed },
    { label: t("reviewWorkspace.progress.sign"), detail: completed ? t("reviewWorkspace.progress.decisionRecorded") : t("reviewWorkspace.progress.ownerConfirmation"), done: completed },
  ];
  return <ol className="review-workflow-steps" aria-label={t("reviewWorkspace.progress.aria")}>{steps.map((step, index) => <li className={step.done ? "is-done" : index === steps.findIndex((candidate) => !candidate.done) ? "is-current" : ""} key={step.label}><span>{step.done ? "✓" : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol>;
}

function ReviewAction({ assignment, hasReviewDelegation, busy, onTransition }: {
  assignment: ReviewAssignmentSummary;
  hasReviewDelegation: boolean;
  busy: "accept" | "decline" | "refresh" | null;
  onTransition: (action?: "accept" | "decline") => Promise<void>;
}) {
  const { t, locale } = useI18n();
  if (assignment.status === "assigned") return <section className="review-next-action is-assigned"><p className="eyebrow">{t("reviewWorkspace.action.assignedEyebrow")}</p><SectionTitle>{t("reviewWorkspace.action.assignedTitle")}</SectionTitle><p>{t("reviewWorkspace.action.assignedBody")}</p><div className="review-next-buttons"><Button className="button button-primary" type="button" disabled={busy !== null} onClick={() => void onTransition("accept")}>{busy === "accept" ? t("reviewWorkspace.action.accepting") : t("reviewWorkspace.action.accept")}</Button><Button className="quiet-action" type="button" disabled={busy !== null} onClick={() => void onTransition("decline")}>{busy === "decline" ? t("reviewWorkspace.action.declining") : t("reviewWorkspace.action.decline")}</Button></div></section>;

  if (assignment.status === "declined") return <section className="review-next-action is-terminal"><p className="eyebrow">{t("reviewWorkspace.action.declinedEyebrow")}</p><SectionTitle>{t("reviewWorkspace.action.declinedTitle")}</SectionTitle><p>{t("reviewWorkspace.action.declinedBody")}</p><ActionLink className="button button-secondary" href="/reviews">{t("reviewWorkspace.action.returnQueue")}</ActionLink></section>;

  if (assignment.status === "completed") return <section className="review-next-action is-complete"><p className="eyebrow">{assignment.receipt ? t("reviewWorkspace.action.completedEyebrowReceipt") : t("reviewWorkspace.action.completedEyebrowDecision")}</p><SectionTitle>{assignment.receipt ? t("reviewWorkspace.action.completedTitleReceipt") : assignment.attestation ? reviewDecisionLabel(assignment.attestation.decision, t) : t("reviewWorkspace.action.completedTitle")}</SectionTitle><p>{assignment.receipt ? t("reviewWorkspace.action.completedBodyReceipt") : assignment.attestation ? t("reviewWorkspace.action.completedBodyEvidence", { hash: assignment.attestation.evidenceHash }) : t("reviewWorkspace.action.completedBodyUnavailable")}</p>{assignment.attestation && <FieldList><Field label={t("reviewWorkspace.action.attestation")}><code>{assignment.attestation.id}</code></Field><Field label={t("reviewWorkspace.action.recorded")}>{formatReviewTime(assignment.attestation.attestedAt, locale)}</Field>{assignment.receipt && <div><dt>{t("reviewWorkspace.action.receiptHash")}</dt><dd><code>{assignment.receipt.receiptHash}</code></dd></div>}</FieldList>}{assignment.receipt ? <ActionLink className="button button-primary" href={`/receipt/${encodeURIComponent(assignment.receipt.id)}`}>{t("reviewWorkspace.action.openReceipt")}</ActionLink> : <ActionLink className="button button-secondary" href={`/evidence/${encodeURIComponent(assignment.artifactBundleManifestHash)}`}>{t("reviewWorkspace.action.inspectEvidence")}</ActionLink>}</section>;

  if (!hasReviewDelegation) return <section className="review-next-action"><p className="eyebrow">{t("reviewWorkspace.action.authorityEyebrow")}</p><SectionTitle>{t("reviewWorkspace.action.authorityTitle")}</SectionTitle><p>{t("reviewWorkspace.action.authorityBody")}</p><ActionLink className="button button-primary" href="/integrations#review-agent">{t("reviewWorkspace.action.connectAgent")} <span aria-hidden="true">→</span></ActionLink></section>;

  return <section className="review-next-action"><p className="eyebrow">{t("reviewWorkspace.action.activeEyebrow")}</p><SectionTitle>{assignment.freshReplayEvidenceCount > 0 ? t("reviewWorkspace.action.activeTitleReady") : assignment.freshReplayCount > 0 ? t("reviewWorkspace.action.activeTitleRunning") : t("reviewWorkspace.action.activeTitleStart")}</SectionTitle><p>{assignment.freshReplayEvidenceCount > 0 ? t("reviewWorkspace.action.activeBodyReady") : assignment.freshReplayCount > 0 ? t("reviewWorkspace.action.activeBodyRunning") : t("reviewWorkspace.action.activeBodyStart")}</p><ReviewAgentPrompt assignment={assignment} /><Link className="text-link" href="/integrations#review-agent">{t("reviewWorkspace.action.agentConnection")} <span>→</span></Link></section>;
}

function ReviewAgentPrompt({ assignment }: { assignment: ReviewAssignmentSummary }) {
  const { t } = useI18n();
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
  return <Button className="button button-primary review-agent-prompt" type="button" onClick={() => void copy()}>{copied ? t("reviewWorkspace.action.promptCopied") : assignment.freshReplayEvidenceCount > 0 ? t("reviewWorkspace.action.copyDecision") : assignment.freshReplayCount > 0 ? t("reviewWorkspace.action.copyReplay") : t("reviewWorkspace.action.copyTask")}</Button>;
}

function reviewAgentPrompt(assignment: ReviewAssignmentSummary) {
  const claimTask = {
    bundle_reproducible: "Request one fresh isolated replay if none exists, poll it to a terminal result, and use only that exact replay evidence hash for any positive bundle_reproducible decision.",
    statement_faithful: "Compare the source-pinned informal statement, Lean declaration, normalized patch, hypotheses, and conclusion. Identify scope drift or hidden assumptions. A fresh replay is supporting infrastructure evidence, not sufficient statement-fidelity evidence.",
    novelty_reviewed: "Build a cited, date-stamped search record across the stated upstream sources and relevant current literature. Separate formal novelty from mathematical novelty. A Lean replay is not novelty evidence.",
  }[assignment.claimType] ?? "Inspect the exact claim and collect immutable evidence that directly supports or refutes it.";
  return `Continue my Proofweave independent review. Use list_review_assignments to locate assignment ${assignment.id}, then use get_review_assignment and verify that its Bundle hash is ${assignment.artifactBundleManifestHash} and its claim is ${assignment.claimType}. Summarize the controlled target, existing replay state, and evidence requirement before taking action. ${claimTask} If the needed evidence is not in Proofweave's immutable artifact index, stop and tell me what evidence still needs to be staged. Once you reach an evidence-based decision, use prepare_verification_attestation and show me the exact assignment, Bundle hash, claim, decision, evidence hash, and payload hash. Do not call submit_prepared_verification_attestation unless I explicitly approve that unchanged signed draft.`;
}

function claimRequirement(claimType: string, t: Translator) {
  if (claimType === "bundle_reproducible") return t("reviewWorkspace.requirement.bundle_reproducible");
  if (claimType === "statement_faithful") return t("reviewWorkspace.requirement.statement_faithful");
  if (claimType === "novelty_reviewed") return t("reviewWorkspace.requirement.novelty_reviewed");
  return t("reviewWorkspace.requirement.default");
}

function claimChecklist(claimType: string, t: Translator) {
  if (claimType === "bundle_reproducible") return [t("reviewWorkspace.checklist.bundle.1"), t("reviewWorkspace.checklist.bundle.2"), t("reviewWorkspace.checklist.bundle.3")];
  if (claimType === "statement_faithful") return [t("reviewWorkspace.checklist.statement.1"), t("reviewWorkspace.checklist.statement.2"), t("reviewWorkspace.checklist.statement.3")];
  if (claimType === "novelty_reviewed") return [t("reviewWorkspace.checklist.novelty.1"), t("reviewWorkspace.checklist.novelty.2"), t("reviewWorkspace.checklist.novelty.3")];
  return [t("reviewWorkspace.checklist.default.1"), t("reviewWorkspace.checklist.default.2"), t("reviewWorkspace.checklist.default.3")];
}

function formatReviewTime(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
