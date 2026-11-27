import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { getCurrentUser } from "./auth";
import { loadPersonalWorkspaceSummary, type PersonalWorkspaceSummary } from "./lib/personal-workspace-summary";
import { PersonalWorkspaceNavigation, type PersonalWorkspacePage } from "./PersonalWorkspaceNavigation";
import { getI18n } from "./i18n/server";

export async function PersonalWorkspaceFrame({ active, children, summary: suppliedSummary }: { active: PersonalWorkspacePage; children: ReactNode; summary?: PersonalWorkspaceSummary | Promise<PersonalWorkspaceSummary | null> }) {
  const { t } = await getI18n();
  const user = await getCurrentUser();
  if (!user) return <>{children}</>;
  const summary = suppliedSummary ?? await loadPersonalWorkspaceSummary(user);
  return <div className="personal-workspace-frame">
    <Suspense fallback={null}><WorkspacePart data={summary}>{(summary, attemptHref) =>
      <aside className="personal-workspace-frame-sidebar" aria-label={t("workspace.contextAria")}>
      <section className="personal-workspace-current">
        <span className="micro-label">{t("workspace.currentAttempt")}</span>
        {summary.currentAttempt ? <>
          <Link prefetch={false} href={attemptHref}>{summary.currentAttempt.problemTitle}</Link>
          <p>{summary.currentAttempt.scope ?? "research"} · {summary.currentAttempt.status}</p>
        </> : <>
          <strong>{t("workspace.noActive")}</strong>
          <Link className="personal-workspace-start" href="/explore">{t("workspace.chooseResearch")} <span>→</span></Link>
        </>}
        <span className={summary.agent.connected ? "personal-agent-state is-connected" : "personal-agent-state"}><i aria-hidden="true" />{summary.agent.connected ? summary.agent.label ?? t("workspace.agentActive") : summary.available ? t("workspace.agentNotRecorded") : t("workspace.statusUnavailable")}</span>
      </section>
      <PersonalWorkspaceNavigation active={active} activeAttemptCount={summary.counts.activeAttempts} activeReviewCount={summary.counts.activeReviews} evidenceCount={summary.counts.evidence} />
    </aside>
    }</WorkspacePart></Suspense>
    <div className="personal-workspace-frame-body">
      <Suspense fallback={null}><WorkspacePart data={summary}>{(summary, attemptHref) =>
        <section className="personal-workspace-summary" aria-label={t("workspace.summaryAria")}>
        <div><span>{t("workspace.activeAttempts")}</span><strong>{countLabel(summary.counts.activeAttempts)}</strong></div>
        <div><span>{t("workspace.pendingReviews")}</span><strong>{countLabel(summary.counts.activeReviews)}</strong></div>
        <div><span>{t("workspace.evidenceRecords")}</span><strong>{countLabel(summary.counts.evidence)}</strong></div>
        <div><span>{t("workspace.stagedEvidence")}</span><strong>{countLabel(summary.counts.provisionalContributions)}</strong></div>
        <Link prefetch={false} href={attemptHref}>{summary.currentAttempt ? t("workspace.returnCurrent") : t("workspace.openWorkspace")} <span>→</span></Link>
      </section>
      }</WorkspacePart></Suspense>
      <div className="personal-workspace-frame-content">{children}</div>
    </div>
  </div>;
}

async function WorkspacePart({ data, children }: {
  data: PersonalWorkspaceSummary | Promise<PersonalWorkspaceSummary | null>;
  children: (summary: PersonalWorkspaceSummary, attemptHref: string) => ReactNode;
}) {
  const summary = await data;
  if (!summary) return null;
  const href = summary.currentAttempt ? `/workbench/attempts/${encodeURIComponent(summary.currentAttempt.id)}` : "/workbench";
  return <>{children(summary, href)}</>;
}

function countLabel(value: number | null): number | "—" {
  return value ?? "—";
}
