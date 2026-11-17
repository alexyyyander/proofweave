import { getD1, getResearchWriteAllowlistValues, MissingDatabaseBindingError } from "@/db";
import { getMcpRepository } from "@/db/repositories/mcp";
import { researchWriteAllowlistState } from "@/services/database/research-write-allowlist.mjs";
import { researchBetaEnabled, researchBetaEnrollment } from "@/services/database/research-beta.mjs";
import { researchEligibilityState } from "@/services/database/research-eligibility.mjs";

/**
 * Server-only projection of the participant research write window for one
 * Person. It reads the gate configuration and the Person's own Agents and
 * Attempts; it never mutates records and never resolves an identity through
 * `currentDelegationIdentity` (which rejects while research is frozen).
 */
export type ResearchEligibility = Readonly<{
  schemaVersion: "pw-research-eligibility-v1";
  surface: "participant";
  window: Readonly<{
    configured: boolean;
    valid: boolean;
    failureCode: string | null;
    allowNewAttempts: boolean;
    personCount: number;
    agentCount: number;
    attemptCount: number;
  }>;
  personAllowed: boolean;
  betaEnrollment?: "enrolled" | "full" | null;
  agentsAllowed: Readonly<{
    total: number;
    active: number;
    listed: number;
    allowed: number;
    items: ReadonlyArray<Readonly<{
      id: string;
      status: string;
      listed: boolean;
      allowed: boolean;
    }>>;
  }>;
  attemptsAllowed: Readonly<{
    total: number;
    covered: number;
    items: ReadonlyArray<Readonly<{
      id: string;
      covered: boolean;
    }>>;
  }>;
  canCreateAttempt: boolean;
  canWrite: boolean;
  reasons: readonly string[];
}>;

/**
 * The eligibility response describes only the current write window. It is not
 * a verification, review, or receipt status and must not be presented as one.
 */
export const researchEligibilityPolicy = Object.freeze({
  schemaVersion: "pw-research-eligibility-policy-v1",
  surface: "participant",
  statement:
    "Research write eligibility reports only whether the configured participant write window covers your Person, an active Agent you own, and the listed or creation-window Attempts. It does not evaluate the control-plane operation mode, Runner availability, review, receipt, or mathematical correctness, and it does not imply that any submitted work has been accepted or validated.",
  writeWindowOnly: true,
  operationModeEvaluated: false,
  runnerAvailabilityEvaluated: false,
  verificationStatus: false,
  reviewStatus: false,
  receiptStatus: false,
  note:
    "canCreateAttempt requires an active Agent you own. The Workbench checks the connected Agent before offering creation. Beta enrollment can extend an open research write window to your active Agents. The participant control-plane mode and edge boundary must also allow writes.",
});

/**
 * @param personId The authenticated Person ID. A null ID returns a closed
 *   eligibility projection instead of throwing.
 *
 * Agents are read with a direct owner-scoped SELECT rather than
 * `getDelegationRepository().getProfile(identity)`: `getProfile` resolves an
 * identity by upserting it, which is rejected while the control plane is
 * read-only. A plain read keeps this projection usable during a research
 * freeze, and the Person ID is the only authority used.
 */
export async function getResearchEligibilityForPerson(
  personId: string | null,
): Promise<ResearchEligibility> {
  const values = getResearchWriteAllowlistValues();
  const allowlistState = researchWriteAllowlistState(values, "participant");
  if (!personId) {
    return project(allowlistState, null, [], [], true);
  }

  try {
    const [agents, attempts, enrollment] = await Promise.all([
      loadOwnAgents(personId),
      getMcpRepository().listAttempts(personId),
      researchBetaEnabled(values) && allowlistState.valid && allowlistState.allowNewAttempts
        && !allowlistState.persons.some(id => id === personId)
        ? researchBetaEnrollment(getD1(), personId)
        : null,
    ]);
    if (enrollment !== "enrolled") {
      return { ...project(allowlistState, personId, agents, attempts, true), betaEnrollment: enrollment };
    }
    const effectiveAllowlist = {
      ...allowlistState,
      persons: [...allowlistState.persons, personId],
      agents: [...new Set([...allowlistState.agents, ...agents.filter(agent => agent.status === "active").map(agent => agent.id)])],
    };
    return { ...project(effectiveAllowlist, personId, agents, attempts, true), betaEnrollment: enrollment };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) {
      return project(allowlistState, personId, [], [], false);
    }
    throw error;
  }
}

function project(
  allowlistState: Record<string, unknown> | null,
  personId: string | null,
  agents: ReadonlyArray<{ id: string; status: string }>,
  attempts: ReadonlyArray<{ id: string; agentId?: string | null }>,
  storageAvailable: boolean,
): ResearchEligibility {
  return researchEligibilityState({
    allowlistState,
    personId,
    agents,
    attempts,
    storageAvailable,
  }) as ResearchEligibility;
}

async function loadOwnAgents(
  personId: string,
): Promise<ReadonlyArray<{ id: string; status: string }>> {
  const rows = await getD1()
    .prepare("SELECT id, status, revoked_at FROM agents WHERE owner_person_id = ?")
    .bind(personId)
    .all<{ id: string; status: string; revoked_at: string | null }>();
  return (rows.results ?? []).map((row: { id: string; status: string; revoked_at: string | null }) => ({
    id: row.id,
    status: row.revoked_at ? "revoked" : row.status,
  }));
}
