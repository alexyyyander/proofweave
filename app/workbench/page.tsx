import { Footer, Header } from "../ui";
import { chatGPTSignInPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { WorkbenchClient } from "./WorkbenchClient";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getMcpRepository } from "@/db/repositories/mcp";
import { getCatalogRepository } from "@/db/repositories/catalog";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt } from "@/packages/domain/mcp";
import { MissingDatabaseBindingError } from "@/db";

export const dynamic = "force-dynamic";

export default async function WorkbenchPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string | string[] }>;
}) {
  const user = await getChatGPTUser();
  const targetSlug = requestedTargetSlug(await searchParams);
  const { profile, attempts, storageAvailable } = await loadWorkbench(user);
  const catalogTargets = await loadCatalogTargets();
  const returnTo = targetSlug ? `/workbench?target=${encodeURIComponent(targetSlug)}#attempt-queue` : "/workbench";

  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main className="workbench-main">
        <WorkbenchClient profile={profile} initialAttempts={attempts} catalogTargets={catalogTargets} initialTargetSlug={targetSlug} isAuthenticated={Boolean(user)} signInPath={chatGPTSignInPath(returnTo)} storageAvailable={storageAvailable} />
      </main>
      <Footer />
    </div>
  );
}

async function loadWorkbench(user: ChatGPTUser | null): Promise<{ profile: DelegationProfile | null; attempts: readonly McpAttempt[]; storageAvailable: boolean }> {
  if (!user) return { profile: null, attempts: [], storageAvailable: true };

  try {
    const profile = await getDelegationRepository().getProfile({
      provider: "chatgpt",
      subject: user.email,
      displayName: user.displayName,
    });
    return {
      profile,
      attempts: await getMcpRepository().listAttempts(profile.person.id),
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { profile: null, attempts: [], storageAvailable: false };
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
