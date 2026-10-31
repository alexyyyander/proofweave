import assert from "node:assert/strict";
import test from "node:test";
import {
  RESEARCH_ELIGIBILITY_SCHEMA_VERSION,
  researchEligibilityState,
} from "../services/database/research-eligibility.mjs";
import {
  RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
  researchWriteAllowlistState,
} from "../services/database/research-write-allowlist.mjs";

const baseAllowlist = {
  schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
  persons: ["person:a"],
  agents: ["agent:a"],
  attempts: ["attempt:a"],
  allowNewAttempts: false,
};
const ownAgent = [{ id: "agent:a", status: "active" }];

function stateOf(config) {
  const values = config === undefined
    ? {}
    : {
      PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON: typeof config === "string"
        ? config
        : JSON.stringify(config),
    };
  return researchWriteAllowlistState(values, "participant");
}

function evaluate({
  config = baseAllowlist,
  personId = "person:a",
  agents = ownAgent,
  attempts = [],
  storageAvailable = true,
} = {}) {
  return researchEligibilityState({
    allowlistState: config === null ? null : stateOf(config),
    personId,
    agents,
    attempts,
    storageAvailable,
  });
}

test("missing configuration fails closed without throwing", () => {
  const eligibility = researchEligibilityState({
    allowlistState: stateOf(undefined),
    personId: "person:a",
    agents: ownAgent,
    attempts: [],
  });
  assert.equal(eligibility.schemaVersion, RESEARCH_ELIGIBILITY_SCHEMA_VERSION);
  assert.equal(eligibility.window.configured, false);
  assert.equal(eligibility.window.valid, false);
  assert.equal(eligibility.window.failureCode, "missing");
  assert.equal(eligibility.window.allowNewAttempts, false);
  assert.equal(eligibility.personAllowed, false);
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["window_missing"]);
});

test("invalid configuration fails closed with a stable reason", () => {
  const invalidJson = evaluate({ config: "not json" });
  assert.equal(invalidJson.window.configured, true);
  assert.equal(invalidJson.window.valid, false);
  assert.equal(invalidJson.window.failureCode, "invalid_json");
  assert.equal(invalidJson.canWrite, false);
  assert.deepEqual(invalidJson.reasons, ["window_invalid"]);

  const wrongSchema = evaluate({ config: { ...baseAllowlist, schemaVersion: "pw-research-write-allowlist-v0" } });
  assert.equal(wrongSchema.window.valid, false);
  assert.equal(wrongSchema.window.failureCode, "invalid_schema_version");
  assert.equal(wrongSchema.canWrite, false);
});

test("a malformed or absent allowlist state never throws", () => {
  for (const config of [null, {}, { configured: true, valid: true }, { valid: true, persons: "person:a" }]) {
    const eligibility = researchEligibilityState({
      allowlistState: config,
      personId: "person:a",
      agents: ownAgent,
      attempts: [{ id: "attempt:a" }],
    });
    assert.equal(eligibility.schemaVersion, RESEARCH_ELIGIBILITY_SCHEMA_VERSION, String(config));
    assert.equal(eligibility.canWrite, false, String(config));
    assert.equal(eligibility.canCreateAttempt, false, String(config));
  }
  const nonArrayInputs = researchEligibilityState({
    allowlistState: stateOf(baseAllowlist),
    personId: "person:a",
    agents: null,
    attempts: "not-an-array",
  });
  assert.equal(nonArrayInputs.agentsAllowed.total, 0);
  assert.equal(nonArrayInputs.attemptsAllowed.total, 0);
  assert.equal(nonArrayInputs.canWrite, false);
});

test("a Person outside the window is denied even when an Attempt ID is listed", () => {
  const eligibility = evaluate({
    personId: "person:b",
    agents: [{ id: "agent:a", status: "active" }],
    attempts: [{ id: "attempt:a" }],
  });
  assert.equal(eligibility.personAllowed, false);
  assert.equal(eligibility.agentsAllowed.allowed, 1);
  assert.equal(eligibility.attemptsAllowed.total, 1);
  assert.equal(eligibility.attemptsAllowed.covered, 0);
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["person_not_allowed"]);
});

test("an Agent outside the window blocks creation and writing", () => {
  const eligibility = evaluate({
    agents: [{ id: "agent:b", status: "active" }],
    config: { ...baseAllowlist, allowNewAttempts: true },
  });
  assert.equal(eligibility.personAllowed, true);
  assert.equal(eligibility.agentsAllowed.total, 1);
  assert.equal(eligibility.agentsAllowed.active, 1);
  assert.equal(eligibility.agentsAllowed.listed, 0);
  assert.equal(eligibility.agentsAllowed.allowed, 0);
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["no_allowed_agent"]);
});

