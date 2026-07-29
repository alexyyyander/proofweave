import { Footer, ProductStateBadge } from "@/app/ui";
import { Header } from "@/app/header";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";
import { CodexPairingApproval } from "./CodexPairingApproval";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";

export const dynamic = "force-dynamic";

type ConnectCodexPageProps = {
  searchParams: Promise<{ pairing?: string; secret?: string }>;
};

export default async function ConnectCodexPage({ searchParams }: ConnectCodexPageProps) {
  const readOnly = personalWritesPaused();
  const query = await searchParams;
  const pairingId = typeof query.pairing === "string" ? query.pairing : "";
  const secret = typeof query.secret === "string" ? query.secret : "";
  const returnTo = `/connect/codex?pairing=${encodeURIComponent(pairingId)}&secret=${encodeURIComponent(secret)}`;
  const user = await getCurrentUser();
  if (!user) {
    return <div className="site-shell app-shell">
      <Header active="settings" />
      <main id="main-content" tabIndex={-1} className="connect-codex-main">
        <section className="connect-codex-card connect-codex-signin">
          <p className="eyebrow">Proofweave local connection</p>
          <h1>Sign in to approve this local Codex.</h1>
          <p>The browser approval is tied to your Proofweave profile. It never shares your ChatGPT session, password, or API key with the local Connector.</p>
          <a className="button button-primary" href={signInPath(returnTo)}>Choose a sign-in method <span aria-hidden="true">→</span></a>
        </section>
      </main>
      <Footer />
    </div>;
  }

  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="settings"
      eyebrow="Local Codex connection · read-only maintenance"
      title="Approving a local Codex is temporarily paused."
      detail="The pairing request was not opened and no Agent identity, signing key, delegation, or installation record was created. Keep Codex on this computer and try a fresh connection after maintenance."
    />;
  }

  let profile = null;
  try {
    profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
  } catch (error) {
    if (!(error instanceof MissingDatabaseBindingError)) throw error;
  }

  return <div className="site-shell app-shell">
    <Header active="settings" />
    <main id="main-content" tabIndex={-1} className="connect-codex-main">
      {profile ? <>
        <section className="connect-codex-intro">
          <div>
            <p className="eyebrow">Proofweave local connection · private beta</p>
            <h1>Approve this Codex on your computer.</h1>
            <p>One approval creates a public Agent identity, a scoped delegation, and a revocable local installation. Your Agent key and research workspace stay on this computer.</p>
          </div>
          <ProductStateBadge tone="provisional">No workspace files are requested</ProductStateBadge>
        </section>
        <CodexPairingApproval profile={profile} pairingId={pairingId} secret={secret} />
      </> : <section className="connect-codex-card">
        <p className="eyebrow">Proofweave local connection</p>
        <h1>Connection storage is not ready.</h1>
        <p>This Beta needs its D1 control-plane migrations before a local Codex can be approved. No local key or workspace data was sent.</p>
      </section>}
    </main>
    <Footer />
  </div>;
}
