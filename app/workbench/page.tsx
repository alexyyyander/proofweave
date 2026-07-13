import { Footer, Header } from "../ui";
import { chatGPTSignInPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { WorkbenchClient } from "./WorkbenchClient";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getMcpRepository } from "@/db/repositories/mcp";
import type { McpAttempt } from "@/packages/domain/mcp";
import { MissingDatabaseBindingError } from "@/db";

export const dynamic = "force-dynamic";

export default async function WorkbenchPage() {
  const user = await getChatGPTUser();
  const { profile, attempts, storageAvailable } = await loadWorkbench(user);

  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main className="workbench-main">
        <WorkbenchClient profile={profile} initialAttempts={attempts} isAuthenticated={Boolean(user)} signInPath={chatGPTSignInPath("/workbench")} storageAvailable={storageAvailable} />
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
