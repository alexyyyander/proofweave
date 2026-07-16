import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getEvidenceRepository } from "@/db/repositories/evidence";
import { getMcpRepository } from "@/db/repositories/mcp";
import {
  getProvisionalContributionRepository,
  ProvisionalContributionSchemaUnavailableError,
} from "@/db/repositories/provisional-contributions";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";
import type { McpAttemptStatus } from "@/packages/domain/mcp";
import { toPersonIdentity, type AuthUser } from "../auth";
import { activeLocalAgentAttempt, activeLocalCodexInstallation } from "./local-agent-journey";

export type PersonalWorkspaceSummary = Readonly<{
  available: boolean;
  agent: Readonly<{ connected: boolean; label: string | null }>;
  currentAttempt: Readonly<{
    id: string;
    problemSlug: string;
    problemTitle: string;
    scope: "formalize" | "prove" | null;
    status: McpAttemptStatus;
    updatedAt: string;
  }> | null;
  counts: Readonly<{
    activeAttempts: number | null;
    activeReviews: number | null;
    evidence: number | null;
    provisionalContributions: number | null;
  }>;
}>;

export async function loadPersonalWorkspaceSummary(user: AuthUser): Promise<PersonalWorkspaceSummary> {
  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    const [attempts, reviews, evidence] = await Promise.all([
      getMcpRepository().listAttempts(profile.person.id),
      getReviewAssignmentRepository().listForPerson(profile.person.id),
      getEvidenceRepository().listForPerson(profile.person.id),
    ]);
    const connection = activeLocalCodexInstallation(profile);
    const currentAttempt = activeLocalAgentAttempt(profile, attempts)
      ?? attempts.find((attempt) => attempt.status === "active")
      ?? attempts[0]
      ?? null;
    let provisionalContributions: number | null = null;
    try {
      provisionalContributions = (await getProvisionalContributionRepository().listForPerson(profile.person.id)).length;
    } catch (error) {
      if (!(error instanceof ProvisionalContributionSchemaUnavailableError)) throw error;
    }

    return {
      available: true,
      agent: { connected: Boolean(connection), label: connection?.agentLabel ?? null },
      currentAttempt: currentAttempt ? {
        id: currentAttempt.id,
        problemSlug: currentAttempt.problemSlug,
        problemTitle: currentAttempt.problemTitle,
        scope: currentAttempt.delegationScope,
        status: currentAttempt.status,
        updatedAt: currentAttempt.updatedAt,
      } : null,
      counts: {
        activeAttempts: attempts.filter((attempt) => attempt.status === "active").length,
        activeReviews: reviews.filter((review) => review.status === "assigned" || review.status === "accepted").length,
        evidence: evidence.length,
        provisionalContributions,
      },
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return unavailableSummary();
    throw error;
  }
}

function unavailableSummary(): PersonalWorkspaceSummary {
  return {
    available: false,
    agent: { connected: false, label: null },
    currentAttempt: null,
    counts: { activeAttempts: null, activeReviews: null, evidence: null, provisionalContributions: null },
  };
}
