import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, Surface } from "@/app/components/ui";
import { ProductStateBadge } from "@/app/ui";

import { MissingDatabaseBindingError, getConnectionOperationState } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";
import { CodexPairingApproval } from "./CodexPairingApproval";
import { ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";
import { getI18n } from "@/app/i18n/server";
import type { Metadata } from "next";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("connect.metaTitle"), description: t("connect.metaDescription") };
}

export const dynamic = "force-dynamic";

type ConnectCodexPageProps = {
  searchParams: Promise<{ pairing?: string; secret?: string }>;
};

export default async function ConnectCodexPage({ searchParams }: ConnectCodexPageProps) {
  const { t } = await getI18n();
  const readOnly = !getConnectionOperationState().writesEnabled;
  const query = await searchParams;
  const pairingId = typeof query.pairing === "string" ? query.pairing : "";
  const secret = typeof query.secret === "string" ? query.secret : "";
  const returnTo = `/connect/codex?pairing=${encodeURIComponent(pairingId)}&secret=${encodeURIComponent(secret)}`;
  const user = await getCurrentUser();
  if (!user) {
    return <SiteFrame className="site-shell app-shell" active="settings" mainClassName="connect-codex-main">
        <Surface as="section" className="connect-codex-card connect-codex-signin">
          <p className="eyebrow">{t("connect.signIn.eyebrow")}</p>
          <PageTitle>{t("connect.signIn.title")}</PageTitle>
          <p>{t("connect.signIn.body")}</p>
          <a className="button button-primary" href={signInPath(returnTo)}>{t("connect.signIn.action")} <span aria-hidden="true">→</span></a>
        </Surface>
      </SiteFrame>;
  }

  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="settings"
      eyebrow={t("connect.readOnly.eyebrow")}
      title={t("connect.readOnly.title")}
      detail={t("connect.readOnly.detail")}
    />;
  }

  let profile = null;
  try {
    profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
  } catch (error) {
    if (!(error instanceof MissingDatabaseBindingError)) throw error;
  }

  return <SiteFrame className="site-shell app-shell" active="settings" mainClassName="connect-codex-main">
      {profile ? <>
        <section className="connect-codex-intro">
          <div>
            <p className="eyebrow">{t("connect.intro.eyebrow")}</p>
            <PageTitle>{t("connect.intro.title")}</PageTitle>
            <p>{t("connect.intro.body")}</p>
          </div>
          <ProductStateBadge tone="provisional">{t("connect.intro.badge")}</ProductStateBadge>
        </section>
        <CodexPairingApproval profile={profile} pairingId={pairingId} secret={secret} />
      </> : <Surface as="section" className="connect-codex-card">
        <p className="eyebrow">{t("connect.storage.eyebrow")}</p>
        <PageTitle>{t("connect.storage.title")}</PageTitle>
        <p>{t("connect.storage.body")}</p>
      </Surface>}
    </SiteFrame>;
}
