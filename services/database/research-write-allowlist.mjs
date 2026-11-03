/**
 * Person/Agent/Attempt research-write gate.
 *
 * The allowlist is deliberately environment-only: a valid deployment version
 * is the audit record, and clearing the value immediately closes the window.
 * Missing or malformed configuration fails closed, independently for the
 * participant and MCP surfaces.
 */

export const RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION = "pw-research-write-allowlist-v1";

export const researchWriteSurfaces = Object.freeze({
  participant: "participant",
  mcp: "mcp",
});

const surfaceKeys = Object.freeze({
  participant: "PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON",
  mcp: "PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON",
});

const allowedKeys = new Set(["schemaVersion", "persons", "agents", "attempts", "allowNewAttempts", "reviewGrants", "reviewPublishGrants", "reviewDispatchOnly"]);
const dimensions = new Set(["person", "agent", "attempt"]);
const maximumEntries = 100;
const reviewOperations = Object.freeze({
  participant: new Set(["review:claim", "review:transition"]),
  mcp: new Set(["review:replay", "attestation:write"]),
});

// Only owner-side operations whose callers have verified that the stored
// Attempt belongs to the allowed Person + Agent may use the creation window.
// Cross-owner review operations (review:replay, attestation:write) must name
// the target Attempt explicitly because the reviewer is not its owner.
const creationWindowAttemptOperations = new Set([
  "progress:write",
  "attempt:lifecycle",
  "checkpoint:write",
  "artifact:write",
  "run:request",
  "run:cancel",
]);

export class ResearchWriteGateConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResearchWriteGateConfigurationError";
  }
}

/** The gate is missing or invalid; treat the surface as unavailable. */
export class ResearchWriteGateUnconfiguredError extends Error {
  constructor(failureCode) {
    super("The research write window is not configured.");
    this.name = "ResearchWriteGateUnconfiguredError";
    this.code = "research_write_gate_unconfigured";
    this.failureCode = failureCode ?? "unconfigured";
  }
}

/** The identity or resource is not inside the current write window. */
export class ResearchWriteNotAllowedError extends Error {
  constructor(dimension) {
    super("This identity is not in the current research write window.");
    this.name = "ResearchWriteNotAllowedError";
    this.code = "research_write_not_allowed";
    this.dimension = dimension ?? "identity";
  }
}

export function researchWriteAllowlistEnvKey(surface) {
  const key = surfaceKeys[surface];
  if (!key) throw new ResearchWriteGateConfigurationError("surface must be participant or mcp");
  return key;
}

/** Build the env-shaped input for a store that already holds a raw value. */
export function researchWriteAllowlistValues(surface, raw) {
  return { [researchWriteAllowlistEnvKey(surface)]: raw };
}

/**
 * Parse one surface's allowlist without throwing on bad input. The returned
 * object is safe to expose in capability summaries: it contains counts and
 * failure codes, never the configured identifiers.
 */
