import {
  assertResearchWriteAllowed,
  ResearchWriteNotAllowedError,
  researchWriteAllowlistState,
} from "./research-write-allowlist.mjs";

export const researchBetaCapacity = 100;

export function researchBetaEnabled(values) {
  return values.PROOFWEAVE_RESEARCH_BETA_OPEN === "true" &&
    values.PROOFWEAVE_CONTROL_PLANE_MODE === "read_write";
}

export function researchBetaAdmission(database, values, identity, admittedAt) {
  if (!researchBetaEnabled(values)) return null;
  const windows = ["participant", "mcp"].map(surface => researchWriteAllowlistState(values, surface));
  if (windows.some(window => !window.valid || !window.allowNewAttempts || window.reviewDispatchOnly)) return null;
  if (windows.some(window => window.persons.includes(identity.personId))) return null;
  // The write transaction chooses the next seat from the current table state.
  // The UNIQUE and CHECK constraints also protect retries and concurrent sign-ins.
  return database.prepare(
    `INSERT INTO research_beta_enrollments (seat, person_id, admitted_at)
     SELECT COALESCE((SELECT MAX(seat) FROM research_beta_enrollments), 0) + 1, ?, ?
     WHERE COALESCE((SELECT MAX(seat) FROM research_beta_enrollments), 0) < ?
       AND NOT EXISTS (SELECT 1 FROM research_beta_enrollments WHERE person_id = ?)
       AND EXISTS (
         SELECT 1 FROM person_identities
         WHERE id = ? AND person_id = ? AND provider IN ('google', 'chatgpt')
           AND email_verified_at IS NOT NULL
       )`,
  ).bind(identity.personId, admittedAt, researchBetaCapacity, identity.personId, identity.identityId, identity.personId);
}

export async function researchBetaEnrollment(database, personId) {
  const row = await database.prepare(
    `SELECT (SELECT seat FROM research_beta_enrollments WHERE person_id = ?) AS seat,
            EXISTS(SELECT 1 FROM research_beta_enrollments WHERE seat = ?) AS full`,
  ).bind(personId, researchBetaCapacity).first();
  return row?.seat ? "enrolled" : row?.full ? "full" : null;
}

const betaReviewOperations = new Set([
  "review:publish", "review:claim", "review:transition", "review:replay", "attestation:write",
]);

export function assertResearchWriteWithBeta(input) {
  try {
    return assertResearchWriteAllowed(input);
  } catch (error) {
    if (!(error instanceof ResearchWriteNotAllowedError) || !input.betaEnabled) throw error;
    const window = researchWriteAllowlistState(input.values, input.surface);
    if (!window.allowNewAttempts || window.reviewDispatchOnly) throw error;
    return assertBetaEnrollment(input);
  }
}

async function assertBetaEnrollment(input) {
  const { personId, agentId, attemptId, operation } = input;
  const access = await input.database.prepare(
      `SELECT EXISTS(SELECT 1 FROM research_beta_enrollments WHERE person_id = ?) AS enrolled,
              EXISTS(SELECT 1 FROM agents WHERE id = ? AND owner_person_id = ?
                     AND status = 'active' AND revoked_at IS NULL) AS owns_agent,
              EXISTS(SELECT 1 FROM agent_attempts AS attempt
                     JOIN research_beta_enrollments AS beta ON beta.person_id = attempt.person_id
                     WHERE attempt.id = ?) AS beta_attempt`,
  ).bind(personId ?? null, agentId ?? null, personId ?? null, attemptId ?? null).first();
  // Review call sites still prove ownership, market eligibility or reviewer
  // assignment. This only extends their write window to beta-owned Attempts.
  return assertResearchWriteAllowed({
    ...input,
    betaAccess: {
      person: Boolean(access?.enrolled),
      agent: Boolean(access?.enrolled && access.owns_agent),
      attempt: Boolean(access?.beta_attempt && betaReviewOperations.has(operation)),
    },
  });
}
