import type {
  ReviewAssignmentEvent,
  ReviewAssignmentSummary,
} from "@/db/repositories/reviews";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

const claimKeys: Record<string, TranslationKey> = {
  bundle_reproducible: "review.claim.bundle_reproducible",
  kernel_accepted: "review.claim.kernel_accepted",
  statement_faithful: "review.claim.statement_faithful",
  novelty_reviewed: "review.claim.novelty_reviewed",
  project_accepted: "review.claim.project_accepted",
};

const decisionKeys: Record<NonNullable<ReviewAssignmentSummary["attestation"]>["decision"], TranslationKey> = {
  attested: "review.decision.attested",
  rejected: "review.decision.rejected",
  request_changes: "review.decision.request_changes",
  conflict_declared: "review.decision.conflict_declared",
  integrity_flagged: "review.decision.integrity_flagged",
};

const eventKeys: Record<ReviewAssignmentEvent["eventType"], TranslationKey> = {
  assignment_created: "review.event.assignment_created",
  assignment_accepted: "review.event.assignment_accepted",
  assignment_declined: "review.event.assignment_declined",
  attestation_recorded: "review.event.attestation_recorded",
};

export function reviewClaimLabel(value: string, t: Translator) {
  const key = claimKeys[value];
  return key ? t(key) : value;
}

export function reviewDecisionLabel(value: NonNullable<ReviewAssignmentSummary["attestation"]>["decision"], t: Translator) {
  return t(decisionKeys[value]);
}

export function reviewEventLabel(value: ReviewAssignmentEvent["eventType"], t: Translator) {
  return t(eventKeys[value]);
}

export function reviewStatusDetail(assignment: ReviewAssignmentSummary, canAttest: boolean, t: Translator, locale: Locale) {
  if (assignment.status === "assigned") return {
    label: t("review.status.awaiting.label"),
    tone: "assigned",
    title: t("review.status.awaiting.title"),
    detail: t("review.status.awaiting.detail"),
  };
  if (assignment.status === "accepted") return {
    label: t("review.status.accepted.label"),
    tone: "accepted",
    title: canAttest ? t("review.status.accepted.titleWithDelegation") : t("review.status.accepted.titleWithoutDelegation"),
    detail: canAttest ? t("review.status.accepted.detailWithDelegation") : t("review.status.accepted.detailWithoutDelegation"),
  };
  if (assignment.status === "completed") return completedStatusDetail(assignment, t, locale);
  return {
    label: t("review.status.declined.label"),
    tone: "declined",
    title: t("review.status.declined.title"),
    detail: t("review.status.declined.detail", { time: assignment.declinedAt ? formatTime(assignment.declinedAt, locale) : t("review.status.declined.timeFallback") }),
  };
}

function completedStatusDetail(assignment: ReviewAssignmentSummary, t: Translator, locale: Locale) {
  const decision = assignment.attestation?.decision;
  const completedAt = assignment.attestation?.attestedAt
    ? formatTime(assignment.attestation.attestedAt, locale)
    : assignment.completedAt
      ? formatTime(assignment.completedAt, locale)
      : t("review.status.attestedTimeFallback");
  if (decision === "attested") return {
    label: t("review.status.attested.label"),
    tone: "completed",
    title: t("review.status.attested.title"),
    detail: t("review.status.attested.detail", { time: completedAt }),
  };
  if (decision === "rejected") return {
    label: t("review.status.rejected.label"),
    tone: "rejected",
    title: t("review.status.rejected.title"),
    detail: t("review.status.rejected.detail", { time: completedAt }),
  };
  if (decision === "request_changes") return {
    label: t("review.status.changes.label"),
    tone: "request-changes",
    title: t("review.status.changes.title"),
    detail: t("review.status.changes.detail", { time: completedAt }),
  };
  if (decision === "conflict_declared") return {
    label: t("review.status.conflict.label"),
    tone: "rejected",
    title: t("review.status.conflict.title"),
    detail: t("review.status.conflict.detail", { time: completedAt }),
  };
  if (decision === "integrity_flagged") return {
    label: t("review.status.integrity.label"),
    tone: "rejected",
    title: t("review.status.integrity.title"),
    detail: t("review.status.integrity.detail", { time: completedAt }),
  };
  return {
    label: t("review.status.unavailable.label"),
    tone: "declined",
    title: t("review.status.unavailable.title"),
    detail: t("review.status.unavailable.detail"),
  };
}

function formatTime(value: string, locale: Locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date);
}
