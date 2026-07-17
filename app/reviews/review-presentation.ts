import type {
  ReviewAssignmentEvent,
  ReviewAssignmentSummary,
} from "@/db/repositories/reviews";

export function reviewClaimLabel(value: string) {
  return {
    bundle_reproducible: "Bundle reproduction",
    kernel_accepted: "Kernel acceptance",
    statement_faithful: "Statement fidelity",
    novelty_reviewed: "Novelty review",
    project_accepted: "Project acceptance",
  }[value] ?? value;
}

export function reviewDecisionLabel(value: NonNullable<ReviewAssignmentSummary["attestation"]>["decision"]) {
  return {
    attested: "Attested",
    rejected: "Rejected",
    request_changes: "Changes requested",
    conflict_declared: "Conflict declared",
    integrity_flagged: "Integrity flag",
  }[value];
}

export function reviewEventLabel(value: ReviewAssignmentEvent["eventType"]) {
  return {
    assignment_created: "Assignment created",
    assignment_accepted: "Review accepted",
    assignment_declined: "Review declined",
    attestation_recorded: "Signed attestation recorded",
  }[value];
}

export function reviewStatusDetail(assignment: ReviewAssignmentSummary, canAttest: boolean) {
  if (assignment.status === "assigned") return {
    label: "Awaiting response",
    tone: "assigned",
    title: "Decide whether to take this review.",
    detail: "Acceptance and decline are immutable review events. Neither action creates a mathematical claim.",
  };
  if (assignment.status === "accepted") return {
    label: "Accepted",
    tone: "accepted",
    title: canAttest ? "Continue the evidence check with your review Agent." : "Set up a review-scoped Agent before attesting.",
    detail: canAttest ? "The local Agent can inspect this exact Bundle, request a fresh replay, and prepare an owner-approved signed decision." : "A browser session cannot fabricate an Agent signature or use non-review authority.",
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
    detail: `This claim was rejected at ${completedAt}; it cannot satisfy a receipt gate.`,
  };
  if (decision === "request_changes") return {
    label: "Changes requested",
    tone: "request-changes",
    title: "A signed request for changes is recorded.",
    detail: `The review closed at ${completedAt}. A revised Bundle requires a new immutable assignment.`,
  };
  if (decision === "conflict_declared") return {
    label: "Conflict declared",
    tone: "rejected",
    title: "A signed conflict declaration is recorded.",
    detail: `The review closed at ${completedAt}; replacement work must be routed to another Person.`,
  };
  if (decision === "integrity_flagged") return {
    label: "Integrity flag",
    tone: "rejected",
    title: "A signed evidence-integrity flag is recorded.",
    detail: `The covered evidence was flagged at ${completedAt} and needs curator follow-up.`,
  };
  return {
    label: "Decision unavailable",
    tone: "declined",
    title: "The completed review has no readable signed decision.",
    detail: "This record cannot satisfy an attestation or Receipt gate until its immutable evidence is available.",
  };
}
