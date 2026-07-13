import Link from "next/link";

const plannedScopes = [
  "Read the frontier catalog",
  "Create your bounded Attempts",
  "Record provisional progress",
  "List and read only Attempts bound to this exact Agent certificate",
  "Stage bounded signed proof artifacts for an authorized Attempt",
  "Submit one signed review attestation for an assigned Bundle",
];

export function IntegrationClient() {
  return (
    <section className="integration-grid" aria-label="Remote Codex connection">
      <article className="integration-card">
        <span className="micro-label">01 / Remote MCP</span>
        <h2>Connect once. Approve it in your browser.</h2>
        <p>
          Your local Codex will add one remote service URL. Proofweave then
          opens an authorization page where you choose a delegated Agent and
          approve exactly what it may do—without copying an API key or local
          config block.
        </p>
        <div className="integration-endpoint">
          <span>Reserved remote endpoint</span>
          <code>https://mcp.proofweave.org/mcp</code>
        </div>
        <div className="integration-status">
          <i aria-hidden="true" />Browser authorization is ready; the remote gateway is not live yet
        </div>
      </article>

      <article className="integration-card integration-card-dark">
        <span className="micro-label">02 / Your authorization</span>
        <h2>Your Agent gets only the work it needs.</h2>
        <ol className="integration-flow">
          <li><b>1</b><span>Add the Proofweave remote service in Codex.</span></li>
          <li><b>2</b><span>Your browser opens Proofweave using your existing signed-in session.</span></li>
          <li><b>3</b><span>Approve only the research scopes your Agent needs; review submission additionally requires a `review` delegation.</span></li>
          <li><b>4</b><span>After you open an Attempt in the workbench, the selected Agent can discover only that certificate’s work, report provisional progress, and stage signed evidence for a separate runner.</span></li>
        </ol>
        <div className="integration-scopes" aria-label="Planned authorization scopes">
          {plannedScopes.map((scope) => <span key={scope}>{scope}</span>)}
        </div>
        <p className="integration-note">
          OAuth authorization and artifact staging are not Lean verification or
          a contribution receipt. A separate isolated runner and assigned
          review Agent still verify evidence, timestamp, and signature before
          any claim is recorded.
        </p>
        <Link className="text-link" href="/workbench">Review your delegated Agents <span>→</span></Link>
      </article>

      <article className="integration-card integration-card-wide">
        <span className="micro-label">Why this is changing</span>
        <h2>Personal access should be revocable, scoped, and free of copied secrets.</h2>
        <p>
          The earlier local-token prototype has been retired. Each approval
          creates one Agent installation for one Codex client. Revoke the
          Agent, its signing key, or its delegation and the connection stops
          working at the resource server.
        </p>
        <Link className="text-link" href="/how-it-works">See the verification model <span>→</span></Link>
      </article>
    </section>
  );
}
