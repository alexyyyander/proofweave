"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { DelegationProfile } from "@/db/repositories/delegation";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt, McpRunSummary } from "@/packages/domain/mcp";
import {
  controlPlaneMaintenanceCopy,
  loadControlPlaneWriteAvailability,
  type ControlPlaneWriteAvailability,
} from "../lib/control-plane-write-capability";
import { activeAttemptDelegation, activeLocalCodexInstallation } from "../lib/local-agent-journey";
import { ResearchLauncher } from "./ResearchLauncher";
import { AttemptStatusBadge, deriveAttemptPresentation, type AttemptBucket } from "./attempt-presentation";

const sections: Array<{ bucket: AttemptBucket; title: string; description: string }> = [
  { bucket: "needs-attention", title: "Needs attention", description: "A decision, reconnection, or corrected Run is needed." },
  { bucket: "active", title: "Active research", description: "Your Agent can continue these bounded research tasks." },
  { bucket: "waiting", title: "Waiting", description: "Evidence is moving through Lean execution or independent review." },
  { bucket: "history", title: "History", description: "Closed and submitted work remains inspectable." },
];

export function MyWorkOverview({
  profile,
  initialAttempts,
  runs,
  reviewCount,
  evidenceCount,
  provisionalContributionCount,
  catalogTargets,
  initialTargetSlug,
  initialParentNodeId,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  initialAttempts: readonly McpAttempt[];
  runs: readonly McpRunSummary[];
  reviewCount: number | null;
  evidenceCount: number | null;
  provisionalContributionCount: number;
  catalogTargets: readonly CatalogProblem[];
  initialTargetSlug: string | null;
  initialParentNodeId: string | null;
  storageAvailable: boolean;
}) {
  const router = useRouter();
  const [attempts, setAttempts] = useState<readonly McpAttempt[]>(initialAttempts);
  const [showLauncher, setShowLauncher] = useState(Boolean(initialTargetSlug));
  const [view, setView] = useState<AttemptBucket | "all">("all");
  const [writeAvailability, setWriteAvailability] = useState<ControlPlaneWriteAvailability>(
    storageAvailable ? "available" : "unavailable",
  );
  const records = useMemo(() => attempts.map((attempt) => {
    const delegation = activeAttemptDelegation(profile, attempt);
    const agentConnected = Boolean(activeLocalCodexInstallation(profile, delegation));
    return { attempt, presentation: deriveAttemptPresentation({ attempt, runs, agentConnected }) };
  }), [attempts, profile, runs]);
  const grouped = useMemo(() => new Map(sections.map(({ bucket }) => [bucket, records.filter((record) => record.presentation.bucket === bucket)])), [records]);
  const activeCount = attempts.filter((attempt) => attempt.status === "active" || attempt.status === "paused").length;
  const attentionCount = grouped.get("needs-attention")?.length ?? 0;
  const localConnection = activeLocalCodexInstallation(profile);
  const maintenance = controlPlaneMaintenanceCopy(writeAvailability);
  const nextRecord = grouped.get("needs-attention")?.[0] ?? grouped.get("active")?.[0] ?? grouped.get("waiting")?.[0] ?? null;
  const visibleRecordCount = view === "all" ? records.length : grouped.get(view)?.length ?? 0;
  const selectedView = view === "all" ? null : sections.find((section) => section.bucket === view);

  useEffect(() => {
    const controller = new AbortController();
    void loadControlPlaneWriteAvailability(controller.signal).then((availability) => {
      if (availability !== "checking") setWriteAvailability(availability);
    });
    return () => controller.abort();
  }, []);

  const onAttemptReady = (attempt: McpAttempt) => {
    setAttempts((current) => [attempt, ...current.filter((candidate) => candidate.id !== attempt.id)]);
    router.push(`/workbench/attempts/${encodeURIComponent(attempt.id)}`);
  };

  return <>
    <section className="my-work-hero" aria-labelledby="my-work-title">
      <div>
        <p className="eyebrow">Personal research workspace</p>
        <h1 id="my-work-title">My work</h1>
        <p>See what needs you, what your Agent can continue, and which contributions are waiting for verification.</p>
      </div>
      <div className="my-work-actions">
        {writeAvailability === "available"
          ? <button className="button button-primary" type="button" onClick={() => setShowLauncher((current) => !current)}>{showLauncher ? "Hide new task" : "Start new research"}</button>
          : <span className="button button-secondary" aria-disabled="true">{writeAvailability === "checking" ? "Checking research access…" : "Research updates paused"}</span>}
        <Link className="button button-secondary" href="/explore">Browse opportunities</Link>
      </div>
    </section>

    {writeAvailability !== "available" && <section className="my-work-empty" aria-live="polite">
      <p className="eyebrow">Read-only workspace</p>
      <h2>{maintenance.title}</h2>
      <p>{maintenance.detail}</p>
    </section>}

    <section className="my-work-summary" aria-label="Workspace summary">
      <div><span>Active</span><strong>{activeCount}</strong><small>research tasks</small></div>
      <div className={attentionCount > 0 ? "has-attention" : ""}><span>Needs attention</span><strong>{attentionCount}</strong><small>owner actions</small></div>
      <Link href="/reviews#my-review-work"><span>Reviews</span><strong>{reviewCount ?? "—"}</strong><small>assigned to you</small></Link>
      <Link href="/evidence"><span>Evidence</span><strong>{evidenceCount ?? "—"}</strong><small>controlled records</small></Link>
      <Link href="/profile"><span>Contributions</span><strong>{provisionalContributionCount}</strong><small>provisional records</small></Link>
    </section>

    <div className={localConnection ? "my-work-agent is-connected" : "my-work-agent"}>
      <span><i aria-hidden="true" />{localConnection ? `${localConnection.agentLabel} has an active website approval` : "No active research Agent approval"}</span>
      <Link href={localConnection ? "/settings" : "/integrations#codex-beta"}>{localConnection ? "Inspect approval" : "Connect Agent"} <span aria-hidden="true">→</span></Link>
    </div>

    {showLauncher && <section className="my-work-launcher" aria-label="Start new research">
      <ResearchLauncher profile={profile} attempts={attempts} catalogTargets={catalogTargets} initialTargetSlug={initialTargetSlug} initialParentNodeId={initialParentNodeId} onAttemptReady={onAttemptReady} isAuthenticated signInPath="/sign-in?returnTo=%2Fworkbench" storageAvailable={storageAvailable} writeAvailability={writeAvailability} />
    </section>}

    {nextRecord && <section className="my-work-next-action" aria-labelledby="my-work-next-action-title">
      <div><p className="eyebrow">Recommended next action</p><h2 id="my-work-next-action-title">{nextRecord.presentation.nextAction}</h2><p>{nextRecord.presentation.detail}</p></div>
      <div className="my-work-next-action-meta"><span>{nextRecord.attempt.problemTitle}</span><Link className="button button-primary" href={`/workbench/attempts/${encodeURIComponent(nextRecord.attempt.id)}`}>Open task <span aria-hidden="true">→</span></Link></div>
    </section>}

    {!storageAvailable ? <section className="my-work-empty"><p className="eyebrow">Workspace unavailable</p><h2>Your durable research records cannot be loaded.</h2><p>Proofweave does not substitute preview tasks when the accountable store is unavailable.</p></section>
      : attempts.length === 0 ? <section className="my-work-empty"><p className="eyebrow">No Attempts yet</p><h2>Choose one exact target for your Agent.</h2><p>Your first Attempt creates a bounded workspace. It does not claim that work has begun or that a result is verified.</p><div className="button-row"><Link className="button button-primary" href="/explore">Explore mathematics <span>→</span></Link><button className="button button-secondary" type="button" onClick={() => setShowLauncher(true)}>Open task launcher</button></div></section>
        : <>
          <section className="my-work-command" aria-label="Workspace task filters">
            <div><span className="micro-label">Task queue</span><strong>Focus the worklist</strong><small>Filter by the action required from you now.</small></div>
            <div className="my-work-view-tabs" role="tablist" aria-label="Filter workspace tasks">
              {[{ bucket: "all" as const, label: "All" }, ...sections.map((section) => ({ bucket: section.bucket, label: section.title }))].map((item) => <button key={item.bucket} className={view === item.bucket ? "is-active" : ""} onClick={() => setView(item.bucket)} role="tab" aria-selected={view === item.bucket} type="button"><span>{item.label}</span><strong>{item.bucket === "all" ? records.length : grouped.get(item.bucket)?.length ?? 0}</strong></button>)}
            </div>
          </section>
          {visibleRecordCount === 0 ? <section className="my-work-filter-empty" aria-live="polite">
            <span className="micro-label">Queue clear</span>
            <h2>{selectedView?.title ?? "No recorded tasks"}</h2>
            <p>{selectedView?.bucket === "needs-attention" ? "There are no owner decisions waiting for you." : "There are no tasks in this queue yet."}</p>
            <button className="button button-secondary" type="button" onClick={() => setView("all")}>View all tasks <span aria-hidden="true">→</span></button>
          </section> : <div className="my-work-sections">
          {sections.filter((section) => view === "all" || view === section.bucket).map((section) => {
            const sectionRecords = grouped.get(section.bucket) ?? [];
            if (sectionRecords.length === 0) return null;
            return <section className={`my-work-section is-${section.bucket}`} key={section.bucket} aria-labelledby={`my-work-${section.bucket}`}>
              <header><div><h2 id={`my-work-${section.bucket}`}>{section.title}</h2><p>{section.description}</p></div><span>{sectionRecords.length}</span></header>
              <div className="my-work-card-list">
                {sectionRecords.map(({ attempt, presentation }) => <article className="my-work-card" key={attempt.id}>
                  <div className="my-work-card-top"><AttemptStatusBadge presentation={presentation} /><small>Updated {formatTimestamp(attempt.updatedAt)}</small></div>
                  <h3>{attempt.problemTitle}</h3>
                  <p className="my-work-card-meta">{attempt.agentLabel} · {attempt.delegationScope ?? "research"}</p>
                  <dl>
                    <div><dt>Latest</dt><dd>{attempt.events.at(-1)?.message ?? "No recorded event."}</dd></div>
                    <div><dt>Next</dt><dd><strong>{presentation.nextAction}</strong><span>{presentation.detail}</span></dd></div>
                  </dl>
                  {typeof attempt.lastProgressPercent === "number" && <div className="my-work-progress" aria-label={`${attempt.lastProgressPercent}% agent-reported progress`}><span style={{ width: `${Math.max(0, Math.min(100, attempt.lastProgressPercent))}%` }} /></div>}
                  <div className="my-work-card-actions"><Link className="button button-primary" href={`/workbench/attempts/${encodeURIComponent(attempt.id)}`}>{attempt.status === "active" ? "Continue task" : attempt.status === "paused" ? "Resume task" : "View history"} <span>→</span></Link><Link className="text-link" href={`/explore/${attempt.problemSlug}`}>Inspect target</Link></div>
                </article>)}
              </div>
            </section>;
          })}
          </div>}
        </>}
  </>;
}
function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : new Intl.DateTimeFormat("en-US", { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
