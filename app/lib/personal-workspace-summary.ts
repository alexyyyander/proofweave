import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
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
    return (await loadWorkspaceOverview(profile)).summary;
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return unavailableSummary();
    throw error;
  }
}

export async function loadWorkspaceOverview(profile: DelegationProfile) {
  const personId = profile.person.id;
  const [attempts, reviews, evidence, provisionalContributions] = await Promise.all([
    getMcpRepository().listAttempts(personId),
    getReviewAssignmentRepository().listForPerson(personId),
    getEvidenceRepository().countForPerson(personId),
    getProvisionalContributionRepository().listForPerson(personId).then(rows => rows.length).catch(error => {
      if (error instanceof ProvisionalContributionSchemaUnavailableError) return null;
      throw error;
    }),
  ]);
  const connection = activeLocalCodexInstallation(profile);
  const currentAttempt = activeLocalAgentAttempt(profile, attempts)
    ?? attempts.find(attempt => attempt.status === "active")
    ?? attempts[0];
  const summary = {
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
      activeAttempts: attempts.filter(attempt => attempt.status === "active").length,
      activeReviews: reviews.filter(review => review.status === "assigned" || review.status === "accepted").length,
      evidence,
      provisionalContributions,
    },
  } satisfies PersonalWorkspaceSummary;
  return { attempts, reviews, summary };
}

function unavailableSummary(): PersonalWorkspaceSummary {
  return {
    available: false,
    agent: { connected: false, label: null },
    currentAttempt: null,
    counts: { activeAttempts: null, activeReviews: null, evidence: null, provisionalContributions: null },
  };
}
