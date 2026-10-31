"use client";

import { Field, Button, EmptyState, FieldList, Select } from "@/app/components/ui";

import Link from "next/link";
import { type McpAttempt } from "@/packages/domain/mcp";
import { PersonalWorkspaceNavigation } from "../PersonalWorkspaceNavigation";
import { useI18n } from "@/app/i18n/client";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";

export type WorkspaceMode =
  | "signed-out"
  | "unavailable"
  | "connect-agent"
  | "choose-research"
  | "active-research"
  | "evidence-review";

const modeKeys: Record<WorkspaceMode, TranslationKey> = {
  "signed-out": "workspaceShell.mode.signed-out",
  unavailable: "workspaceShell.mode.unavailable",
  "connect-agent": "workspaceShell.mode.connect-agent",
  "choose-research": "workspaceShell.mode.choose-research",
  "active-research": "workspaceShell.mode.active-research",
  "evidence-review": "workspaceShell.mode.evidence-review",
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
  if (attempt && (!isLiveAttempt(attempt) || attempt.events.some((event) => event.type === "bundle_staged"))) return "evidence-review";
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
  const { t, locale } = useI18n();
  const activeAttempts = attempts.filter(isLiveAttempt);
  const historicalAttempts = attempts.filter((attempt) => !isLiveAttempt(attempt));
  return <header className="workspace-topbar">
    <div className="workspace-topbar-title">
      <span className="micro-label">{t("workspaceShell.personalLabel")}</span>
      <strong>{t(modeKeys[mode])}</strong>
    </div>
    <label className="workspace-attempt-switcher">
      <span>{t("workspaceShell.currentAttempt")}</span>
      <Select
        aria-label={t("workspaceShell.currentAttemptAria")}
        value={selectedAttemptId ?? ""}
        onChange={(event) => onSelectAttempt(event.target.value)}
        disabled={attempts.length === 0}
      >
        {attempts.length === 0 ? <option value="">{t("workspaceShell.noAttempt")}</option> : <>
          {activeAttempts.length > 0 && <optgroup label={t("workspaceShell.activeGroup")}>{activeAttempts.map((attempt) => <option value={attempt.id} key={attempt.id}>{attempt.problemTitle} · {attempt.delegationScope ?? "research"}</option>)}</optgroup>}
          {historicalAttempts.length > 0 && <optgroup label={t("workspaceShell.historyGroup")}>{historicalAttempts.map((attempt) => <option value={attempt.id} key={attempt.id}>{attempt.problemTitle} · {attemptStatusLabel(attempt.status, t)}</option>)}</optgroup>}
        </>}
      </Select>
    </label>
    <div className="workspace-topbar-status">
      <span className={isAgentConnected ? "workspace-agent-state is-connected" : "workspace-agent-state"}><i aria-hidden="true" />{isAgentConnected ? t("workspaceShell.agentApproval", { agent: agentLabel ?? "Agent" }) : t("workspaceShell.noAgent")}</span>
      <Button type="button" className="workspace-sync-button" onClick={onRefresh} disabled={isRefreshing || !canRefresh}>
        {isRefreshing ? t("workspaceShell.syncing") : t("workspaceShell.refresh")}
      </Button>
      <small>{canRefresh ? refreshedAt ? t("workspaceShell.autoSync", { time: formatTimestamp(refreshedAt, locale) }) : t("workspaceShell.autoSyncCurrent") : t("workspaceShell.session")}</small>
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
  const { t, locale } = useI18n();
  const activeAttempts = attempts.filter(isLiveAttempt);
  const historicalAttempts = attempts.filter((attempt) => !isLiveAttempt(attempt));
  const visibleAttempts = view === "active" ? activeAttempts : historicalAttempts;

  return <aside className="workspace-sidebar" aria-label={t("workspaceShell.navAria")}>
    <section>
      <div className="workspace-sidebar-heading"><span>{t("workspaceShell.research")}</span><b>{activeAttempts.length}</b></div>
      <div className="workspace-attempt-filters" role="tablist" aria-label={t("workspaceShell.filterAria")}>
        <Button type="button" role="tab" aria-selected={view === "active"} className={view === "active" ? "is-selected" : ""} onClick={() => onViewChange("active")}>{t("workspaceShell.active")} <span>{activeAttempts.length}</span></Button>
        <Button type="button" role="tab" aria-selected={view === "history"} className={view === "history" ? "is-selected" : ""} onClick={() => onViewChange("history")}>{t("workspaceShell.history")} <span>{historicalAttempts.length}</span></Button>
      </div>
      {visibleAttempts.length === 0
        ? <EmptyState as="div" className="workspace-sidebar-empty"><p>{view === "active" ? t("workspaceShell.emptyActive") : t("workspaceShell.emptyHistory")}</p>{view === "active" && <Link href="/explore">{t("workspaceShell.exploreProblems")} <span>→</span></Link>}</EmptyState>
        : <ol className="workspace-attempt-list">{visibleAttempts.map((attempt) => <li key={attempt.id}>
          <Button type="button" className={attempt.id === selectedAttemptId ? "is-selected" : ""} onClick={() => onSelectAttempt(attempt.id)} aria-pressed={attempt.id === selectedAttemptId}>
            <span>{attemptStatusLabel(attempt.status, t)}</span>
            <strong>{attempt.problemTitle}</strong>
            <small>{attempt.delegationScope ?? "research"} · {formatTimestamp(attempt.updatedAt, locale)}</small>
          </Button>
        </li>)}</ol>}
      <Link className="workspace-choose-link" href="/explore">{t("workspace.chooseResearch")} <span>→</span></Link>
    </section>
    <PersonalWorkspaceNavigation active="workbench" activeAttemptCount={attempts.filter(isLiveAttempt).length} activeReviewCount={reviewCount} evidenceCount={evidenceCount} />
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
  const { t } = useI18n();
  return <section className="workspace-record-links" aria-labelledby="workspace-record-links-title">
    <div className="workspace-rail-heading"><span className="micro-label">{t("workspaceShell.recordedWork")}</span><strong id="workspace-record-links-title">{t("workspaceShell.records")}</strong></div>
    <FieldList>
      <Field label={t("workspaceShell.agentEvents")}>{eventCount}</Field>
      <Field label={t("workspaceShell.runnerRecords")}>{runCount}</Field>
      <Field label={t("workspaceShell.stagedEvidence")}>{contributionCount}</Field>
    </FieldList>
    <div className="workspace-record-actions">
      <Link href="/evidence">{t("workspaceShell.inspectEvidence")} <span>→</span></Link>
      <Link href="/reviews">{t("workspaceShell.openQueue")} <span>→</span></Link>
    </div>
  </section>;
}

function formatTimestamp(value: string, locale: Locale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function attemptStatusLabel(status: McpAttempt["status"], t: Translator): string {
  if (status === "active") return t("workspaceShell.status.active");
  if (status === "paused") return t("workspaceShell.status.paused");
  if (status === "submitted") return t("workspaceShell.status.submitted");
  if (status === "completed") return t("workspaceShell.status.completed");
  return t("workspaceShell.status.abandoned");
}

function isLiveAttempt(attempt: McpAttempt): boolean {
  return attempt.status === "active" || attempt.status === "paused";
}
