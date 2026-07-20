"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import compatibilityContract from "@/packages/protocol/proofweave-client-compatibility.json";
import { CodexConnectPrompt, CodexInstallPrompt, CodexWorkflowPrompt } from "./CodexInstallPrompt";

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
  selectedTarget,
  returnHref,
}: {
  connection: { agentLabel: string } | null;
  selectedTarget: SelectedTarget | null;
  returnHref: string;
}) {
  const [watchingConnection, setWatchingConnection] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState<string | null>(null);
  const pageHref = selectedTarget
    ? `/integrations?target=${encodeURIComponent(selectedTarget.slug)}&return_to=${encodeURIComponent(returnHref)}#codex-beta`
    : "/integrations#codex-beta";

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
      <article className="integration-card integration-card-dark integration-primary-card" id="codex-beta">
        <span className="micro-label">01 / {connection ? "Connection ready" : "Connect this computer"}</span>
        <h2>{connection ? `${connection.agentLabel} is approved.` : "Approve your local Codex once."}</h2>
        <p>{connection
          ? "The website can see this revocable Agent installation. Its private key, OAuth refresh token, Lean workspace, and model settings remain on your computer."
          : "Copy one request into Codex. It checks the current Connector first, explains any old-address migration, and waits for browser approval before changing authority."}</p>

        {connection ? <div className="integration-connected-callout integration-connected-callout-dark">
          <strong>{selectedTarget ? `Continue ${selectedTarget.title}` : "Choose a bounded research target"}</strong>
          <p>{selectedTarget ? "Return to the same target, then start or resume its Attempt with this approved Agent." : "Open the Workspace or Explore page. Proofweave will bind the target to this Agent without asking for IDs or keys."}</p>
          <Link className="button button-primary" href={returnHref}>{selectedTarget ? "Continue selected target" : "Open my Workspace"} <span aria-hidden="true">→</span></Link>
        </div> : <div className="integration-connect-action">
          <CodexConnectPrompt role="research" targetTitle={selectedTarget?.title} returnHref={returnHref} onRequestCopied={() => setWatchingConnection(true)} />
          <p>After you copy the request, this page watches for the approved connection and returns to the same target automatically. No Attempt or file upload happens during connection.</p>
          {connectionNotice && <p className="integration-connection-notice" aria-live="polite">{connectionNotice}</p>}
          <div className="integration-inline-links">
            <Link href={pageHref}>Refresh connection status <span aria-hidden="true">↻</span></Link>
            {selectedTarget && <Link href={returnHref}>Return to selected target <span aria-hidden="true">→</span></Link>}
          </div>
        </div>}

        <ol className="integration-flow integration-flow-compact">
          <li><b>1</b><span>Codex checks whether this computer is already connected, disconnected, or saved against an older Proofweave address.</span></li>
          <li><b>2</b><span>You inspect and approve the exact research authority in the browser.</span></li>
          <li><b>3</b><span>You return to the selected target; the website creates or resumes its bounded Attempt.</span></li>
        </ol>
        <p className="integration-note">Connection creates revocable authority only. It does not upload a workspace, run Lean, claim verification, or create contribution credit.</p>
      </article>

      <article className="integration-card integration-install-card">
        <span className="micro-label">02 / Only if the plugin is missing</span>
        <h2>Install Proofweave Research once.</h2>
        <p>If Codex already exposes <code>connection_status</code>, skip this card. Otherwise the public guide makes Codex show both commands and wait for your confirmation.</p>
        <CodexInstallPrompt />
        <details className="integration-command-details">
          <summary>Show the two auditable terminal commands</summary>
          <code>codex plugin marketplace add alexyyyander/proofweave --ref main --sparse .agents/plugins</code>
          <code>codex plugin add proofweave-research@proofweave-private-beta</code>
        </details>
        <div className="integration-status integration-status-ready"><i aria-hidden="true" />Private beta: GitHub repository access is currently required</div>
        <div className="integration-update-policy" aria-label="Connector update policy">
          <div>
            <span className="micro-label">Live compatibility</span>
            <strong>Protocol v{compatibilityContract.connectorApiVersion} · tool schema v{compatibilityContract.toolSchemaVersion}</strong>
          </div>
          <dl>
            <div><dt>Normal service updates</dt><dd>Continue this task</dd></div>
            <div><dt>Tool or skill changes</dt><dd>Update, then restart Codex</dd></div>
          </dl>
          <p>Ask Codex to run <code>connection_status</code>. It checks this contract without sending a token, key, workspace file, or research content.</p>
        </div>
      </article>

      <article className="integration-card integration-card-wide integration-advanced-card">
        <span className="micro-label">Details when you need them</span>
        <h2>Authority, review work, and the privacy boundary.</h2>
        <div className="integration-disclosures">
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
