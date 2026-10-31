/**
 * Non-mutating research write eligibility for one Person.
 *
 * This projection answers exactly one question: does the current participant
 * research write window allow this Person's own Agent and Attempts to write
 * research records? It is not a verification, review, or receipt status, and
 * it never echoes an allowlist identifier. Only the caller's own Agent and
 * Attempt statuses are returned; identifiers for other Persons never leave
 * their owner's scope.
 *
 * The semantics mirror `assertResearchWriteAllowed`:
 * - a valid window must list the Person and an active Agent owned by the Person;
 * - with `allowNewAttempts: true`, any Attempt owned by that Person + Agent is
 *   covered by the creation window;
 * - with `allowNewAttempts: false`, only explicitly listed Attempts are writable;
 * - without an allowed active Agent, neither creation nor Attempt writes pass.
 */

export const RESEARCH_ELIGIBILITY_SCHEMA_VERSION = "pw-research-eligibility-v1";

/**
 * @param {{
 *   allowlistState?: Record<string, unknown> | null,
 *   personId?: string | null,
 *   agents?: ReadonlyArray<{ id?: string, status?: string }> | null,
 *   attempts?: ReadonlyArray<{ id?: string, agentId?: string | null }> | null,
 *   storageAvailable?: boolean,
 * }} input
 */
