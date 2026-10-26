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

const allowedKeys = new Set(["schemaVersion", "persons", "agents", "attempts", "allowNewAttempts"]);
const dimensions = new Set(["person", "agent", "attempt"]);
const maximumEntries = 100;

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
  return Object.freeze({
    schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
    surface,
    configured: true,
    valid: true,
    persons: Object.freeze(persons),
    agents: Object.freeze(agents),
    attempts: Object.freeze(attempts),
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
}) {
  if (typeof operation !== "string" || operation.trim() === "") {
    throw new ResearchWriteGateConfigurationError("operation must be a non-empty string");
  }
  const state = researchWriteAllowlistState(values, surface);
  if (!state.valid) throw new ResearchWriteGateUnconfiguredError(state.failureCode);
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
    // Callers verify that ownership against the stored row before gating, so a
    // newly created Attempt can be resumed without redeploying the allowlist.
    // Once `allowNewAttempts` is false, only explicitly listed Attempts pass.
    if (dimension === "attempt" && state.allowNewAttempts
        && required.includes("person") && required.includes("agent")) {
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

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
