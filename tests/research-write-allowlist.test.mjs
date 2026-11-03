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

test("review grants authorize only the specific person, target, operation, and review Agent", () => {
  const participant = { ...allowlist, allowNewAttempts: true, reviewGrants: [
    { personId: "person:reviewer", attemptId: "attempt:target", operations: ["review:claim", "review:transition"] },
  ] };
  const participantCall = { values: values(participant), surface: "participant", required: ["person", "attempt"], personId: "person:reviewer", attemptId: "attempt:target" };
  for (const operation of ["review:claim", "review:transition"]) {
    assert.doesNotThrow(() => assertResearchWriteAllowed({ ...participantCall, operation }));
  }
  assert.throws(() => assertResearchWriteAllowed({ ...participantCall, operation: "review:claim", attemptId: "attempt:other" }), ResearchWriteNotAllowedError);
  assert.throws(() => assertResearchWriteAllowed({ ...participantCall, operation: "review:claim", personId: "person:other" }), ResearchWriteNotAllowedError);
  for (const operation of ["proposal:write", "source:import", "attempt:create", "run:request"]) {
    assert.throws(() => assertResearchWriteAllowed({ ...participantCall, operation }));
  }
  // The existing owner retains precisely their previous creation window.
  assert.doesNotThrow(() => assertResearchWriteAllowed({ values: values(participant), surface: "participant", operation: "attempt:create", required: ["person", "agent"], personId: "person:a", agentId: "agent:a" }));

  const mcp = { ...allowlist, allowNewAttempts: true, reviewGrants: [
    { personId: "person:reviewer", agentId: "agent:reviewer", attemptId: "attempt:target", assignmentId: "assignment:target", operations: ["review:replay", "attestation:write"] },
  ] };
  const replay = { values: values(mcp, "mcp"), surface: "mcp", operation: "review:replay", personId: "person:reviewer", agentId: "agent:reviewer", attemptId: "attempt:target", assignmentId: "assignment:target" };
  assert.doesNotThrow(() => assertResearchWriteAllowed(replay));
  assert.doesNotThrow(() => assertResearchWriteAllowed({ ...replay, operation: "attestation:write" }));
  for (const change of [{ personId: "person:other" }, { agentId: "agent:other" }, { attemptId: "attempt:other" }, { assignmentId: "assignment:other" }, { assignmentId: null }, { operation: "run:request", attemptOwnershipVerified: true }]) {
    assert.throws(() => assertResearchWriteAllowed({ ...replay, ...change }), ResearchWriteNotAllowedError);
  }
  assert.throws(() => assertResearchWriteAllowed({ ...replay, required: ["person", "attempt"] }), /requires agent/);
  assert.equal(JSON.stringify(researchWriteGateSummary(values(mcp, "mcp"), "mcp")).includes("reviewer"), false);
});

test("malformed review grants fail the entire window closed", () => {
  const grant = { personId: "person:reviewer", agentId: "agent:reviewer", attemptId: "attempt:target", assignmentId: "assignment:target", operations: ["review:replay"] };
  const invalid = [
    null, {}, [{ ...grant, personId: "person:a" }], [{ ...grant, operation: "run:request" }],
    [{ ...grant, operations: ["run:request"] }], [{ ...grant, operations: [] }],
    [{ ...grant, operations: ["review:replay", "review:replay"] }],
    [grant, grant], [{ ...grant, agentId: null }],
  ];
  for (const reviewGrants of invalid) {
    const config = { ...allowlist, reviewGrants };
    assert.equal(researchWriteAllowlistState(values(config, "mcp"), "mcp").failureCode, "invalid_review_grants");
    assert.throws(() => assertResearchWriteAllowed({ values: values(config, "mcp"), surface: "mcp", operation: "progress:write", personId: "person:a", agentId: "agent:a", attemptId: "attempt:a" }), ResearchWriteGateUnconfiguredError);
  }
  assert.equal(researchWriteAllowlistState(values({ ...allowlist, reviewGrants: [grant] }), "participant").failureCode, "invalid_review_grants");
});

