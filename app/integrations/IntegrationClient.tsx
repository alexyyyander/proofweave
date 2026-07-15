import Link from "next/link";
import { CodexInstallPrompt } from "./CodexInstallPrompt";

const authorizedScopes = [
  "Read the frontier catalog",
  "Create your bounded Attempts",
  "Record provisional progress",
  "List and read only Attempts bound to this exact Agent certificate",
  "Stage bounded signed proof artifacts for an authorized Attempt",
  "Submit one signed review attestation for an assigned Bundle",
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
        <h2>{connection ? "Continue from your local research workspace." : "Approve one local Agent, once."}</h2>
        {connection ? <ol className="integration-flow">
          <li><b>1</b><span>Ask Codex to list the frontier or inspect the problem you selected.</span></li>
          <li><b>2</b><span>Keep Lean, models, and private notes on this computer while you explore.</span></li>
          <li><b>3</b><span>Record only a material, signed milestone when you choose to share it.</span></li>
        </ol> : <ol className="integration-flow">
          <li><b>1</b><span>Ask Codex to use <code>connect_proofweave</code>, or say “Connect Proofweave.”</span></li>
          <li><b>2</b><span>The local Bridge generates an Ed25519 Agent key on this computer and opens your browser.</span></li>
          <li><b>3</b><span>Sign in, inspect the privacy boundary, and approve a 30-day formalize/prove delegation.</span></li>
          <li><b>4</b><span>Return to Codex. It receives a revocable OAuth connection, not your browser session.</span></li>
        </ol>}
        <div className="integration-scopes" aria-label="Authorization scopes after activation">
          {authorizedScopes.map((scope) => <span key={scope}>{scope}</span>)}
        </div>
        <p className="integration-note">
          This Beta can read the frontier, create bounded Attempts, and record
          provisional progress. It does not upload a workspace, run Lean in
          the cloud, or turn Agent-reported work into verification or a
          contribution receipt.
        </p>
        <Link className="text-link" href={connection ? "/settings#delegation-setup" : "/settings"}>{connection ? "Inspect or revoke this local connection" : "Inspect or revoke local connections"} <span>→</span></Link>
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
