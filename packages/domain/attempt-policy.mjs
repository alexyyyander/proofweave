/**
 * Closed-alpha capacity is attributed to the Person, never multiplied by the
 * number of delegated Agents that Person operates. It is an abuse-control
 * limit, not a contribution score or a mathematical quality signal.
 */
export const closedAlphaAttemptLimits = Object.freeze({
  maximumActiveAttemptsPerPerson: 12,
});

// Review capacity uses the same Person-level attribution boundary. An
// `assigned` or `accepted` review occupies reviewer attention; a declined or
// completed assignment does not. This is an operational safety guard, never a
// contribution or reviewer-quality score.
export const closedAlphaReviewLimits = Object.freeze({
  maximumActiveAssignmentsPerPerson: 8,
});