test("no Agent at all blocks creation and writing", () => {
  const eligibility = evaluate({
    agents: [],
    config: { ...baseAllowlist, allowNewAttempts: true },
  });
  assert.equal(eligibility.personAllowed, true);
  assert.equal(eligibility.agentsAllowed.total, 0);
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["no_allowed_agent"]);
});

test("a listed but revoked Agent is not an allowed Agent", () => {
  const eligibility = evaluate({
    agents: [{ id: "agent:a", status: "revoked" }],
    config: { ...baseAllowlist, allowNewAttempts: true },
  });
  assert.equal(eligibility.agentsAllowed.active, 0);
  assert.equal(eligibility.agentsAllowed.listed, 1);
  assert.equal(eligibility.agentsAllowed.allowed, 0);
  assert.deepEqual(eligibility.agentsAllowed.items, [{ id: "agent:a", status: "revoked", listed: true, allowed: false }]);
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["no_allowed_agent"]);
});

test("an open creation window allows new Attempts and covers every own Attempt", () => {
  const eligibility = evaluate({
    config: { ...baseAllowlist, allowNewAttempts: true },
    attempts: [{ id: "attempt:new-not-listed" }],
  });
  assert.equal(eligibility.personAllowed, true);
  assert.equal(eligibility.agentsAllowed.allowed, 1);
  assert.equal(eligibility.window.allowNewAttempts, true);
  assert.equal(eligibility.attemptsAllowed.covered, 1);
  assert.equal(eligibility.canCreateAttempt, true);
  assert.equal(eligibility.canWrite, true);
  assert.deepEqual(eligibility.reasons, []);
});

test("a creation window with no existing Attempt still allows creating and writing", () => {
  const eligibility = evaluate({
    config: { ...baseAllowlist, allowNewAttempts: true },
    attempts: [],
  });
  assert.equal(eligibility.canCreateAttempt, true);
  assert.equal(eligibility.canWrite, true);
  assert.equal(eligibility.attemptsAllowed.total, 0);
  assert.deepEqual(eligibility.reasons, []);
});

test("a closed window allows only explicitly listed Attempts", () => {
  const writable = evaluate({
    config: { ...baseAllowlist, allowNewAttempts: false },
    attempts: [{ id: "attempt:a" }],
  });
  assert.equal(writable.canCreateAttempt, false);
  assert.equal(writable.canWrite, true);
  assert.equal(writable.attemptsAllowed.covered, 1);
  assert.deepEqual(writable.reasons, ["new_attempts_disabled"]);

  const notWritable = evaluate({
    config: { ...baseAllowlist, allowNewAttempts: false },
    attempts: [{ id: "attempt:b" }],
  });
  assert.equal(notWritable.canCreateAttempt, false);
  assert.equal(notWritable.canWrite, false);
  assert.equal(notWritable.attemptsAllowed.covered, 0);
  assert.deepEqual(notWritable.reasons, ["new_attempts_disabled", "attempt_not_listed"]);
});

test("a closed window with no existing Attempt cannot write", () => {
  const eligibility = evaluate({
    config: { ...baseAllowlist, allowNewAttempts: false },
    attempts: [],
  });
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["new_attempts_disabled", "no_writable_attempt"]);
});

test("partial Attempt coverage keeps writing open but explains the uncovered Attempt", () => {
  const eligibility = evaluate({
    config: { ...baseAllowlist, attempts: ["attempt:a"], allowNewAttempts: false },
    attempts: [{ id: "attempt:a" }, { id: "attempt:b" }],
  });
  assert.equal(eligibility.attemptsAllowed.total, 2);
  assert.equal(eligibility.attemptsAllowed.covered, 1);
  assert.equal(eligibility.canWrite, true);
  assert.deepEqual(eligibility.reasons, ["new_attempts_disabled", "attempt_not_listed"]);
});

test("an unavailable store closes writing without pretending the window is invalid", () => {
  const eligibility = evaluate({
    config: { ...baseAllowlist, allowNewAttempts: true },
    storageAvailable: false,
  });
  assert.equal(eligibility.window.valid, true);
  assert.equal(eligibility.personAllowed, true);
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["storage_unavailable"]);
});

test("a missing Person identity closes person-scoped eligibility", () => {
  const eligibility = evaluate({
    personId: null,
    config: { ...baseAllowlist, allowNewAttempts: true },
  });
  assert.equal(eligibility.personAllowed, false);
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["person_missing"]);
});

test("an MCP allowlist state is not accepted as participant eligibility", () => {
  const mcpState = researchWriteAllowlistState({
    PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON: JSON.stringify({
      ...baseAllowlist,
      allowNewAttempts: true,
    }),
  }, "mcp");
  const eligibility = researchEligibilityState({
    allowlistState: mcpState,
    personId: "person:a",
    agents: ownAgent,
    attempts: [],
  });
  assert.equal(eligibility.window.valid, false);
  assert.equal(eligibility.window.failureCode, "invalid_document");
  assert.equal(eligibility.canCreateAttempt, false);
  assert.equal(eligibility.canWrite, false);
  assert.deepEqual(eligibility.reasons, ["window_invalid"]);
});

