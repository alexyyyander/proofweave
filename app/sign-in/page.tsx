import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, Button, Input, Surface } from "@/app/components/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { chatGPTSignInPath, safeRelativeReturnPath } from "../chatgpt-auth";
import { getCurrentUser } from "../auth";
import { demoAuthConfig } from "../demo-auth-config";
import { googleAuthConfig } from "../google-auth-config";
import { hostingConfig } from "../hosting-config";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("signIn.metaTitle"), description: t("signIn.metaDescription") };
}

type SignInPageProps = {
  searchParams: Promise<{ return_to?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { t } = await getI18n();
  const query = await searchParams;
  const returnTo = safeRelativeReturnPath(query.return_to ?? "/profile");
  const user = await getCurrentUser();
  if (user) redirect(returnTo);
  const google = googleAuthConfig();
  const demo = demoAuthConfig();
  const hosting = hostingConfig();
  const error = signInError(query.error, t);

  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="auth-main">
      <Surface as="section" className="auth-card" aria-labelledby="auth-title">
        <div className="auth-intro">
          <p className="eyebrow">{t("signIn.eyebrow")}</p>
          <PageTitle id="auth-title">{t("signIn.title")}</PageTitle>
          <p>{t("signIn.description")}</p>
        </div>
        {error && <div className="auth-error" role="alert"><strong>{t("signIn.error.title")}</strong><span>{error}</span></div>}
        <div className="auth-provider-list">
          {demo.enabled && <form method="post" action="/auth/demo/start">
            <Input type="hidden" name="return_to" value={returnTo} />
            <Button className="auth-provider auth-provider-button" type="submit">
              <span className="auth-provider-mark auth-provider-demo" aria-hidden="true">∴</span><span><strong>{t("signIn.demo.title")}</strong><small>{t("signIn.demo.body")}</small></span><i aria-hidden="true">→</i>
            </Button>
          </form>}
          {google.configured
            ? <Link className="auth-provider auth-provider-google" href={`/auth/google/start?return_to=${encodeURIComponent(returnTo)}`}>
              <GoogleMark /><span><strong>{t("signIn.google.title")}</strong><small>{t("signIn.google.body")}</small></span><i aria-hidden="true">→</i>
            </Link>
            : <div className="auth-provider auth-provider-disabled" aria-disabled="true">
              <GoogleMark /><span><strong>{t("signIn.google.title")}</strong><small>{t("signIn.google.pending")}</small></span><i aria-hidden="true">{t("signIn.google.soon")}</i>
            </div>}
          {hosting.sitesBridgeEnabled && <a className="auth-provider" href={`/auth/sites-bridge/start?return_to=${encodeURIComponent(returnTo)}`} target="_top">
            <span className="auth-provider-mark auth-provider-openai" aria-hidden="true">◎</span><span><strong>{t("signIn.chatgpt.title")}</strong><small>{t("signIn.chatgpt.sitesBridge")}</small></span><i aria-hidden="true">→</i>
          </a>}
          {hosting.sitesLoginEnabled && <Link className="auth-provider" href={chatGPTSignInPath(returnTo)}>
            <span className="auth-provider-mark auth-provider-openai" aria-hidden="true">◎</span><span><strong>{t("signIn.chatgpt.title")}</strong><small>{t("signIn.chatgpt.sitesLogin")}</small></span><i aria-hidden="true">→</i>
          </Link>}
        </div>
        <div className="auth-boundary">
          <strong>{t("signIn.boundary.title")}</strong>
          <p>{t("signIn.boundary.body")}</p>
          <p>{t("signIn.boundary.legalA")} <Link href="/terms">{t("signIn.boundary.terms")}</Link> {t("signIn.boundary.legalB")} <Link href="/privacy">{t("signIn.boundary.privacy")}</Link>{t("signIn.boundary.legalC")}</p>
        </div>
      </Surface>
    </SiteFrame>;
}

function GoogleMark() {
  return <span className="auth-provider-mark auth-provider-google-mark" aria-hidden="true">G</span>;
}

const signInErrorKeys: Record<string, TranslationKey> = {
  sites_bridge_failed: "signIn.error.sites_bridge_failed",
  access_denied: "signIn.error.access_denied",
  invalid_state: "signIn.error.invalid_state",
  expired_state: "signIn.error.expired_state",
  unverified_email: "signIn.error.unverified_email",
  configuration_error: "signIn.error.configuration_error",
  token_exchange_failed: "signIn.error.token_exchange_failed",
  invalid_id_token: "signIn.error.invalid_id_token",
};

function signInError(code: string | undefined, t: Translator): string | null {
  if (!code) return null;
  const key = signInErrorKeys[code];
  return key ? t(key) : t("signIn.error.default");
}
