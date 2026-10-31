import { getCatalogRepository } from "@/db/repositories/catalog";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getEvidenceRepository } from "@/db/repositories/evidence";
import { getMcpRepository } from "@/db/repositories/mcp";
import {
  getProvisionalContributionRepository,
  ProvisionalContributionSchemaUnavailableError,
  type ProvisionalContribution,
} from "@/db/repositories/provisional-contributions";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";
import { MissingDatabaseBindingError } from "@/db";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt, McpRunSummary } from "@/packages/domain/mcp";
import { runnerEnvironmentAvailability } from "@/services/lean-runner/runner-availability.mjs";
import { loadRunnerAvailability } from "../lib/runner-availability.server";
import type { WorkbenchCatalogTarget } from "../lib/runner-availability";
import { toPersonIdentity, type AuthUser } from "../auth";

export type WorkbenchData = Readonly<{
  profile: DelegationProfile | null;
  attempts: readonly McpAttempt[];
  runs: readonly McpRunSummary[];
  provisionalContributions: readonly ProvisionalContribution[];
  provisionalLedgerAvailable: boolean;
  reviewCount: number | null;
  evidenceCount: number | null;
  storageAvailable: boolean;
}>;

export async function loadWorkbenchData(user: AuthUser | null): Promise<WorkbenchData> {
  if (!user) return emptyWorkbenchData(true);

  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    const mcp = getMcpRepository();
    const [attempts, runs, reviews, evidence, provisionalLedger] = await Promise.all([
      mcp.listAttempts(profile.person.id),
      mcp.listRunSummaries(profile.person.id),
      getReviewAssignmentRepository().listForPerson(profile.person.id),
      getEvidenceRepository().listForPerson(profile.person.id),
      loadProvisionalLedger(profile.person.id),
    ]);
    const reviewCount = reviews.filter((review) => review.status === "assigned" || review.status === "accepted").length;
    return {
      profile,
      attempts,
      runs,
      provisionalContributions: provisionalLedger.contributions,
      provisionalLedgerAvailable: provisionalLedger.available,
      reviewCount,
      evidenceCount: evidence.length,
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return emptyWorkbenchData(false);
    throw error;
  }
}

async function loadProvisionalLedger(personId: string): Promise<Readonly<{
  contributions: readonly ProvisionalContribution[];
  available: boolean;
}>> {
  try {
    return {
      contributions: await getProvisionalContributionRepository().listForPerson(personId),
      available: true,
    };
  } catch (error) {
    if (error instanceof ProvisionalContributionSchemaUnavailableError) {
      return { contributions: [], available: false };
    }
    throw error;
  }
}
export async function loadSelectedCatalogTarget(slug: string): Promise<WorkbenchCatalogTarget | null> {
  try {
    const target = await getCatalogRepository().findBySlug(slug);
    return target ? withRunnerAvailability(target) : null;
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return null;
    throw error;
  }
}

export async function loadCatalogTargets(): Promise<readonly WorkbenchCatalogTarget[]> {
  try {
    const targets = await getCatalogRepository().list("frontier");
    const availability = loadRunnerAvailability();
    return Object.freeze(targets.map((target) => Object.freeze({
      ...target,
      runnerAvailability: runnerEnvironmentAvailability(availability, target.source),
    })));
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return [];
    throw error;
  }
}

function withRunnerAvailability(target: CatalogProblem): WorkbenchCatalogTarget {
  return Object.freeze({
    ...target,
    runnerAvailability: runnerEnvironmentAvailability(loadRunnerAvailability(), target.source),
  });
}

export function requestedTargetSlug(searchParams: { target?: string | string[] }): string | null {
  const target = typeof searchParams.target === "string" ? searchParams.target.trim() : "";
  return target.length > 0 && target.length <= 120 ? target : null;
}

export function requestedParentNodeId(searchParams: { parent?: string | string[] }): string | null {
  const parent = typeof searchParams.parent === "string" ? searchParams.parent.trim() : "";
  return parent.length > 0 && parent.length <= 240 ? parent : null;
}

export function requestedAttemptId(searchParams: { attempt?: string | string[] }): string | null {
  const attempt = typeof searchParams.attempt === "string" ? searchParams.attempt.trim() : "";
  return attempt.length > 0 && attempt.length <= 240 ? attempt : null;
}

function emptyWorkbenchData(storageAvailable: boolean): WorkbenchData {
  return {
    profile: null,
    attempts: [],
    runs: [],
    provisionalContributions: [],
    provisionalLedgerAvailable: false,
    reviewCount: null,
    evidenceCount: null,
    storageAvailable,
  };
}
