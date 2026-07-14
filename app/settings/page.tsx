import Link from "next/link";

import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { chatGPTSignInPath, chatGPTSignOutPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { Footer, Header, ProductStateBadge } from "../ui";
import { AgentConnections } from "../workbench/AgentConnections";
import { DelegationSetup } from "../workbench/DelegationSetup";
import { DelegationSummary } from "../workbench/workbench-sections";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getChatGPTUser();
  const { profile, storageAvailable } = await loadSettingsProfile(user);
  const status = !user
    ? { tone: "provisional" as const, label: "Sign in required" }
    : !storageAvailable
      ? { tone: "not-deployed" as const, label: "Storage unavailable" }
      : profile?.delegations.some((delegation) => delegation.revokedAt === null)
        ? { tone: "available" as const, label: "Account controls ready" }
        : { tone: "provisional" as const, label: "Setup required" };

  return <div className="site-shell app-shell">
    <Header active="settings" />
    <main id="main-content" tabIndex={-1} className="settings-main">
      <section className="settings-hero" aria-labelledby="settings-title">
        <div>
          <p className="eyebrow">Account and Agent controls</p>
          <h1 id="settings-title">Manage your research Agent.</h1>
          <p>Keep identity, keys, delegated authority, and Agent connections separate from the mathematical work happening in your Workspace.</p>
        </div>
        <div className="settings-hero-status">
          <ProductStateBadge tone={status.tone}>{status.label}</ProductStateBadge>
          <span>{user ? user.displayName : "Your contribution record starts after sign-in."}</span>
          <Link
            className="settings-account-switch"
            href={user ? chatGPTSignOutPath("/settings") : chatGPTSignInPath("/settings")}
          >
            {user ? "Switch ChatGPT account" : "Sign in with ChatGPT"}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className="settings-guide" aria-label="Settings purpose">
        <div><span>01</span><strong>Identity</strong><p>Your private Person signing key remains on this device.</p></div>
        <div><span>02</span><strong>Authority</strong><p>Delegations are scoped, signed, and revocable by their owner.</p></div>
        <div><span>03</span><strong>Connections</strong><p>Remote Agent approvals can be inspected or revoked independently.</p></div>
      </section>

      {profile && <DelegationSummary profile={profile} />}
      <DelegationSetup profile={profile} isAuthenticated={Boolean(user)} signInPath={chatGPTSignInPath("/settings#delegation-setup")} storageAvailable={storageAvailable} />
      {profile && <AgentConnections installations={profile.agentInstallations} />}
    </main>
    <Footer />
  </div>;
}

async function loadSettingsProfile(user: ChatGPTUser | null): Promise<{ profile: DelegationProfile | null; storageAvailable: boolean }> {
  if (!user) return { profile: null, storageAvailable: true };
  try {
    return {
      profile: await getDelegationRepository().getProfile({ provider: "chatgpt", subject: user.email, displayName: user.displayName }),
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { profile: null, storageAvailable: false };
    throw error;
  }
}
