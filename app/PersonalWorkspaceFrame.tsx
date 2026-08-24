import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "./auth";
import { loadPersonalWorkspaceSummary } from "./lib/personal-workspace-summary";
import { PersonalWorkspaceNavigation, type PersonalWorkspacePage } from "./PersonalWorkspaceNavigation";

export async function PersonalWorkspaceFrame({ active, children }: { active: PersonalWorkspacePage; children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) return <>{children}</>;
  const summary = await loadPersonalWorkspaceSummary(user);
  const attemptHref = summary.currentAttempt ? `/workbench/attempts/${encodeURIComponent(summary.currentAttempt.id)}` : "/workbench";

  return <div className="personal-workspace-frame">
    <aside className="personal-workspace-frame-sidebar" aria-label="Personal workspace context">
      <section className="personal-workspace-current">
        <span className="micro-label">Current Attempt</span>
        {summary.currentAttempt ? <>
          <Link href={attemptHref}>{summary.currentAttempt.problemTitle}</Link>
          <p>{summary.currentAttempt.scope ?? "research"} · {summary.currentAttempt.status}</p>
        </> : <>
          <strong>No active research</strong>
          <Link className="personal-workspace-start" href="/explore">Choose research <span>→</span></Link>
        </>}
        <span className={summary.agent.connected ? "personal-agent-state is-connected" : "personal-agent-state"}><i aria-hidden="true" />{summary.agent.connected ? summary.agent.label ?? "Website authorization active" : summary.available ? "Website authorization not recorded" : "Status unavailable"}</span>
      </section>
      <PersonalWorkspaceNavigation active={active} activeAttemptCount={summary.counts.activeAttempts} activeReviewCount={summary.counts.activeReviews} evidenceCount={summary.counts.evidence} />
    </aside>
    <div className="personal-workspace-frame-body">
      <section className="personal-workspace-summary" aria-label="Personal workspace summary">
        <div><span>Active Attempts</span><strong>{countLabel(summary.counts.activeAttempts)}</strong></div>
        <div><span>Pending Reviews</span><strong>{countLabel(summary.counts.activeReviews)}</strong></div>
        <div><span>Evidence Records</span><strong>{countLabel(summary.counts.evidence)}</strong></div>
        <div><span>Staged Evidence</span><strong>{countLabel(summary.counts.provisionalContributions)}</strong></div>
        <Link href={attemptHref}>{summary.currentAttempt ? "Return to current research" : "Open Workspace"} <span>→</span></Link>
      </section>
      <div className="personal-workspace-frame-content">{children}</div>
    </div>
  </div>;
}

function countLabel(value: number | null): number | "—" {
  return value ?? "—";
}
