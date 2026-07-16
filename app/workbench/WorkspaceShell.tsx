"use client";

import Link from "next/link";
import type { McpAttempt } from "@/packages/domain/mcp";
import { PersonalWorkspaceNavigation } from "../PersonalWorkspaceNavigation";

export type WorkspaceMode =
  | "signed-out"
  | "unavailable"
  | "connect-agent"
  | "choose-research"
  | "active-research"
  | "evidence-review";

const modeLabels: Record<WorkspaceMode, string> = {
  "signed-out": "Sign in to begin",
  unavailable: "Service unavailable",
  "connect-agent": "Connect your Agent",
  "choose-research": "Choose research",
  "active-research": "Research in progress",
  "evidence-review": "Evidence and review",
};

export function deriveWorkspaceMode({
  isAuthenticated,
  storageAvailable,
  isAgentConnected,
  attempt,
}: {
  isAuthenticated: boolean;
  storageAvailable: boolean;
  isAgentConnected: boolean;
  attempt: McpAttempt | null;
}): WorkspaceMode {
  if (!isAuthenticated) return "signed-out";
  if (!storageAvailable) return "unavailable";
  if (attempt && (attempt.status !== "active" || attempt.events.some((event) => event.type === "bundle_staged"))) return "evidence-review";
  if (attempt) return "active-research";
  if (!isAgentConnected) return "connect-agent";
  return "choose-research";
}

export function WorkspaceTopbar({
  attempts,
  selectedAttemptId,
  onSelectAttempt,
  agentLabel,
  isAgentConnected,
  mode,
  isRefreshing,
  canRefresh,
  refreshedAt,
  onRefresh,
}: {
  attempts: readonly McpAttempt[];
  selectedAttemptId: string | null;
  onSelectAttempt: (attemptId: string) => void;
  agentLabel: string | null;
  isAgentConnected: boolean;
  mode: WorkspaceMode;
  isRefreshing: boolean;
  canRefresh: boolean;
  refreshedAt: string | null;
  onRefresh: () => void;
}) {
  const activeAttempts = attempts.filter((attempt) => attempt.status === "active");
  const historicalAttempts = attempts.filter((attempt) => attempt.status !== "active");
  return <header className="workspace-topbar">
    <div className="workspace-topbar-title">
      <span className="micro-label">Personal workspace</span>
      <h1>{modeLabels[mode]}</h1>
    </div>
    <label className="workspace-attempt-switcher">
      <span>Current Attempt</span>
      <select
        aria-label="Current research Attempt"
        value={selectedAttemptId ?? ""}
        onChange={(event) => onSelectAttempt(event.target.value)}
        disabled={attempts.length === 0}
      >
        {attempts.length === 0 ? <option value="">No Attempt yet</option> : <>
          {activeAttempts.length > 0 && <optgroup label="Active research">{activeAttempts.map((attempt) => <option value={attempt.id} key={attempt.id}>{attempt.problemTitle} · {attempt.delegationScope ?? "research"}</option>)}</optgroup>}
          {historicalAttempts.length > 0 && <optgroup label="History">{historicalAttempts.map((attempt) => <option value={attempt.id} key={attempt.id}>{attempt.problemTitle} · {attemptStatusLabel(attempt.status)}</option>)}</optgroup>}
        </>}
      </select>
    </label>
    <div className="workspace-topbar-status">
      <span className={isAgentConnected ? "workspace-agent-state is-connected" : "workspace-agent-state"}><i aria-hidden="true" />{isAgentConnected ? agentLabel ?? "Agent connected" : "Agent not connected"}</span>
      <button type="button" className="workspace-sync-button" onClick={onRefresh} disabled={isRefreshing || !canRefresh}>
        {isRefreshing ? "Syncing…" : "Refresh records"}
      </button>
      <small>{canRefresh ? `Auto-sync · ${refreshedAt ? `updated ${formatTimestamp(refreshedAt)}` : "current session"}` : "Current session"}</small>
    </div>
  </header>;
}

export function WorkspaceSidebar({
  attempts,
  selectedAttemptId,
  onSelectAttempt,
  view,
  onViewChange,
  reviewCount,
  evidenceCount,
}: {
  attempts: readonly McpAttempt[];
  selectedAttemptId: string | null;
  onSelectAttempt: (attemptId: string) => void;
  view: "active" | "history";
  onViewChange: (view: "active" | "history") => void;
  reviewCount: number | null;
  evidenceCount: number | null;
}) {
  const activeAttempts = attempts.filter((attempt) => attempt.status === "active");
  const historicalAttempts = attempts.filter((attempt) => attempt.status !== "active");
  const visibleAttempts = view === "active" ? activeAttempts : historicalAttempts;

  return <aside className="workspace-sidebar" aria-label="Personal workspace navigation">
    <section>
      <div className="workspace-sidebar-heading"><span>Research</span><b>{activeAttempts.length}</b></div>
      <div className="workspace-attempt-filters" role="tablist" aria-label="Research Attempt state">
        <button type="button" role="tab" aria-selected={view === "active"} className={view === "active" ? "is-selected" : ""} onClick={() => onViewChange("active")}>Active <span>{activeAttempts.length}</span></button>
        <button type="button" role="tab" aria-selected={view === "history"} className={view === "history" ? "is-selected" : ""} onClick={() => onViewChange("history")}>History <span>{historicalAttempts.length}</span></button>
      </div>
      {visibleAttempts.length === 0
        ? <div className="workspace-sidebar-empty"><p>{view === "active" ? "No active research Attempt." : "Completed and closed Attempts will remain here."}</p>{view === "active" && <Link href="/explore">Explore problems <span>→</span></Link>}</div>
        : <ol className="workspace-attempt-list">{visibleAttempts.map((attempt) => <li key={attempt.id}>
          <button type="button" className={attempt.id === selectedAttemptId ? "is-selected" : ""} onClick={() => onSelectAttempt(attempt.id)} aria-pressed={attempt.id === selectedAttemptId}>
            <span>{attemptStatusLabel(attempt.status)}</span>
            <strong>{attempt.problemTitle}</strong>
            <small>{attempt.delegationScope ?? "research"} · {formatTimestamp(attempt.updatedAt)}</small>
          </button>
        </li>)}</ol>}
      <Link className="workspace-choose-link" href="/explore">Choose research <span>→</span></Link>
    </section>
    <PersonalWorkspaceNavigation active="workbench" activeAttemptCount={attempts.filter((attempt) => attempt.status === "active").length} activeReviewCount={reviewCount} evidenceCount={evidenceCount} />
  </aside>;
}

export function WorkspaceRecordLinks({
  eventCount,
  runCount,
  contributionCount,
}: {
  eventCount: number;
  runCount: number;
  contributionCount: number;
}) {
  return <section className="workspace-record-links" aria-labelledby="workspace-record-links-title">
    <div className="workspace-rail-heading"><span className="micro-label">Recorded work</span><strong id="workspace-record-links-title">Research records</strong></div>
    <dl>
      <div><dt>Agent events</dt><dd>{eventCount}</dd></div>
      <div><dt>Runner records</dt><dd>{runCount}</dd></div>
      <div><dt>Staged evidence</dt><dd>{contributionCount}</dd></div>
    </dl>
    <div className="workspace-record-actions">
      <Link href="/evidence">Inspect evidence <span>→</span></Link>
      <Link href="/reviews">Open review queue <span>→</span></Link>
    </div>
  </section>;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function attemptStatusLabel(status: McpAttempt["status"]): string {
  if (status === "active") return "Active";
  if (status === "submitted") return "Submitted";
  return "Closed";
}
