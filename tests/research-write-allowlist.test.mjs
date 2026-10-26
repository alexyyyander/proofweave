import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
  ResearchWriteGateUnconfiguredError,
  ResearchWriteNotAllowedError,
  assertResearchWriteAllowed,
  researchWriteAllowlistState,
  researchWriteGateSummary,
} from "../services/database/research-write-allowlist.mjs";

const allowlist = {
  schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
  persons: ["person:a"],
  agents: ["agent:a"],
  attempts: ["attempt:a"],
  allowNewAttempts: false,
};

function values(config, surface = "participant") {
  const key = surface === "mcp"
    ? "PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON"
    : "PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON";
  return { [key]: typeof config === "string" ? config : JSON.stringify(config) };
}

test("missing configuration fails closed with a non-identifying state", () => {
  const state = researchWriteAllowlistState({}, "participant");
  assert.equal(state.configured, false);
  assert.equal(state.valid, false);
  assert.equal(state.failureCode, "missing");
  assert.deepEqual(state.persons, []);
  assert.throws(
    () => assertResearchWriteAllowed({ values: {}, surface: "participant", operation: "progress:write", personId: "person:a", agentId: "agent:a", attemptId: "attempt:a" }),
    (error) => error instanceof ResearchWriteGateUnconfiguredError && error.failureCode === "missing",
  );
});

test("malformed documents are rejected without partially applying them", () => {
  const cases = [
    ["not json", "invalid_json"],
    [JSON.stringify({ ...allowlist, schemaVersion: "v0" }), "invalid_schema_version"],
    [JSON.stringify({ ...allowlist, extra: true }), "unknown_field"],
    [JSON.stringify({ ...allowlist, persons: [] }), "invalid_persons"],
    [JSON.stringify({ ...allowlist, agents: [] }), "invalid_agents"],
    [JSON.stringify({ ...allowlist, persons: ["person:a", "person:a"] }), "invalid_persons"],
    [JSON.stringify({ ...allowlist, allowNewAttempts: "yes" }), "invalid_allow_new_attempts"],
    [JSON.stringify({ ...allowlist, attempts: [""] }), "invalid_attempts"],
  ];
  for (const [raw, failureCode] of cases) {
    const state = researchWriteAllowlistState(values(raw), "participant");
    assert.equal(state.configured, true, raw);
    assert.equal(state.valid, false, raw);
    assert.equal(state.failureCode, failureCode, raw);
  }
});

test("a valid allowlist exposes counts but not identifiers in its summary", () => {
  const state = researchWriteAllowlistState(values(allowlist), "participant");
  assert.equal(state.valid, true);
  assert.deepEqual(state.persons, ["person:a"]);
  const summary = researchWriteGateSummary(values(allowlist), "participant");
  assert.deepEqual(summary, {
    schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
    surface: "participant",
    configured: true,
    valid: true,
    failureCode: null,
    personCount: 1,
    agentCount: 1,
    attemptCount: 1,
    allowNewAttempts: false,
  });
  assert.equal(JSON.stringify(summary).includes("person:a"), false);
});

test("an allowed person, agent, and attempt pass every dimension", () => {
  assert.doesNotThrow(() => assertResearchWriteAllowed({
    values: values(allowlist),
    surface: "participant",
    operation: "progress:write",
    personId: "person:a",
    agentId: "agent:a",
    attemptId: "attempt:a",
  }));
});

test("each mismatching dimension is denied", () => {
  for (const [field, value] of [["personId", "person:b"], ["agentId", "agent:b"], ["attemptId", "attempt:b"]]) {
    assert.throws(
      () => assertResearchWriteAllowed({
        values: values(allowlist),
        surface: "participant",
        operation: "progress:write",
        personId: field === "personId" ? value : "person:a",
        agentId: field === "agentId" ? value : "agent:a",
        attemptId: field === "attemptId" ? value : "attempt:a",
      }),
      (error) => error instanceof ResearchWriteNotAllowedError && error.dimension === field.replace("Id", ""),
      field,
    );
  }
});

test("missing required server-side identifiers fail closed as unconfigured", () => {
  assert.throws(
    () => assertResearchWriteAllowed({
      values: values(allowlist),
      surface: "participant",
      operation: "progress:write",
      personId: "person:a",
      agentId: null,
      attemptId: "attempt:a",
    }),
    (error) => error instanceof ResearchWriteGateUnconfiguredError && error.failureCode === "missing_agent",
  );
});

test("new Attempts require an explicit allowNewAttempts window", () => {
  assert.throws(
    () => assertResearchWriteAllowed({
      values: values(allowlist),
      surface: "participant",
      operation: "attempt:create",
      required: ["person", "agent"],
      personId: "person:a",
      agentId: "agent:a",
    }),
    (error) => error instanceof ResearchWriteNotAllowedError && error.dimension === "new_attempts_disabled",
  );
  assert.doesNotThrow(() => assertResearchWriteAllowed({
    values: values({ ...allowlist, allowNewAttempts: true }),
    surface: "participant",
    operation: "attempt:create",
    required: ["person", "agent"],
    personId: "person:a",
    agentId: "agent:a",
  }));
});

test("an allowed person and agent may work on their own new Attempt during a creation window", () => {
  assert.doesNotThrow(() => assertResearchWriteAllowed({
    values: values({ ...allowlist, allowNewAttempts: true, attempts: [] }),
    surface: "participant",
    operation: "progress:write",
    personId: "person:a",
    agentId: "agent:a",
    attemptId: "attempt:new",
  }));
  assert.throws(
    () => assertResearchWriteAllowed({
      values: values({ ...allowlist, allowNewAttempts: true, attempts: [] }),
      surface: "participant",
      operation: "progress:write",
      personId: "person:b",
      agentId: "agent:a",
      attemptId: "attempt:new",
    }),
    ResearchWriteNotAllowedError,
  );
  assert.throws(
    () => assertResearchWriteAllowed({
      values: values({ ...allowlist, allowNewAttempts: false, attempts: [] }),
      surface: "participant",
      operation: "progress:write",
      personId: "person:a",
      agentId: "agent:a",
      attemptId: "attempt:new",
    }),
    (error) => error instanceof ResearchWriteNotAllowedError && error.dimension === "attempt",
  );
});

test("person-scoped operations do not require an Agent or Attempt", () => {
  assert.doesNotThrow(() => assertResearchWriteAllowed({
    values: values(allowlist),
    surface: "participant",
    operation: "proposal:write",
    required: ["person"],
    personId: "person:a",
  }));
  assert.throws(
    () => assertResearchWriteAllowed({
      values: values(allowlist),
      surface: "participant",
      operation: "proposal:write",
      required: ["person"],
      personId: "person:b",
    }),
    ResearchWriteNotAllowedError,
  );
});

test("participant and MCP windows are independent", () => {
  const participantValues = values(allowlist, "participant");
  assert.throws(
    () => assertResearchWriteAllowed({
      values: participantValues,
      surface: "mcp",
      operation: "progress:write",
      personId: "person:a",
      agentId: "agent:a",
      attemptId: "attempt:a",
    }),
    ResearchWriteGateUnconfiguredError,
  );
  assert.doesNotThrow(() => assertResearchWriteAllowed({
    values: values(allowlist, "mcp"),
    surface: "mcp",
    operation: "progress:write",
    personId: "person:a",
    agentId: "agent:a",
    attemptId: "attempt:a",
  }));
});
