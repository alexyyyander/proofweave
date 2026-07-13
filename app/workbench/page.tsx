import { Footer, Header } from "../ui";
import { chatGPTSignInPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { WorkbenchClient } from "./WorkbenchClient";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getMcpRepository } from "@/db/repositories/mcp";
import { getCatalogRepository } from "@/db/repositories/catalog";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt, McpRunSummary } from "@/packages/domain/mcp";
import { MissingDatabaseBindingError } from "@/db";
import {
  getProvisionalContributionRepository,
  ProvisionalContributionSchemaUnavailableError,
  type ProvisionalContribution,
} from "@/db/repositories/provisional-contributions";

export const dynamic = "force-dynamic";

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[] }>;
}) {
  const user = await getChatGPTUser();
  const targetSlug = requestedTargetSlug(await searchParams);
  const { profile, attempts, runs, provisionalContributions, provisionalLedgerAvailable, storageAvailable } = await loadWorkbench(user);
  const catalogTargets = await loadCatalogTargets();
  const returnTo = targetSlug ? `/workbench?target=${encodeURIComponent(targetSlug)}#attempt-queue` : "/workbench";

  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main className="workbench-main">
        <WorkbenchClient profile={profile} initialAttempts={attempts} initialRuns={runs} initialProvisionalContributions={provisionalContributions} provisionalLedgerAvailable={provisionalLedgerAvailable} catalogTargets={catalogTargets} initialTargetSlug={targetSlug} isAuthenticated={Boolean(user)} signInPath={chatGPTSignInPath(returnTo)} storageAvailable={storageAvailable} />
      </main>
      <Footer />
    </div>
  );
}

async function loadWorkbench(user: ChatGPTUser | null): Promise<{
  profile: DelegationProfile | null;
  attempts: readonly McpAttempt[];
  runs: readonly McpRunSummary[];
  provisionalContributions: readonly ProvisionalContribution[];
  provisionalLedgerAvailable: boolean;
  storageAvailable: boolean;
}> {
  if (!user) return { profile: null, attempts: [], runs: [], provisionalContributions: [], provisionalLedgerAvailable: true, storageAvailable: true };

  try {
    const profile = await getDelegationRepository().getProfile({
      provider: "chatgpt",
      subject: user.email,
      displayName: user.displayName,
    });
    const mcp = getMcpRepository();
    const [attempts, runs] = await Promise.all([
      mcp.listAttempts(profile.person.id),
      mcp.listRunSummaries(profile.person.id),
    ]);
    try {
      return {
        profile,
        attempts,
        runs,
        provisionalContributions: await getProvisionalContributionRepository().listForPerson(profile.person.id),
        provisionalLedgerAvailable: true,
        storageAvailable: true,
      };
    } catch (error) {
      if (error instanceof ProvisionalContributionSchemaUnavailableError) {
        return { profile, attempts, runs, provisionalContributions: [], provisionalLedgerAvailable: false, storageAvailable: true };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) {
      return { profile: null, attempts: [], runs: [], provisionalContributions: [], provisionalLedgerAvailable: false, storageAvailable: false };
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