export function researchWriteAllowlistState(values, surface) {
  const key = researchWriteAllowlistEnvKey(surface);
  const raw = values?.[key];
  const empty = {
    schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
    surface,
    configured: false,
    valid: false,
    persons: Object.freeze([]),
    agents: Object.freeze([]),
    attempts: Object.freeze([]),
    reviewGrants: Object.freeze([]),
    reviewPublishGrants: Object.freeze([]),
    reviewDispatchOnly: false,
    allowNewAttempts: false,
    failureCode: null,
  };
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return Object.freeze({ ...empty, failureCode: "missing" });
  }
  let parsed;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    return Object.freeze({ ...empty, configured: true, failureCode: "invalid_json" });
  }
  const invalid = (failureCode) => Object.freeze({ ...empty, configured: true, failureCode });
  if (!isRecord(parsed)) return invalid("invalid_document");
  if (Object.keys(parsed).some((keyName) => !allowedKeys.has(keyName))) return invalid("unknown_field");
  if (parsed.schemaVersion !== RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION) return invalid("invalid_schema_version");
  if (typeof parsed.allowNewAttempts !== "boolean") return invalid("invalid_allow_new_attempts");
  const persons = validateIdentifierList(parsed.persons);
  if (!persons) return invalid("invalid_persons");
  const agents = validateIdentifierList(parsed.agents);
  if (!agents) return invalid("invalid_agents");
  const attempts = validateIdentifierList(parsed.attempts, { allowEmpty: true });
  if (!attempts) return invalid("invalid_attempts");
  const reviewGrants = validateReviewGrants(parsed.reviewGrants, surface);
  if (!reviewGrants) return invalid("invalid_review_grants");
  const reviewPublishGrants = validateReviewPublishGrants(parsed.reviewPublishGrants, surface);
  if (!reviewPublishGrants) return invalid("invalid_review_publish_grants");
  if (parsed.reviewDispatchOnly !== undefined
      && (surface !== "mcp" || typeof parsed.reviewDispatchOnly !== "boolean")) return invalid("invalid_review_dispatch_only");
  return Object.freeze({
    schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
    surface,
    configured: true,
    valid: true,
    persons: Object.freeze(persons),
    agents: Object.freeze(agents),
    attempts: Object.freeze(attempts),
    reviewGrants: Object.freeze(reviewGrants),
    reviewPublishGrants: Object.freeze(reviewPublishGrants),
    reviewDispatchOnly: parsed.reviewDispatchOnly === true,
    allowNewAttempts: parsed.allowNewAttempts,
    failureCode: null,
  });
}

/**
 * Assert one research mutation against the configured window.
 *
 * `required` controls which dimensions the caller can prove. Callers must pass
 * every server-side identifier they have already resolved; a missing required
 * identifier is treated as unconfigured rather than silently skipped.
 *
 * @param {{
 *   values: Record<string, string | undefined>,
 *   surface: "participant" | "mcp",
 *   operation: string,
 *   required?: Array<"person" | "agent" | "attempt">,
 *   personId?: string | null,
 *   agentId?: string | null,
 *   attemptId?: string | null,
 *   assignmentId?: string | null,
 *   bundleHash?: string | null,
 *   attemptOwnershipVerified?: boolean,
 * }} input
 */
export function assertResearchWriteAllowed({
  values,
  surface,
  operation,
  required = ["person", "agent", "attempt"],
  personId = null,
  agentId = null,
  attemptId = null,
  assignmentId = null,
  bundleHash = null,
  attemptOwnershipVerified = false,
}) {
  if (typeof operation !== "string" || operation.trim() === "") {
    throw new ResearchWriteGateConfigurationError("operation must be a non-empty string");
  }
  const state = researchWriteAllowlistState(values, surface);
  if (!state.valid) throw new ResearchWriteGateUnconfiguredError(state.failureCode);
  // Publication callers must independently prove bundle ownership and accepted
  // Lean evidence; this grant only narrows the deployment's write window.
  if (surface === "participant" && operation === "review:publish"
      && state.reviewPublishGrants.some((grant) => grant.personId === personId && grant.attemptId === attemptId && grant.bundleHash === bundleHash)) {
    if (!required.includes("person") || !required.includes("attempt")) {
      throw new ResearchWriteGateConfigurationError("review publication requires person and attempt");
    }
    return state;
  }
  // An exact review grant adds only its bounded operation. If it does not
  // match, preserve the legacy gate unchanged, including pre-existing owner
  // work for a Person who also has a review grant.
  const matchingGrant = state.reviewGrants.some((grant) =>
    grant.personId === personId && grant.attemptId === attemptId
    && (surface !== "mcp" || (grant.agentId === agentId && grant.assignmentId === assignmentId))
    && grant.operations.includes(operation));
  if (matchingGrant) {
    const grantDimensions = surface === "mcp" ? ["person", "agent", "attempt"] : ["person", "attempt"];
    for (const dimension of grantDimensions) {
      if (!required.includes(dimension)) throw new ResearchWriteGateConfigurationError(`review operation requires ${dimension}`);
    }
    return state;
  }
  const provided = { person: personId, agent: agentId, attempt: attemptId };
  const lists = { person: state.persons, agent: state.agents, attempt: state.attempts };
  for (const dimension of required) {
    if (!dimensions.has(dimension)) {
      throw new ResearchWriteGateConfigurationError(`unknown required dimension: ${dimension}`);
    }
    const value = provided[dimension];
    if (typeof value !== "string" || value.trim() === "") {
      throw new ResearchWriteGateUnconfiguredError(`missing_${dimension}`);
    }
    if (lists[dimension].includes(value)) continue;
    // A creation window covers Attempts owned by the allowed Person + Agent.
    // The caller must assert that it verified ownership against the stored row,
    // and the operation must be an owner-side write. Cross-owner review
    // operations therefore still require the target Attempt to be listed.
    // Once `allowNewAttempts` is false, only explicitly listed Attempts pass.
    if (dimension === "attempt"
        && state.allowNewAttempts
        && attemptOwnershipVerified === true
        && creationWindowAttemptOperations.has(operation)
        && required.includes("person")
        && required.includes("agent")) {
      continue;
    }
    throw new ResearchWriteNotAllowedError(dimension);
  }
  if (operation === "attempt:create" && !state.allowNewAttempts) {
    throw new ResearchWriteNotAllowedError("new_attempts_disabled");
  }
  return state;
}

