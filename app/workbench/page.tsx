import Link from "next/link";
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
  const returnTo = targetSlug
    ? `/workbench?target=${encodeURIComponent(targetSlug)}${parentNodeId ? `&parent=${encodeURIComponent(parentNodeId)}` : ""}#research-launcher`
    : attemptId
      ? `/workbench?attempt=${encodeURIComponent(attemptId)}`
      : "/workbench";

  if (!user) {
    return <SignedOutWorkbench signInHref={signInPath(returnTo)} hasSelectedTarget={Boolean(targetSlug)} />;
  }

  const { profile, attempts, runs, provisionalContributions, provisionalLedgerAvailable, reviewCount, evidenceCount, storageAvailable } = await loadWorkbench(user);
  const catalogTargets = await loadCatalogTargets();

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

function SignedOutWorkbench({ signInHref, hasSelectedTarget }: { signInHref: string; hasSelectedTarget: boolean }) {
  return <div className="site-shell app-shell">
    <Header active="workbench" />
    <main id="main-content" tabIndex={-1} className="workbench-main signed-out-workbench">
      <section className="workspace-onboarding" aria-labelledby="workspace-onboarding-title">
        <div className="workspace-onboarding-copy">
          <p className="eyebrow">Personal research workspace</p>
          <h1 id="workspace-onboarding-title">One private place for your Agent&apos;s research.</h1>
          <p>Sign in to connect a local Agent, open bounded Attempts, and publish only the evidence you approve. Empty dashboards stay hidden until you have real work to show.</p>
          {hasSelectedTarget && <p className="workspace-onboarding-selection">Your selected research target will still be waiting after sign-in.</p>}
          <div className="button-row">
            <Link className="button button-primary" href={signInHref}>Sign in to begin <span aria-hidden="true">→</span></Link>
            <Link className="button button-secondary" href="/explore">Explore first</Link>
          </div>
        </div>
        <ol className="workspace-onboarding-steps" aria-label="Workspace setup steps">
          <li><span>01</span><div><strong>Choose one exact target</strong><p>Start from a pinned statement instead of an unbounded prompt.</p></div></li>
          <li><span>02</span><div><strong>Connect your local Agent</strong><p>Your repository and unfinished reasoning remain on your computer.</p></div></li>
          <li><span>03</span><div><strong>Approve evidence for review</strong><p>Only selected checkpoints become attributable public records.</p></div></li>
        </ol>
      </section>
      <section className="workspace-onboarding-boundary" aria-label="Workspace privacy boundary">
        <strong>Private by default.</strong>
        <p>Signing in creates a stable Person identity for attribution. It does not upload your prompts, private keys, repository, or reasoning history.</p>
        <Link href="/privacy">Read the privacy boundary <span aria-hidden="true">→</span></Link>
      </section>
    </main>
    <Footer />
  </div>;
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
