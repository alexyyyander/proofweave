import Link from "next/link";
import { CodexConnectPrompt, CodexInstallPrompt, CodexWorkflowPrompt } from "./CodexInstallPrompt";

const authorizedScopes = [
  "Read the frontier catalog",
  "Create your bounded Attempts",
  "Record provisional progress",
  "List and read only Attempts bound to this exact Agent certificate",
  "Stage bounded signed proof artifacts for an authorized Attempt",
  "Request and inspect the exact research Agent's isolated Runner lifecycle",
  "With review authority, discover only review assignments addressed to your Person",
  "With review authority, submit one owner-confirmed signed attestation for an assigned Bundle",
];

export function IntegrationClient({ connection }: { connection: { agentLabel: string } | null }) {
  return (
    <section className="integration-grid" aria-label="Local Agent connection">
      <article className="integration-card" id="codex-beta">
        <span className="micro-label">01 / {connection ? "Connection ready" : "Install once"}</span>
        <h2>{connection ? "This local Codex is already connected." : "Add the Proofweave Research plugin."}</h2>
        <p>
          {connection
            ? `${connection.agentLabel} has a revocable local connection. Its private key, refresh token, workspace, and model settings remain on your computer.`
            : "The private-beta plugin includes a local MCP Connector. It runs on your computer alongside Codex; it is not a hosted model and it never receives your ChatGPT password or API key."}
        </p>
        {connection ? <div className="integration-connected-callout"><strong>Next: choose a research target.</strong><p>Use Codex to inspect a pinned problem and record only selected, signed progress.</p><Link className="button button-primary" href="/workbench">Open my Workspace <span aria-hidden="true">→</span></Link></div> : <CodexInstallPrompt />}
        <details className="integration-command-details">
          <summary>Prefer the terminal? Show the two install commands.</summary>
          <code>codex plugin marketplace add alexyyyander/proofweave --ref main --sparse .agents/plugins</code>
          <code>codex plugin add proofweave-research@proofweave-private-beta</code>
        </details>
        <div className="integration-status integration-status-ready"><i aria-hidden="true" />Private beta: repository access is required while the plugin remains private</div>
        <p className="integration-note integration-note-light">Codex can perform the setup, but it must show the commands and receive your confirmation first. The local Bridge is included automatically.</p>
      </article>

      <article className="integration-card integration-card-dark">
        <span className="micro-label">02 / {connection ? "Use Codex" : "Connect in Codex"}</span>
        <h2>{connection ? "Choose a target, then simply continue in Codex." : "Approve one local Agent, once."}</h2>
        {connection ? <ol className="integration-flow">
          <li><b>1</b><span>Choose a source-pinned question in your Workspace or the public frontier.</span></li>
          <li><b>2</b><span>Click <strong>Start research</strong>, then tell Codex: “Continue my Proofweave research.”</span></li>
          <li><b>3</b><span>Keep Lean and private notes local. When ready, one owner confirmation stages the prepared Bundle and requests its isolated Run.</span></li>
        </ol> : <ol className="integration-flow">
          <li><b>1</b><span>Install the plugin once, then ask Codex to connect Proofweave when you are ready.</span></li>
          <li><b>2</b><span>Approve the browser screen. Your local Agent key remains on this computer; Proofweave receives only its public identity and revocable authority.</span></li>
          <li><b>3</b><span>Return here, choose a target, and start research. You never need to paste a key, certificate, Attempt ID, or token.</span></li>
        </ol>}
        <div className="integration-scopes" aria-label="Authorization scopes after activation">
          {authorizedScopes.map((scope) => <span key={scope}>{scope}</span>)}
        </div>
        {connection && <div className="integration-connected-callout">
          <strong>Ready to submit a local Lean workspace?</strong>
          <p>Codex prepares the signed draft locally first. It must show the exact hashes and wait before one confirmed upload-and-run request.</p>
          <CodexWorkflowPrompt workflow="research_submission" />
        </div>}
        <div className="integration-connected-callout" id="review-agent">
          <strong>Need to verify another Person’s work?</strong>
          <p>The browser shows a separate review-scoped delegation. Once connected, Codex can discover your Person-addressed queue without asking you to copy an assignment ID; your own Agents still cannot independently review your work.</p>
          <div className="codex-install-actions"><CodexConnectPrompt role="review" /><CodexWorkflowPrompt workflow="review_queue" /></div>
        </div>
        <p className="integration-note">
          This Beta can read the frontier, create bounded Attempts, and record
          provisional progress. It never uploads a workspace: a selected file
          can leave this computer only after a separate preview and your exact
          confirmation. It does not turn Agent-reported work into verification
          or a contribution receipt.
        </p>
        {!connection && <details className="integration-command-details">
          <summary>Connection did not work?</summary>
          <p>If Codex reports that Proofweave cannot be reached, its task may use a network allowlist. Allow only <code>proofweave-research.yualex031821.chatgpt.site</code> and start a fresh task; the complete guide gives the scoped repair steps.</p>
        </details>}
        <Link className="text-link" href={connection ? "/settings#delegation-setup" : "/settings"}>{connection ? "Inspect or revoke this local connection" : "Inspect or revoke local connections"} <span>→</span></Link>
        <a className="text-link" href="/codex-install.md" target="_blank" rel="noreferrer">Read the complete connection guide <span>→</span></a>
      </article>

      <article className="integration-card integration-card-wide">
        <span className="micro-label">Privacy boundary</span>
        <h2>Keep reasoning private; make only selected progress portable.</h2>
        <p>
          The local Connector stores its Agent private key and refresh token in
          a protected file on your computer. Proofweave records the public
          Agent key, your signed delegation, and the reversible connection
          installation. Artifact uploads remain explicit, separate actions
          with their own manifest and review gates.
        </p>
        <Link className="text-link" href="/workbench">Open your local-first Workspace <span>→</span></Link>
      </article>
    </section>
  );
}
