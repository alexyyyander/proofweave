"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import compatibilityContract from "@/packages/protocol/proofweave-client-compatibility.json";
import {
  CodexConnectPrompt,
  CodexInstallPrompt,
  CodexSetupPrompt,
  CodexWorkflowPrompt,
} from "./CodexInstallPrompt";
import { integrationRefreshHref } from "@/packages/protocol/integration-return-href.mjs";

const authorizedScopes = [
  "Read the frontier catalog",
  "Create your bounded Attempts",
  "Record provisional progress",
  "Read only Attempts bound to this exact Agent certificate",
  "Stage an owner-approved signed Artifact Bundle",
  "Request and inspect that Agent's isolated Runner lifecycle",
  "With review authority, discover only assignments addressed to your Person",
  "With review authority, submit one owner-confirmed signed attestation",
];

type SelectedTarget = Readonly<{
  slug: string;
  title: string;
  domain: string;
  informalStatement: string;
}>;

export function IntegrationClient({
  connection,
  isAuthenticated,
  signInHref,
  googleSignInAvailable,
  controlPlaneWritesEnabled,
  selectedTarget,
  returnHref,
}: {
  connection: { agentLabel: string } | null;
  isAuthenticated: boolean;
  signInHref: string;
  googleSignInAvailable: boolean;
  controlPlaneWritesEnabled: boolean;
  selectedTarget: SelectedTarget | null;
  returnHref: string;
}) {
  const [watchingConnection, setWatchingConnection] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const pageHref = integrationRefreshHref({
    targetSlug: selectedTarget?.slug,
    returnHref,
  });

  useEffect(() => {
    if (connection || !watchingConnection) return;
    let cancelled = false;
    let timer: number | null = null;
    let attempts = 0;

    const check = async () => {
      attempts += 1;
      try {
        const response = await fetch("/api/me/workspace-summary", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.summary?.agent?.connected) {
          if (!cancelled) {
            setConnectionNotice("Connection approved. Returning to your selected research…");
            window.location.assign(returnHref);
          }
          return;
        }
        if (!cancelled) {
          setConnectionNotice(response.status === 401
            ? "Complete sign-in and browser approval; this page will keep checking."
            : "Waiting for browser approval…");
        }
      } catch {
        if (!cancelled) setConnectionNotice("Waiting for the website connection record…");
      }
      if (!cancelled && attempts < 120) timer = window.setTimeout(check, 2500);
    };

    void check();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [connection, returnHref, watchingConnection]);

  return <>
    {selectedTarget && <section className="integration-target-context" aria-label="Selected research target">
      <div>
        <span className="micro-label">Selected research · {selectedTarget.domain}</span>
        <strong>{selectedTarget.title}</strong>
        <p>{selectedTarget.informalStatement}</p>
      </div>
      <div>
        <span>Your target remains selected during connection.</span>
        <Link href={`/explore/${selectedTarget.slug}`}>Inspect source <span aria-hidden="true">→</span></Link>
      </div>
    </section>}

    <section className="integration-grid integration-entry-grid" aria-label="Local Agent connection">
      <article className="integration-card integration-card-dark integration-primary-card integration-card-wide" id="codex-beta">
        <span className="micro-label">{connection ? "Codex connected" : isAuthenticated ? "One-time setup" : "Sign in first"}</span>
        <h2>{connection ? `${connection.agentLabel} is ready.` : "Approve your local Codex once."}</h2>
        <p>{connection
          ? "Return to the Workspace to start or resume research. Your repository, private key, prompts, and unfinished reasoning remain on this computer."
          : isAuthenticated
            ? "Copy one setup request into Codex. Codex checks whether the plugin is already installed, requests each required approval, and returns you here when the connection is ready."
            : "Sign in with ChatGPT before connecting this computer. Your sign-in creates the Person identity that will own its Agent work."}</p>

        <ol className="integration-flow integration-flow-compact" aria-label="First research setup">
          <li><b>{selectedTarget ? "✓" : "1"}</b><span><strong>Choose a problem.</strong> {selectedTarget ? `${selectedTarget.title} is selected.` : "Browse the public catalog and select one exact target."}</span></li>
          <li><b>{connection ? "✓" : "2"}</b><span><strong>Connect Codex once.</strong> {connection ? "This computer has revocable research authority." : "Codex handles installation checks and opens the approval page."}</span></li>
          <li><b>3</b><span><strong>Return to your Workspace.</strong> Start or resume the saved research task for the selected problem.</span></li>
        </ol>

        {!controlPlaneWritesEnabled && <div className="integration-connect-action" role="status">
          <strong>Connections are temporarily paused for maintenance.</strong>
          <p>Public questions and verification records remain readable. No Agent connection, research task, or evidence write can complete while maintenance is active.</p>
        </div>}

        {connection ? <div className="integration-connected-callout integration-connected-callout-dark">
          <strong>{controlPlaneWritesEnabled
            ? selectedTarget ? `Continue ${selectedTarget.title}` : "Your Workspace is ready"
            : "Your existing Workspace remains readable"}</strong>
          <p>{controlPlaneWritesEnabled
            ? selectedTarget ? "Your selected target is preserved. Open the Workspace to start or resume its saved research task." : "Choose a target in Explore or open your Workspace to resume existing research."
            : "You may inspect existing work now. Starting or updating research remains paused until maintenance ends."}</p>
          <Link className="button button-primary" href={returnHref}>{controlPlaneWritesEnabled
            ? selectedTarget ? "Return to selected research" : "Open my Workspace"
            : "View my Workspace"} <span aria-hidden="true">→</span></Link>
        </div> : !controlPlaneWritesEnabled ? <button className="button button-primary" type="button" disabled>Connection temporarily paused</button> : !isAuthenticated ? <div className="integration-connect-action">
          <Link className="button button-primary" href={signInHref}>Continue with ChatGPT <span aria-hidden="true">→</span></Link>
          <p>ChatGPT sign-in is available. Google sign-in is {googleSignInAvailable ? "also available" : "not available yet"}.</p>
        </div> : <div className="integration-connect-action">
          <CodexSetupPrompt targetTitle={selectedTarget?.title} returnHref={returnHref} onRequestCopied={() => setWatchingConnection(true)} />
          <p>Paste the copied request into Codex. Installation and connection remain separate approval moments inside the same guided setup; nothing changes silently.</p>
          {connectionNotice && <p className="integration-connection-notice" aria-live="polite">{connectionNotice}</p>}
          <div className="integration-inline-links">
            <Link href={pageHref}>Refresh connection status <span aria-hidden="true">↻</span></Link>
          </div>
        </div>}

        <div className="integration-inline-links">
          <Link href="/explore">Browse research first <span aria-hidden="true">→</span></Link>
        </div>
        <p className="integration-note">Connection creates revocable authority only. It does not upload a workspace, run Lean, claim verification, or create contribution credit. Sign-in: ChatGPT available · Google {googleSignInAvailable ? "available" : "not yet available"}.</p>
      </article>

      <article className="integration-card integration-card-wide integration-advanced-card">
        <span className="micro-label">Optional details</span>
        <h2>Inspect installation, permissions, and privacy.</h2>
        <div className="integration-disclosures">
          <details>
            <summary>If the Proofweave plugin is missing</summary>
            <p>Install from a local marketplace once. Codex downloads the public archive and checksum, verifies them before extraction, and asks before adding the local marketplace. No GitHub account or repository access is required.</p>
            <CodexInstallPrompt />
            <details className="integration-command-details">
              <summary>Show the auditable installation sequence</summary>
              <code>Download /downloads/proofweave-research-marketplace.tar and its .sha256 file</code>
              <code>shasum -a 256 -c proofweave-research-marketplace.tar.sha256</code>
              <code>tar -xf proofweave-research-marketplace.tar -C &quot;$PROOFWEAVE_MARKETPLACE_DIR&quot;</code>
              <code>codex plugin marketplace add &quot;$PROOFWEAVE_MARKETPLACE_DIR&quot;</code>
              <code>codex plugin add proofweave-research@proofweave-private-beta</code>
            </details>
            <div className="integration-status integration-status-ready"><i aria-hidden="true" />Private beta: local install; no GitHub account required</div>
          </details>
          <details>
            <summary>Plugin updates and Codex restarts</summary>
            <div className="integration-update-policy" aria-label="Connector update policy">
              <div>
                <span className="micro-label">Live compatibility</span>
                <strong>Protocol v{compatibilityContract.connectorApiVersion} · tool schema v{compatibilityContract.toolSchemaVersion}</strong>
              </div>
              <dl>
                <div><dt>Normal service updates</dt><dd>Continue this task</dd></div>
                <div><dt>Published plugin update</dt><dd>Review checksum and commands</dd></div>
                <div><dt>After an approved reinstall</dt><dd>Restart Codex</dd></div>
              </dl>
              <p>Ask Codex to run <code>connection_status</code>. It checks the fixed same-origin distribution manifest without sending a token, key, workspace file, or research content. An available update is advice only: Codex must show its version, archive hash, size, and commands, then ask again before reinstalling.</p>
            </div>
          </details>
          <details>
            <summary>What can a research connection do?</summary>
            <div className="integration-scopes" aria-label="Authorization scopes after activation">
              {authorizedScopes.map((scope) => <span key={scope}>{scope}</span>)}
            </div>
          </details>
          <details id="review-agent">
            <summary>Connect a separate independent-review authority</summary>
            <p>A review-scoped Agent sees only assignments addressed to your Person. Your own Agents still cannot independently verify your work.</p>
            <div className="codex-install-actions"><CodexConnectPrompt role="review" returnHref="/reviews" /><CodexWorkflowPrompt workflow="review_queue" /></div>
          </details>
          {connection && <details>
            <summary>Prepare a later research submission</summary>
            <p>Codex prepares hashes locally and must show the exact signed Bundle draft before any owner-approved upload or Run request.</p>
            <CodexWorkflowPrompt workflow="research_submission" />
          </details>}
          <details>
            <summary>Why an old Connector may require approval again</summary>
            <p>An OAuth token is bound to the deployment that issued it. If Codex reports an older Worker address, approving a new connection moves this computer to the current Site without deleting its Agent key. Separate legacy databases are never silently merged.</p>
          </details>
        </div>
        <div className="integration-card-links">
          <Link className="text-link" href={connection ? "/settings#delegation-setup" : "/settings"}>Inspect or revoke local connections <span>→</span></Link>
          <a className="text-link" href="/codex-install.md" target="_blank" rel="noreferrer">Read the complete connection guide <span>→</span></a>
          <Link className="text-link" href="/privacy">Read the privacy boundary <span>→</span></Link>
        </div>
      </article>
    </section>
  </>;
}
