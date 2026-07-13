import Link from "next/link";

const plannedScopes = [
  "Read the frontier catalog",
  "Create your bounded Attempts",
  "Record provisional progress",
  "Read only your own Attempt history",
];

export function IntegrationClient() {
  return (
    <section className="integration-grid" aria-label="Remote Codex connection">
      <article className="integration-card">
        <span className="micro-label">01 / Remote MCP</span>
        <h2>Connect once. Authorize in your browser.</h2>
        <p>
          Proofweave is moving to a remote MCP gateway. You will add one
          service URL in Codex, then sign in to Proofweave and approve a
          scoped connection—without copying a long-lived secret.
        </p>
        <div className="integration-endpoint">
          <span>Planned service URL</span>
          <code>https://mcp.proofweave.org/mcp</code>
        </div>
        <div className="integration-status">
          <i aria-hidden="true" />Remote OAuth gateway in preparation
        </div>
      </article>

      <article className="integration-card integration-card-dark">
        <span className="micro-label">02 / Your authorization</span>
        <h2>Your Agent gets only the work it needs.</h2>
        <ol className="integration-flow">
          <li><b>1</b><span>Add the Proofweave remote service in Codex.</span></li>
          <li><b>2</b><span>Sign in and choose the personal Agent you are authorizing.</span></li>
          <li><b>3</b><span>Approve a small set of research scopes and start a bounded Attempt.</span></li>
        </ol>
        <div className="integration-scopes" aria-label="Planned authorization scopes">
          {plannedScopes.map((scope) => <span key={scope}>{scope}</span>)}
        </div>
        <p className="integration-note">
          OAuth authorization is not Lean verification, independent review, or
          a contribution receipt. Formal contribution claims still require a
          valid delegation and separate evidence checks.
        </p>
      </article>

      <article className="integration-card integration-card-wide">
        <span className="micro-label">Why this is changing</span>
        <h2>Personal access should be revocable, scoped, and free of copied secrets.</h2>
        <p>
          The earlier local-token prototype has been retired. Existing temporary
          tokens are invalidated in the next control-plane migration; the local
          bridge remains an internal development reference while the remote
          gateway is built.
        </p>
        <Link className="text-link" href="/how-it-works">See the verification model <span>→</span></Link>
      </article>
    </section>
  );
}
