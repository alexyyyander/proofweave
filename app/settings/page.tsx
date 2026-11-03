import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, SectionHeading } from "@/app/components/ui";
import Link from "next/link";

import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getCurrentUser, providerAwareSignOutPath, signInPath, toPersonIdentity, type AuthUser } from "../auth";
import { ProductStateBadge } from "../ui";

import { PersonalWorkspaceFrame } from "../PersonalWorkspaceFrame";
import { AgentConnections } from "../workbench/AgentConnections";
import { DelegationSetup } from "../workbench/DelegationSetup";
import { DelegationSummary } from "../workbench/workbench-sections";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "../lib/read-only-personal-surface";
import { getI18n } from "@/app/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { t, locale } = await getI18n();
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="settings"
      eyebrow={t("settings.readOnly.eyebrow")}
      title={t("settings.readOnly.title")}
      detail={user ? t("settings.readOnly.detailSignedIn", { name: user.displayName }) : t("settings.readOnly.detailSignedOut")}
    />;
  }
  const { profile, storageAvailable } = await loadSettingsProfile(user);
  const connection = activeLocalCodexInstallation(profile);
  const status = !user
    ? { tone: "provisional" as const, label: t("settings.status.signIn") }
    : !storageAvailable
      ? { tone: "not-deployed" as const, label: t("settings.status.storage") }
      : connection
        ? { tone: "available" as const, label: t("settings.status.active") }
        : profile?.delegations.some((delegation) => delegation.revokedAt === null)
          ? { tone: "provisional" as const, label: t("settings.status.codex") }
        : { tone: "provisional" as const, label: t("settings.status.setup") };

  return <SiteFrame className="site-shell app-shell" active="settings" mainClassName="settings-main personal-workspace-main">
      <PersonalWorkspaceFrame active="settings">
      <SectionHeading as="section" className="settings-hero" aria-labelledby="settings-title">
        <div>
          <p className="eyebrow">{t("settings.hero.eyebrow")}</p>
          <PageTitle id="settings-title">{t("settings.hero.title")}</PageTitle>
          <p>{t("settings.hero.body")}</p>
        </div>
        <div className="settings-hero-status">
          <ProductStateBadge tone={status.tone}>{status.label}</ProductStateBadge>
          <span>{user ? user.displayName : t("settings.account.start")}</span>
          <Link
            className="settings-account-switch"
            href={user ? providerAwareSignOutPath(user, "/settings") : signInPath("/settings")}
          >
            {user ? t("settings.account.change") : t("settings.account.choose")}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </SectionHeading>

      <section className="settings-guide" aria-label={t("settings.guide.aria")}>
        <div><span>01</span><strong>{t("settings.guide.identity.title")}</strong><p>{t("settings.guide.identity.body")}</p></div>
        <div><span>02</span><strong>{t("settings.guide.authority.title")}</strong><p>{t("settings.guide.authority.body")}</p></div>
        <div><span>03</span><strong>{t("settings.guide.connections.title")}</strong><p>{t("settings.guide.connections.body")}</p></div>
      </section>

      {profile && <DelegationSummary profile={profile} t={t} locale={locale} />}
      <DelegationSetup profile={profile} isAuthenticated={Boolean(user)} signInPath={signInPath("/settings#delegation-setup")} storageAvailable={storageAvailable} />
      {profile && <AgentConnections installations={profile.agentInstallations} />}
      </PersonalWorkspaceFrame>
    </SiteFrame>;
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