export function researchEligibilityState({
  allowlistState = null,
  personId = null,
  agents = [],
  attempts = [],
  storageAvailable = true,
} = {}) {
  const { window, lists } = normalizeAllowlistState(allowlistState);
  const normalizedPersonId = isIdentifier(personId) ? personId : null;
  const normalizedAgents = normalizeAgents(agents);
  const normalizedAttempts = normalizeAttempts(attempts);

  const personAllowed = window.valid
    && normalizedPersonId !== null
    && lists.persons.includes(normalizedPersonId);

  // The caller supplies only Agents owned by this Person. Per-Agent status is
  // returned so the Workbench can refuse to offer creation for a connected
  // Agent that sits outside the window; IDs never leave the owner's scope.
  const agentItems = normalizedAgents.map((agent) => {
    const listed = lists.agents.includes(agent.id);
    return Object.freeze({
      id: agent.id,
      status: agent.status,
      listed,
      allowed: agent.status === "active" && listed,
    });
  });
  const allowedAgentIds = new Set(agentItems.filter((agent) => agent.allowed).map((agent) => agent.id));
  const agentsAllowed = Object.freeze({
    total: agentItems.length,
    active: agentItems.filter((agent) => agent.status === "active").length,
    listed: agentItems.filter((agent) => agent.listed).length,
    allowed: allowedAgentIds.size,
    items: Object.freeze(agentItems),
  });
  const hasAllowedAgent = agentsAllowed.allowed > 0;

  const creationWindowCoversOwnAttempts = window.valid && window.allowNewAttempts;
  const attemptItems = normalizedAttempts.map((attempt) => {
    // The gate checks the Attempt's own Agent. When the caller supplies it, an
    // Attempt bound to a different, non-allowed Agent is not writable even if
    // another Agent of the same Person is inside the window.
    const attemptAgentAllowed = attempt.agentId === undefined
      ? hasAllowedAgent
      : attempt.agentId !== null && allowedAgentIds.has(attempt.agentId);
    const covered = window.valid
      && personAllowed
      && attemptAgentAllowed
      && (lists.attempts.includes(attempt.id) || creationWindowCoversOwnAttempts);
    return Object.freeze({ id: attempt.id, covered });
  });
  const attemptsAllowed = Object.freeze({
    total: attemptItems.length,
    covered: attemptItems.filter((attempt) => attempt.covered).length,
    items: Object.freeze(attemptItems),
  });

  const canCreateAttempt = storageAvailable
    && window.valid
    && personAllowed
    && hasAllowedAgent
    && window.allowNewAttempts;
  const canWrite = storageAvailable
    && window.valid
    && personAllowed
    && hasAllowedAgent
    && (window.allowNewAttempts || attemptsAllowed.covered > 0);

  const reasons = [];
  if (!window.configured) reasons.push("window_missing");
  else if (!window.valid) reasons.push("window_invalid");

  if (!storageAvailable) {
    reasons.push("storage_unavailable");
  } else if (window.valid) {
    if (!normalizedPersonId) reasons.push("person_missing");
    else if (!personAllowed) reasons.push("person_not_allowed");
    if (personAllowed) {
      if (!window.allowNewAttempts) reasons.push("new_attempts_disabled");
      if (!hasAllowedAgent) reasons.push("no_allowed_agent");
      let attemptNotListed = false;
      let attemptAgentNotAllowed = false;
      normalizedAttempts.forEach((attempt, index) => {
        if (attemptItems[index].covered) return;
        const agentKnown = attempt.agentId !== undefined;
        if (agentKnown && (attempt.agentId === null || !allowedAgentIds.has(attempt.agentId))) {
          attemptAgentNotAllowed = true;
        } else if (!window.allowNewAttempts && !lists.attempts.includes(attempt.id)) {
          attemptNotListed = true;
        }
      });
      if (attemptNotListed) reasons.push("attempt_not_listed");
      if (attemptAgentNotAllowed) reasons.push("attempt_agent_not_allowed");
      if (!window.allowNewAttempts && normalizedAttempts.length === 0) {
        reasons.push("no_writable_attempt");
      }
    }
  }

  return Object.freeze({
    schemaVersion: RESEARCH_ELIGIBILITY_SCHEMA_VERSION,
    surface: "participant",
    window,
    personAllowed,
    agentsAllowed,
    attemptsAllowed,
    canCreateAttempt,
    canWrite,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

function normalizeAllowlistState(state) {
  const configured = state?.configured === true;
  const persons = normalizeIdentifierList(state?.persons, { allowEmpty: false });
  const agents = normalizeIdentifierList(state?.agents, { allowEmpty: false });
  const attempts = normalizeIdentifierList(state?.attempts, { allowEmpty: true });
  const valid = state?.configured === true
    && state?.valid === true
    && state?.surface === "participant"
    && persons !== null
    && agents !== null
    && attempts !== null
    && typeof state?.allowNewAttempts === "boolean";
  const failureCode = valid
    ? null
    : typeof state?.failureCode === "string" && state.failureCode.length > 0
      ? state.failureCode
      : configured
        ? "invalid_document"
        : "missing";
  return Object.freeze({
    lists: valid
      ? { persons, agents, attempts }
      : { persons: Object.freeze([]), agents: Object.freeze([]), attempts: Object.freeze([]) },
    window: Object.freeze({
      configured,
      valid,
      failureCode,
      allowNewAttempts: valid && state.allowNewAttempts === true,
      personCount: persons?.length ?? 0,
      agentCount: agents?.length ?? 0,
      attemptCount: attempts?.length ?? 0,
    }),
  });
}

function normalizeIdentifierList(value, { allowEmpty }) {
  if (!Array.isArray(value)) return null;
  if (!allowEmpty && value.length === 0) return null;
  const entries = [];
  const seen = new Set();
  for (const entry of value) {
    if (!isIdentifier(entry) || seen.has(entry)) return null;
    seen.add(entry);
    entries.push(entry);
  }
  return Object.freeze(entries);
}

function normalizeAgents(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const agents = [];
  for (const agent of value) {
    if (!agent || typeof agent !== "object" || !isIdentifier(agent.id)) continue;
    agents.push(Object.freeze({
      id: agent.id,
      status: agent.status === "active"
        ? "active"
        : agent.status === "revoked" ? "revoked" : "inactive",
    }));
  }
  return Object.freeze(agents);
}

function normalizeAttempts(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const attempts = [];
  for (const attempt of value) {
    if (!attempt || typeof attempt !== "object" || !isIdentifier(attempt.id)) continue;
    // Distinguish "agent not supplied" from "agent explicitly null" so callers
    // that pass full Attempt records get per-Agent coverage while minimal
    // `{ id }` inputs keep the Person + allowed-Agent approximation.
    const agentKnown = Object.prototype.hasOwnProperty.call(attempt, "agentId");
    attempts.push(Object.freeze({
      id: attempt.id,
      agentId: agentKnown
        ? (isIdentifier(attempt.agentId) ? attempt.agentId : null)
        : undefined,
    }));
  }
  return Object.freeze(attempts);
}

function isIdentifier(value) {
  return typeof value === "string" && value.trim() !== "" && value.length <= 240;
}
