import Link from "next/link";
import { redirect } from "next/navigation";
import { chatGPTSignInPath, safeRelativeReturnPath } from "../chatgpt-auth";
import { getCurrentUser } from "../auth";
import { googleAuthConfig } from "../google-auth-config";
import { Footer } from "../ui";
import { Header } from "../header";

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
  const error = signInError(query.error);

  return <div className="site-shell app-shell">
    <Header active="profile" />
    <main id="main-content" tabIndex={-1} className="auth-main">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-intro">
          <p className="eyebrow">Your Proofweave Person</p>
          <h1 id="auth-title">Continue your mathematical contribution record.</h1>
          <p>Choose a private sign-in method. Your public work stays attached to one stable Person, not to a particular login provider.</p>
        </div>
        {error && <div className="auth-error" role="alert"><strong>Google sign-in did not finish.</strong><span>{error}</span></div>}
        <div className="auth-provider-list">
          {google.configured
            ? <Link className="auth-provider auth-provider-google" href={`/auth/google/start?return_to=${encodeURIComponent(returnTo)}`}>
              <GoogleMark /><span><strong>Continue with Google</strong><small>Use a verified Google email</small></span><i aria-hidden="true">→</i>
            </Link>
            : <div className="auth-provider auth-provider-disabled" aria-disabled="true">
              <GoogleMark /><span><strong>Continue with Google</strong><small>Available after the deployment owner finishes Google OAuth setup</small></span><i aria-hidden="true">Soon</i>
            </div>}
          <Link className="auth-provider" href={chatGPTSignInPath(returnTo)}>
            <span className="auth-provider-mark auth-provider-openai" aria-hidden="true">◎</span><span><strong>Continue with ChatGPT</strong><small>Use the existing Sites identity flow</small></span><i aria-hidden="true">→</i>
          </Link>
        </div>
        <div className="auth-boundary">
          <strong>One Person, multiple sign-in methods.</strong>
          <p>If a new provider returns the same verified email, Proofweave links it to your existing Person. Email and account identifiers remain private; public contribution records expose only your chosen display name and Person ID.</p>
        </div>
      </section>
    </main>
    <Footer />
  </div>;
}

function GoogleMark() {
  return <span className="auth-provider-mark auth-provider-google-mark" aria-hidden="true">G</span>;
}

function signInError(code?: string): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
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
