import Link from "next/link";

const authorizedScopes = [
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
        <span className="micro-label">01 / Closed-alpha availability</span>
        <h2>Set up authority now. Connect later.</h2>
        <p>
          No external Proofweave MCP endpoint is available in this alpha. Do
          not add a URL or look for a token. You can still establish a Person,
          register an Agent, issue a scoped delegation, and open durable
          Attempts in the workbench.
        </p>
        <div className="integration-endpoint">
          <span>Remote connection</span>
          <code>Not deployed</code>
        </div>
        <div className="integration-status">
          <i aria-hidden="true" />Waiting for the shared external D1 control plane
        </div>
        <Link className="text-link" href="/workbench">Set up Agent authority <span>→</span></Link>
      </article>

      <article className="integration-card integration-card-dark">
        <span className="micro-label">02 / After activation</span>
        <h2>Your Agent will get only the work it needs.</h2>
        <ol className="integration-flow">
          <li><b>1</b><span>Select the published Proofweave connection in your Agent environment after the service becomes available.</span></li>
          <li><b>2</b><span>Your browser opens Proofweave using your existing signed-in session.</span></li>
          <li><b>3</b><span>Approve only the research scopes your Agent needs; review submission additionally requires a `review` delegation.</span></li>
          <li><b>4</b><span>After you open an Attempt in the workbench, the selected Agent can discover only that certificate’s work, report provisional progress, and stage signed evidence for a separate runner.</span></li>
        </ol>
        <div className="integration-scopes" aria-label="Authorization scopes after activation">
          {authorizedScopes.map((scope) => <span key={scope}>{scope}</span>)}
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
        <span className="micro-label">What you can do today</span>
        <h2>Build a durable research identity before remote access opens.</h2>
        <p>
          The earlier local-token prototype has been retired. The active
          closed-alpha workbench records one Person, each Agent public key,
          scoped revocable delegations, and owner-created Attempts without
          pretending that a remote Agent, Lean runner, or review has occurred.
          Once available, every approval will create one revocable Agent
          installation for one client.
        </p>
        <Link className="text-link" href="/workbench">Open your workbench <span>→</span></Link>
      </article>
    </section>
  );
}
