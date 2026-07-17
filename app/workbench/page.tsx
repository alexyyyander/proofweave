import { Footer } from "../ui";
import { Header } from "../header";
import { getCurrentUser, signInPath, toPersonIdentity, type AuthUser } from "../auth";
import { WorkbenchClient } from "./WorkbenchClient";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getMcpRepository } from "@/db/repositories/mcp";
import { getCatalogRepository } from "@/db/repositories/catalog";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt, McpRunSummary } from "@/packages/domain/mcp";
import { MissingDatabaseBindingError } from "@/db";
import { getEvidenceRepository } from "@/db/repositories/evidence";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";
import {
  getProvisionalContributionRepository,
  ProvisionalContributionSchemaUnavailableError,
  type ProvisionalContribution,
} from "@/db/repositories/provisional-contributions";

export const dynamic = "force-dynamic";

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<{ attempt?: string | string[]; target?: string | string[]; parent?: string | string[] }>;
}) {
  const user = await getCurrentUser();
  const resolvedSearchParams = await searchParams;
  const targetSlug = requestedTargetSlug(resolvedSearchParams);
  const parentNodeId = requestedParentNodeId(resolvedSearchParams);
  const attemptId = requestedAttemptId(resolvedSearchParams);
  const { profile, attempts, runs, provisionalContributions, provisionalLedgerAvailable, reviewCount, evidenceCount, storageAvailable } = await loadWorkbench(user);
  const catalogTargets = await loadCatalogTargets();
  const returnTo = targetSlug
    ? `/workbench?target=${encodeURIComponent(targetSlug)}${parentNodeId ? `&parent=${encodeURIComponent(parentNodeId)}` : ""}#research-launcher`
    : attemptId
      ? `/workbench?attempt=${encodeURIComponent(attemptId)}`
      : "/workbench";

  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main id="main-content" tabIndex={-1} className="workbench-main">
        <WorkbenchClient profile={profile} initialAttempts={attempts} initialRuns={runs} initialProvisionalContributions={provisionalContributions} provisionalLedgerAvailable={provisionalLedgerAvailable} initialReviewCount={reviewCount} initialEvidenceCount={evidenceCount} catalogTargets={catalogTargets} initialAttemptId={attemptId} initialTargetSlug={targetSlug} initialParentNodeId={parentNodeId} isAuthenticated={Boolean(user)} signInPath={signInPath(returnTo)} storageAvailable={storageAvailable} />
      </main>
      <Footer />
    </div>
  );
}

async function loadWorkbench(user: AuthUser | null): Promise<{
  profile: DelegationProfile | null;
  attempts: readonly McpAttempt[];
  runs: readonly McpRunSummary[];
  provisionalContributions: readonly ProvisionalContribution[];
  provisionalLedgerAvailable: boolean;
  reviewCount: number | null;
  evidenceCount: number | null;
  storageAvailable: boolean;
}> {
  if (!user) return { profile: null, attempts: [], runs: [], provisionalContributions: [], provisionalLedgerAvailable: true, reviewCount: null, evidenceCount: null, storageAvailable: true };

  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    const mcp = getMcpRepository();
    const [attempts, runs, reviews, evidence] = await Promise.all([
      mcp.listAttempts(profile.person.id),
      mcp.listRunSummaries(profile.person.id),
      getReviewAssignmentRepository().listForPerson(profile.person.id),
      getEvidenceRepository().listForPerson(profile.person.id),
    ]);
    try {
      return {
        profile,
        attempts,
        runs,
        provisionalContributions: await getProvisionalContributionRepository().listForPerson(profile.person.id),
        provisionalLedgerAvailable: true,
        reviewCount: reviews.filter((review) => review.status === "assigned" || review.status === "accepted").length,
        evidenceCount: evidence.length,
        storageAvailable: true,
      };
    } catch (error) {
      if (error instanceof ProvisionalContributionSchemaUnavailableError) {
        return { profile, attempts, runs, provisionalContributions: [], provisionalLedgerAvailable: false, reviewCount: reviews.filter((review) => review.status === "assigned" || review.status === "accepted").length, evidenceCount: evidence.length, storageAvailable: true };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) {
      return { profile: null, attempts: [], runs: [], provisionalContributions: [], provisionalLedgerAvailable: false, reviewCount: null, evidenceCount: null, storageAvailable: false };
    }
    throw error;
  }
}

async function loadCatalogTargets(): Promise<readonly CatalogProblem[]> {
  try {
    return await getCatalogRepository().list("frontier");
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return [];
    throw error;
  }
}

function requestedTargetSlug(searchParams: { target?: string | string[] }): string | null {
  const target = typeof searchParams.target === "string" ? searchParams.target.trim() : "";
  return target.length > 0 && target.length <= 120 ? target : null;
}

function requestedParentNodeId(searchParams: { parent?: string | string[] }): string | null {
  const parent = typeof searchParams.parent === "string" ? searchParams.parent.trim() : "";
  return parent.length > 0 && parent.length <= 240 ? parent : null;
}

function requestedAttemptId(searchParams: { attempt?: string | string[] }): string | null {
  const attempt = typeof searchParams.attempt === "string" ? searchParams.attempt.trim() : "";
  return attempt.length > 0 && attempt.length <= 240 ? attempt : null;
}