test("a publication grant permits only the exact owner and Attempt, independently of the creation window", () => {
  const open = { ...allowlist, attempts: [], allowNewAttempts: true };
  const bundleHash = `sha256:${"a".repeat(64)}`;
  const call = { values: values(open), surface: "participant", operation: "review:publish", required: ["person", "attempt"], personId: "person:a", attemptId: "attempt:historical", bundleHash };
  assert.throws(() => assertResearchWriteAllowed(call), ResearchWriteNotAllowedError);
  const scoped = { ...open, reviewPublishGrants: [{ personId: "person:a", attemptId: "attempt:historical", bundleHash }] };
  const authorized = { ...call, values: values(scoped) };
  assert.doesNotThrow(() => assertResearchWriteAllowed(authorized));
  assert.throws(() => assertResearchWriteAllowed({ ...authorized, personId: "person:b" }), ResearchWriteNotAllowedError);
  assert.throws(() => assertResearchWriteAllowed({ ...authorized, attemptId: "attempt:other" }), ResearchWriteNotAllowedError);
  assert.throws(() => assertResearchWriteAllowed({ ...authorized, bundleHash: `sha256:${"b".repeat(64)}` }), ResearchWriteNotAllowedError);
  assert.throws(() => assertResearchWriteAllowed({ ...authorized, operation: "review:claim" }), ResearchWriteNotAllowedError);
  assert.throws(() => assertResearchWriteAllowed({ ...authorized, required: ["person"] }), /requires person and attempt/);
  const invalid = [null, {}, [{ personId: "person:a" }], [{ personId: "person:a", attemptId: "attempt:x", operations: ["anything"] }]];
  for (const reviewPublishGrants of invalid) {
    assert.equal(researchWriteAllowlistState(values({ ...open, reviewPublishGrants }), "participant").failureCode, "invalid_review_publish_grants");
  }
  assert.equal(researchWriteAllowlistState(values({ ...open, reviewPublishGrants: [] }, "mcp"), "mcp").failureCode, "invalid_review_publish_grants");
});

test("the optional review-only dispatch switch is surface-specific and fails closed on malformed values", () => {
  assert.equal(researchWriteAllowlistState(values({ ...allowlist, reviewDispatchOnly: true }, "mcp"), "mcp").reviewDispatchOnly, true);
  assert.equal(researchWriteGateSummary(values({ ...allowlist, reviewDispatchOnly: true }, "mcp"), "mcp").reviewDispatchOnly, true);
  assert.equal(researchWriteAllowlistState(values({ ...allowlist, reviewDispatchOnly: "true" }, "mcp"), "mcp").failureCode, "invalid_review_dispatch_only");
  assert.equal(researchWriteAllowlistState(values({ ...allowlist, reviewDispatchOnly: true }), "participant").failureCode, "invalid_review_dispatch_only");
});

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
    attemptOwnershipVerified: true,
  }));
  assert.throws(
    () => assertResearchWriteAllowed({
      values: values({ ...allowlist, allowNewAttempts: true, attempts: [] }),
      surface: "participant",
      operation: "progress:write",
      personId: "person:a",
      agentId: "agent:a",
      attemptId: "attempt:new",
    }),
    (error) => error instanceof ResearchWriteNotAllowedError && error.dimension === "attempt",
  );
  assert.throws(
    () => assertResearchWriteAllowed({
      values: values({ ...allowlist, allowNewAttempts: true, attempts: [] }),
      surface: "participant",
      operation: "progress:write",
      personId: "person:b",
      agentId: "agent:a",
      attemptId: "attempt:new",
      attemptOwnershipVerified: true,
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
      attemptOwnershipVerified: true,
    }),
    (error) => error instanceof ResearchWriteNotAllowedError && error.dimension === "attempt",
  );
});

test("cross-owner review operations cannot use the creation-window exception", () => {
  const creationWindow = { ...allowlist, allowNewAttempts: true, attempts: [] };
  for (const operation of ["review:replay", "attestation:write"]) {
    assert.throws(
      () => assertResearchWriteAllowed({
        values: values(creationWindow, "mcp"),
        surface: "mcp",
        operation,
        personId: "person:a",
        agentId: "agent:a",
        attemptId: "attempt:another-owner",
        attemptOwnershipVerified: true,
      }),
      (error) => error instanceof ResearchWriteNotAllowedError && error.dimension === "attempt",
      operation,
    );
    assert.doesNotThrow(() => assertResearchWriteAllowed({
      values: values({ ...creationWindow, attempts: ["attempt:another-owner"] }, "mcp"),
      surface: "mcp",
      operation,
      personId: "person:a",
      agentId: "agent:a",
      attemptId: "attempt:another-owner",
    }), operation);
  }
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