test("per-Agent status lets the Workbench refuse a non-allowed connected Agent", () => {
  const eligibility = evaluate({
    config: { ...baseAllowlist, allowNewAttempts: true },
    agents: [
      { id: "agent:a", status: "active" },
      { id: "agent:b", status: "active" },
    ],
  });
  assert.equal(eligibility.canCreateAttempt, true);
  assert.equal(eligibility.agentsAllowed.allowed, 1);
  assert.deepEqual(
    eligibility.agentsAllowed.items.map((agent) => ({ id: agent.id, allowed: agent.allowed })),
    [
      { id: "agent:a", allowed: true },
      { id: "agent:b", allowed: false },
    ],
  );
});

test("an Attempt bound to a non-allowed Agent is not covered", () => {
  const creationWindow = evaluate({
    config: { ...baseAllowlist, allowNewAttempts: true },
    agents: [
      { id: "agent:a", status: "active" },
      { id: "agent:b", status: "active" },
    ],
    attempts: [{ id: "attempt:other-agent", agentId: "agent:b" }],
  });
  assert.equal(creationWindow.attemptsAllowed.covered, 0);
  assert.deepEqual(creationWindow.attemptsAllowed.items, [{ id: "attempt:other-agent", covered: false }]);
  assert.equal(creationWindow.canWrite, true);
  assert.deepEqual(creationWindow.reasons, ["attempt_agent_not_allowed"]);

  const closedWindow = evaluate({
    config: { ...baseAllowlist, attempts: ["attempt:other-agent"], allowNewAttempts: false },
    agents: [
      { id: "agent:a", status: "active" },
      { id: "agent:b", status: "active" },
    ],
    attempts: [{ id: "attempt:other-agent", agentId: "agent:b" }],
  });
  assert.equal(closedWindow.attemptsAllowed.covered, 0);
  assert.equal(closedWindow.canWrite, false);
  assert.deepEqual(closedWindow.reasons, ["new_attempts_disabled", "attempt_agent_not_allowed"]);
});

test("allowlist identifiers for other Persons never appear in eligibility", () => {
  const config = {
    schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
    persons: ["person:secret-a"],
    agents: ["urn:pw:agent:secret-a", "urn:pw:agent:other"],
    attempts: ["attempt:secret-a", "attempt:other"],
    allowNewAttempts: true,
  };
  const eligibility = evaluate({
    config,
    personId: "person:secret-a",
    agents: [
      { id: "urn:pw:agent:secret-a", status: "active" },
      { id: "urn:pw:agent:secret-other", status: "active" },
    ],
    attempts: [{ id: "attempt:secret-a" }],
  });
  assert.equal(eligibility.window.personCount, 1);
  assert.equal(eligibility.window.agentCount, 2);
  assert.equal(eligibility.window.attemptCount, 2);
  assert.equal(eligibility.agentsAllowed.total, 2);
  assert.equal(eligibility.agentsAllowed.allowed, 1);
  assert.equal(eligibility.attemptsAllowed.total, 1);
  assert.equal(eligibility.attemptsAllowed.covered, 1);
  const serialized = JSON.stringify(eligibility);
  // Other Persons, Agents, and Attempts never appear, even when the allowlist
  // contains their identifiers.
  for (const identifier of ["person:secret-a", "urn:pw:agent:other", "attempt:other"]) {
    assert.equal(serialized.includes(identifier), false, identifier);
  }
  // The owner's own Agent and Attempt IDs are owner-scoped and may appear.
  assert.equal(serialized.includes("urn:pw:agent:secret-a"), true);
  assert.equal(serialized.includes("attempt:secret-a"), true);
});

test("all required dimensions together produce an open, writable state", () => {
  const eligibility = evaluate({
    config: {
      schemaVersion: RESEARCH_WRITE_ALLOWLIST_SCHEMA_VERSION,
      persons: ["person:a"],
      agents: ["agent:a"],
      attempts: ["attempt:a"],
      allowNewAttempts: true,
    },
    personId: "person:a",
    agents: ownAgent,
    attempts: [{ id: "attempt:a" }],
  });
  assert.equal(eligibility.window.valid, true);
  assert.equal(eligibility.personAllowed, true);
  assert.equal(eligibility.agentsAllowed.allowed, 1);
  assert.equal(eligibility.attemptsAllowed.covered, 1);
  assert.equal(eligibility.canCreateAttempt, true);
  assert.equal(eligibility.canWrite, true);
  assert.deepEqual(eligibility.reasons, []);
});
