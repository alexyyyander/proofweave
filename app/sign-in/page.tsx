import { SiteFrame } from "@/app/components/shell/SiteFrame";

import { PageTitle, Button, Input, Surface } from "@/app/components/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { chatGPTSignInPath, safeRelativeReturnPath } from "../chatgpt-auth";
import { getCurrentUser } from "../auth";
import { demoAuthConfig } from "../demo-auth-config";
import { googleAuthConfig } from "../google-auth-config";
import { hostingConfig } from "../hosting-config";

export const dynamic = "force-dynamic";

type SignInPageProps = {
  searchParams: Promise<{ return_to?: string; error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const returnTo = safeRelativeReturnPath(query.return_to ?? "/profile");
  const user = await getCurrentUser();
  if (user) redirect(returnTo);
  const google = googleAuthConfig();
  const demo = demoAuthConfig();
  const hosting = hostingConfig();
  const error = signInError(query.error);

  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="auth-main">
      <Surface as="section" className="auth-card" aria-labelledby="auth-title">
        <div className="auth-intro">
          <p className="eyebrow">Your Proofweave Person</p>
          <PageTitle id="auth-title">Continue your mathematical contribution record.</PageTitle>
          <p>Choose a private sign-in method. Your public work stays attached to one stable Person, not to a particular login provider.</p>
        </div>
        {error && <div className="auth-error" role="alert"><strong>Sign-in did not finish.</strong><span>{error}</span></div>}
        <div className="auth-provider-list">
          {demo.enabled && <form method="post" action="/auth/demo/start">
            <Input type="hidden" name="return_to" value={returnTo} />
            <Button className="auth-provider auth-provider-button" type="submit">
              <span className="auth-provider-mark auth-provider-demo" aria-hidden="true">∴</span><span><strong>Continue with a temporary Demo Person</strong><small>No email or external account required; contributions remain clearly marked as demo data</small></span><i aria-hidden="true">→</i>
            </Button>
          </form>}
          {google.configured
            ? <Link className="auth-provider auth-provider-google" href={`/auth/google/start?return_to=${encodeURIComponent(returnTo)}`}>
              <GoogleMark /><span><strong>Continue with Google</strong><small>Use a verified Google email</small></span><i aria-hidden="true">→</i>
            </Link>
            : <div className="auth-provider auth-provider-disabled" aria-disabled="true">
              <GoogleMark /><span><strong>Continue with Google</strong><small>Available after the deployment owner finishes Google OAuth setup</small></span><i aria-hidden="true">Soon</i>
            </div>}
          {hosting.sitesBridgeEnabled && <a className="auth-provider" href={`/auth/sites-bridge/start?return_to=${encodeURIComponent(returnTo)}`} target="_top">
            <span className="auth-provider-mark auth-provider-openai" aria-hidden="true">◎</span><span><strong>Continue with ChatGPT</strong><small>Sign in through the original Proofweave site</small></span><i aria-hidden="true">→</i>
          </a>}
          {hosting.sitesLoginEnabled && <Link className="auth-provider" href={chatGPTSignInPath(returnTo)}>
            <span className="auth-provider-mark auth-provider-openai" aria-hidden="true">◎</span><span><strong>Continue with ChatGPT</strong><small>Use the existing Sites identity flow</small></span><i aria-hidden="true">→</i>
          </Link>}
        </div>
        <div className="auth-boundary">
          <strong>One Person, multiple sign-in methods.</strong>
          <p>ChatGPT sign-in through the original site retains its existing Person. Other sign-in methods may use a separate Person; matching email alone does not guarantee account linking. Email and account identifiers remain private; public contribution records expose only your chosen display name and Person ID.</p>
        </div>
      </Surface>
    </SiteFrame>;
}

function GoogleMark() {
  return <span className="auth-provider-mark auth-provider-google-mark" aria-hidden="true">G</span>;
}

function signInError(code?: string): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    sites_bridge_failed: "ChatGPT sign-in could not be completed. Please restart sign-in from this page.",
    access_denied: "You cancelled the Google authorization request.",
    invalid_state: "The authorization request expired or could not be verified. Please try again.",
    expired_state: "The authorization request expired. Please try again.",
    unverified_email: "Proofweave requires a verified Google email.",
    configuration_error: "Google login is not configured correctly for this deployment.",
    token_exchange_failed: "Google could not complete the authorization code exchange. Please try again.",
    invalid_id_token: "Google returned an identity response that Proofweave could not verify.",
  };
  return messages[code] ?? "An unexpected authorization error occurred. Please try again.";
}