/**
 * Public, non-identifying summary for capability endpoints and smoke checks.
 */
export function researchWriteGateSummary(values, surface) {
  const state = researchWriteAllowlistState(values, surface);
  return Object.freeze({
    schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
    surface,
    configured: state.configured,
    valid: state.valid,
    failureCode: state.failureCode,
    personCount: state.persons.length,
    agentCount: state.agents.length,
    attemptCount: state.attempts.length,
    allowNewAttempts: state.allowNewAttempts,
    ...(state.reviewDispatchOnly ? { reviewDispatchOnly: true } : {}),
  });
}

function validateIdentifierList(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) return null;
  if (value.length > maximumEntries) return null;
  if (!allowEmpty && value.length === 0) return null;
  const seen = new Set();
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "" || entry.length > 240) return null;
    if (seen.has(entry)) return null;
    seen.add(entry);
  }
  return value;
}

function validateReviewGrants(value, surface) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumEntries) return null;
  const result = [];
  const seen = new Set();
  const keys = surface === "mcp"
    ? new Set(["personId", "agentId", "attemptId", "assignmentId", "operations"])
    : new Set(["personId", "attemptId", "operations"]);
  for (const grant of value) {
    if (!isRecord(grant) || Object.keys(grant).some((key) => !keys.has(key))) return null;
    const identifiers = surface === "mcp"
      ? [grant.personId, grant.agentId, grant.attemptId, grant.assignmentId]
      : [grant.personId, grant.attemptId];
    if (identifiers.some((id) => typeof id !== "string" || !id.trim() || id !== id.trim() || id.length > 240)) return null;
    if (!Array.isArray(grant.operations) || grant.operations.length === 0
      || grant.operations.some((operation) => !reviewOperations[surface].has(operation))
      || new Set(grant.operations).size !== grant.operations.length) return null;
    const identity = JSON.stringify(identifiers);
    if (seen.has(identity)) return null;
    seen.add(identity);
    result.push(Object.freeze({ ...grant, operations: Object.freeze([...grant.operations]) }));
  }
  return result;
}

function validateReviewPublishGrants(value, surface) {
  if (value === undefined) return [];
  if (surface !== "participant" || !Array.isArray(value) || value.length > maximumEntries) return null;
  const result = [];
  const seen = new Set();
  for (const grant of value) {
    if (!isRecord(grant) || Object.keys(grant).some((key) => !["personId", "attemptId", "bundleHash"].includes(key))) return null;
    if ([grant.personId, grant.attemptId].some((id) => typeof id !== "string" || !id.trim() || id !== id.trim() || id.length > 240)) return null;
    if (typeof grant.bundleHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(grant.bundleHash)) return null;
    const identity = JSON.stringify([grant.personId, grant.attemptId, grant.bundleHash]);
    if (seen.has(identity)) return null;
    seen.add(identity);
    result.push(Object.freeze({ personId: grant.personId, attemptId: grant.attemptId, bundleHash: grant.bundleHash }));
  }
  return result;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
