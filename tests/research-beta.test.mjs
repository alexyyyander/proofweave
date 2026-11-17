import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createClient } from "@libsql/client";
import { LibsqlD1Database } from "../services/database/libsql-d1-adapter.mjs";
import {
  assertResearchWriteWithBeta,
  researchBetaAdmission,
  researchBetaEnrollment,
} from "../services/database/research-beta.mjs";
import { reportResearchBetaCapacity } from "../workers/research-beta-monitor.mjs";

const allowlist = JSON.stringify({
  schemaVersion: "pw-research-write-allowlist-v1",
  persons: ["staff"], agents: ["staff-agent"], attempts: ["legacy-attempt"], allowNewAttempts: true,
});
const values = {
  PROOFWEAVE_CONTROL_PLANE_MODE: "read_write",
  PROOFWEAVE_RESEARCH_BETA_OPEN: "true",
  PROOFWEAVE_PARTICIPANT_RESEARCH_WRITE_ALLOWLIST_JSON: allowlist,
  PROOFWEAVE_MCP_RESEARCH_WRITE_ALLOWLIST_JSON: allowlist,
};
const now = "2026-11-17T09:00:00.000Z";
const setup = [
  "CREATE TABLE persons (id TEXT PRIMARY KEY)",
  "CREATE TABLE person_identities (id TEXT PRIMARY KEY, person_id TEXT, provider TEXT, email_verified_at TEXT)",
  "CREATE TABLE agents (id TEXT PRIMARY KEY, owner_person_id TEXT, status TEXT, revoked_at TEXT)",
  "CREATE TABLE agent_attempts (id TEXT PRIMARY KEY, person_id TEXT)",
  "CREATE TABLE app_sessions (person_id TEXT)",
];

test("login claims at most 100 seats and counts each verified Person once", async t => {
  const database = new LibsqlD1Database(createClient({ url: "file::memory:" }));
  t.after(() => database.close());
  for (const sql of setup) await database.prepare(sql).run();
  const schema = await readFile(new URL("../scripts/research-beta-enrollment.sql", import.meta.url), "utf8");
  await database.prepare(schema).run();
  const people = ["staff", "demo", "unverified", ...Array.from({ length: 104 }, (_, index) => `user-${index}`)];
  for (const person of people) {
    await database.batch([
      database.prepare("INSERT INTO persons VALUES (?)").bind(person),
      database.prepare("INSERT INTO person_identities VALUES (?, ?, ?, ?)").bind(
        `identity-${person}`, person, person === "demo" ? "proofweave" : "google", person === "unverified" ? null : now,
      ),
    ]);
  }
  function signIn(personId) {
    const session = database.prepare("INSERT INTO app_sessions VALUES (?)").bind(personId);
    const admission = researchBetaAdmission(database, values, { personId, identityId: `identity-${personId}` }, now);
    return database.batch(admission ? [session, admission] : [session]);
  }
  await Promise.all(["staff", "demo", "unverified", "user-0", "user-0"].map(signIn));
  assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM research_beta_enrollments").first("n"), 1);
  await Promise.all(people.slice(4, 102).map(signIn));
  assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM research_beta_enrollments").first("n"), 99);
  const remaining = ["user-99", "user-100", "user-101", "user-102", "user-103"];
  await Promise.all(remaining.map(signIn));
  assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM research_beta_enrollments").first("n"), 100);
  assert.equal(await researchBetaEnrollment(database, "user-0"), "enrolled");
  assert.equal(await researchBetaEnrollment(database, "staff"), "full");
  assert.equal(await database.prepare("SELECT COUNT(*) AS n FROM app_sessions").first("n"), 108);

  await database.batch([
    database.prepare("INSERT INTO agents VALUES ('own-agent', 'user-0', 'active', NULL)"),
    database.prepare("INSERT INTO agents VALUES ('other-agent', 'user-1', 'active', NULL)"),
    database.prepare("INSERT INTO agents VALUES ('revoked-agent', 'user-0', 'active', ?)").bind(now),
    database.prepare("INSERT INTO agent_attempts VALUES ('beta-attempt', 'user-1')"),
    database.prepare("INSERT INTO agent_attempts VALUES ('private-staff-attempt', 'staff')"),
  ]);
  const input = { database, values, betaEnabled: true, surface: "mcp", personId: "user-0", agentId: "own-agent" };
  await assertResearchWriteWithBeta({ ...input, operation: "attempt:create", required: ["person", "agent"] });
  await assertResearchWriteWithBeta({ ...input, operation: "review:replay", attemptId: "beta-attempt" });
  await assert.rejects(assertResearchWriteWithBeta({ ...input, operation: "review:replay", attemptId: "private-staff-attempt" }), /not in the current/);
  await assert.rejects(assertResearchWriteWithBeta({ ...input, operation: "run:request", attemptId: "beta-attempt" }), /not in the current/);
  for (const agentId of ["other-agent", "revoked-agent"]) {
    await assert.rejects(assertResearchWriteWithBeta({ ...input, agentId, operation: "attempt:create", required: ["person", "agent"] }), /not in the current/);
  }
  assert.throws(() => assertResearchWriteWithBeta({ ...input, betaEnabled: false, operation: "attempt:create", required: ["person", "agent"] }), /not in the current/);
});

test("only a recent 100th seat produces a capacity signal", async t => {
  const warnings = t.mock.method(console, "warn", () => {});
  const env = { TURSO_HTTPS_URL: "https://db.example", TURSO_BETA_READ_TOKEN: "test-token" };
  const call = (rows, at = Date.parse(now) + 1) => reportResearchBetaCapacity(env, async () =>
    Response.json({ results: [{ type: "ok", response: { result: { rows } } }] }), at,
  );
  await call([]);
  await call([[{ type: "text", value: now }]], Date.parse(now) + 50 * 60 * 60 * 1_000);
  assert.equal(warnings.mock.callCount(), 0);
  await call([[{ type: "text", value: now }]]);
  assert.equal(warnings.mock.callCount(), 1);
  assert.deepEqual(warnings.mock.calls[0].arguments, ["proofweave_research_beta_full seats=100"]);
});
