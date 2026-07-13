import { Footer, Header } from "../ui";
import { getChatGPTUser } from "../chatgpt-auth";
import { WorkbenchClient } from "./WorkbenchClient";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { MissingDatabaseBindingError } from "@/db";

export const dynamic = "force-dynamic";

export default async function WorkbenchPage() {
  const profile = await loadDelegationProfile();

  return (
    <div className="site-shell app-shell">
      <Header active="workbench" />
      <main className="workbench-main">
        <WorkbenchClient profile={profile} />
      </main>
      <Footer />
    </div>
  );
}

async function loadDelegationProfile(): Promise<DelegationProfile | null> {
  const user = await getChatGPTUser();
  if (!user) return null;

  try {
    return await getDelegationRepository().getProfile({
      provider: "chatgpt",
      subject: user.email,
      displayName: user.displayName,
    });
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return null;
    throw error;
  }
}
