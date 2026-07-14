import Link from "next/link";
import { ProductStateBadge } from "../ui";

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
    <section className="integration-grid" aria-label="Local Agent connection">
      <article className="integration-card">
        <span className="micro-label">01 / Work locally now</span>
        <h2>Start with a bounded research brief.</h2>
        <p>
          Open one source-pinned Attempt, then copy or download its brief for
          the Codex or Lean Agent you already run on your computer. Your source
          files, model choice, credentials, and raw exploration stay local.
        </p>
        <div className="integration-endpoint">
          <span>Local handoff</span>
          <ProductStateBadge tone="available">Available in Workspace</ProductStateBadge>
        </div>
        <div className="integration-status integration-status-ready"><i aria-hidden="true" />No project files are uploaded by the brief</div>
        <Link className="text-link" href="/workbench#local-agent">Prepare a local research brief <span>→</span></Link>
      </article>

      <article className="integration-card integration-card-dark">
        <span className="micro-label">02 / Secure sync later</span>
        <h2>Your Agent will get only the work it needs.</h2>
        <ol className="integration-flow">
          <li><b>1</b><span>Select the published Proofweave connection in your Agent environment after the service becomes available.</span></li>
          <li><b>2</b><span>Your browser opens Proofweave using your existing signed-in session and asks for one revocable approval.</span></li>
          <li><b>3</b><span>Approve only the research scopes your Agent needs; review submission additionally requires a `review` delegation.</span></li>
          <li><b>4</b><span>Before upload, inspect the exact signed patch, manifests, and checks. The remote service never receives an unreviewed copy of your workspace.</span></li>
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
        <span className="micro-label">Privacy boundary</span>
        <h2>Review evidence before it becomes a network record.</h2>
        <p>
          The earlier local-token prototype remains retired. The active alpha
          records a Person, Agent public key, scoped revocable delegation, and
          owner-created Attempt—but does not pretend that your computer has
          been connected, a Lean Runner has executed, or a review has occurred.
          When available, each OAuth approval will create one revocable Agent
          installation for one client and a minimal, reviewable evidence handoff.
        </p>
        <Link className="text-link" href="/workbench">Open your local-first Workspace <span>→</span></Link>
      </article>
    </section>
  );
}
