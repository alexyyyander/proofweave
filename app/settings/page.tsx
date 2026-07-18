import Link from "next/link";

import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getCurrentUser, providerAwareSignOutPath, signInPath, toPersonIdentity, type AuthUser } from "../auth";
import { Footer, ProductStateBadge } from "../ui";
import { Header } from "../header";
import { PersonalWorkspaceFrame } from "../PersonalWorkspaceFrame";
import { AgentConnections } from "../workbench/AgentConnections";
import { DelegationSetup } from "../workbench/DelegationSetup";
import { DelegationSummary } from "../workbench/workbench-sections";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  const { profile, storageAvailable } = await loadSettingsProfile(user);
  const connection = activeLocalCodexInstallation(profile);
  const status = !user
    ? { tone: "provisional" as const, label: "Sign in required" }
    : !storageAvailable
      ? { tone: "not-deployed" as const, label: "Storage unavailable" }
      : connection
        ? { tone: "available" as const, label: "Agent approval active" }
        : profile?.delegations.some((delegation) => delegation.revokedAt === null)
          ? { tone: "provisional" as const, label: "Codex connection required" }
        : { tone: "provisional" as const, label: "Setup required" };

  return <div className="site-shell app-shell">
    <Header active="settings" />
    <main id="main-content" tabIndex={-1} className="settings-main personal-workspace-main">
      <PersonalWorkspaceFrame active="settings">
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
            href={user ? providerAwareSignOutPath(user, "/settings") : signInPath("/settings")}
          >
            {user ? "Change sign-in account" : "Choose a sign-in method"}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section className="settings-guide" aria-label="Settings purpose">
        <div><span>01</span><strong>Identity</strong><p>Your private Person signing key remains on this device.</p></div>
        <div><span>02</span><strong>Authority</strong><p>Delegations are scoped, signed, and revocable by their owner.</p></div>
        <div><span>03</span><strong>Connections</strong><p>Local Codex approvals can be inspected or revoked independently.</p></div>
      </section>

      {profile && <DelegationSummary profile={profile} />}
      <DelegationSetup profile={profile} isAuthenticated={Boolean(user)} signInPath={signInPath("/settings#delegation-setup")} storageAvailable={storageAvailable} />
      {profile && <AgentConnections installations={profile.agentInstallations} />}
      </PersonalWorkspaceFrame>
    </main>
    <Footer />
  </div>;
}

async function loadSettingsProfile(user: AuthUser | null): Promise<{ profile: DelegationProfile | null; storageAvailable: boolean }> {
  if (!user) return { profile: null, storageAvailable: true };
  try {
    return {
      profile: await getDelegationRepository().getProfile(toPersonIdentity(user)),
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { profile: null, storageAvailable: false };
    throw error;
  }
}
