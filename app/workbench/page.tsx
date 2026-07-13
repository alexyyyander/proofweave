import { Footer, Header } from "../ui";
import { chatGPTSignInPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { WorkbenchClient } from "./WorkbenchClient";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { MissingDatabaseBindingError } from "@/db";

export const dynamic = "force-dynamic";

export default async function WorkbenchPage() {
  const user = await getChatGPTUser();
  const { profile, storageAvailable } = await loadDelegationProfile(user);

  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main className="workbench-main">
        <WorkbenchClient profile={profile} isAuthenticated={Boolean(user)} signInPath={chatGPTSignInPath("/workbench")} storageAvailable={storageAvailable} />
      </main>
      <Footer />
    </div>
  );
}

async function loadDelegationProfile(user: ChatGPTUser | null): Promise<{ profile: DelegationProfile | null; storageAvailable: boolean }> {
  if (!user) return { profile: null, storageAvailable: true };

  try {
    return {
      profile: await getDelegationRepository().getProfile({
        provider: "chatgpt",
        subject: user.email,
        displayName: user.displayName,
      }),
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { profile: null, storageAvailable: false };
    throw error;
  }
}
