"use client";

import { CardTitle, SectionTitle, Field, PageIntro, ActionLink, Button, EmptyState, FieldList, Surface } from "@/app/components/ui";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type DelegationProfile } from "@/db/repositories/delegation";
import { type WorkbenchCatalogTarget } from "../lib/runner-availability";
import { type McpAttempt, type McpRunSummary } from "@/packages/domain/mcp";
import { controlPlaneAvailabilityLabel, controlPlaneMaintenanceCopy, loadControlPlaneWriteAvailability, type ControlPlaneWriteAvailability } from "../lib/control-plane-write-capability";
import { activeAttemptDelegation, activeLocalCodexInstallation } from "../lib/local-agent-journey";
import type { ResearchEligibility } from "../lib/research-eligibility";
import { ResearchWindowNotice } from "./ResearchWindowNotice";
import { ResearchLauncher } from "./ResearchLauncher";
import { AttemptStatusBadge, deriveAttemptPresentation, type AttemptBucket } from "./attempt-presentation";
import { useI18n } from "@/app/i18n/client";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey } from "@/app/i18n/translate";

const sections: Array<{ bucket: AttemptBucket; titleKey: TranslationKey; descriptionKey: TranslationKey }> = [
  { bucket: "needs-attention", titleKey: "myWork.section.needsAttention.title", descriptionKey: "myWork.section.needsAttention.description" },
  { bucket: "active", titleKey: "myWork.section.active.title", descriptionKey: "myWork.section.active.description" },
  { bucket: "waiting", titleKey: "myWork.section.waiting.title", descriptionKey: "myWork.section.waiting.description" },
  { bucket: "history", titleKey: "myWork.section.history.title", descriptionKey: "myWork.section.history.description" },
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
  eligibility,
}: {
  profile: DelegationProfile | null;
  initialAttempts: readonly McpAttempt[];
  runs: readonly McpRunSummary[];
  reviewCount: number | null;
  evidenceCount: number | null;
  provisionalContributionCount: number;
  catalogTargets: readonly WorkbenchCatalogTarget[];
  initialTargetSlug: string | null;
  initialParentNodeId: string | null;
  storageAvailable: boolean;
  eligibility?: ResearchEligibility | null;
}) {
  const { t, locale } = useI18n();
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
    return { attempt, presentation: deriveAttemptPresentation({ attempt, runs, agentConnected, t }) };
  }), [attempts, profile, runs, t]);
  const grouped = useMemo(() => new Map(sections.map(({ bucket }) => [bucket, records.filter((record) => record.presentation.bucket === bucket)])), [records]);
  const activeCount = attempts.filter((attempt) => attempt.status === "active" || attempt.status === "paused").length;
  const attentionCount = grouped.get("needs-attention")?.length ?? 0;
  const localConnection = activeLocalCodexInstallation(profile);
  const maintenance = controlPlaneMaintenanceCopy(writeAvailability, t);
  const creationBlockedByWindow = eligibility ? !eligibility.canCreateAttempt : false;
  const connectedAgentAllowed = !eligibility || !localConnection
    ? true
    : eligibility.agentsAllowed.items.some((agent) => agent.id === localConnection.agentId && agent.allowed);
  const creationBlocked = creationBlockedByWindow || (Boolean(eligibility && localConnection) && !connectedAgentAllowed);
  const creationBlockedLabel = eligibility && localConnection && !connectedAgentAllowed
    ? t("myWork.blocked.agentNotInWindow")
    : eligibility?.canWrite ? t("myWork.blocked.newAttemptsClosed") : t("myWork.blocked.windowClosed");
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
    <PageIntro label={t("myWork.label")} title={t("myWork.title")} titleId="my-work-title"
      description={t("myWork.description")}
      actions={<>
        {writeAvailability === "available"
          ? <Button variant="primary" type="button" disabled={creationBlocked} onClick={() => setShowLauncher((current) => !current)}>{creationBlocked ? creationBlockedLabel : showLauncher ? t("myWork.hide") : t("myWork.start")}</Button>
          : <Button variant="secondary" disabled>{controlPlaneAvailabilityLabel(writeAvailability, t)}{writeAvailability === "checking" ? "…" : ""}</Button>}
        <ActionLink variant="secondary" href="/explore">{t("myWork.browse")}</ActionLink>
      </>} />

    {eligibility && <div className="research-window-notice-wrap" style={{ marginBottom: 20 }}><ResearchWindowNotice eligibility={eligibility} /></div>}

    {writeAvailability !== "available" && <EmptyState as="section" className="my-work-empty" aria-live="polite">
      <p className="eyebrow">{t("myWork.readOnly.eyebrow")}</p>
      <SectionTitle>{maintenance.title}</SectionTitle>
      <p>{maintenance.detail}</p>
    </EmptyState>}

    <section className="my-work-summary" aria-label={t("myWork.summaryAria")}>
      <div><span>{t("myWork.summary.active")}</span><strong>{activeCount}</strong><small>{t("myWork.summary.activeNote")}</small></div>
      <div className={attentionCount > 0 ? "has-attention" : ""}><span>{t("myWork.summary.attention")}</span><strong>{attentionCount}</strong><small>{t("myWork.summary.attentionNote")}</small></div>
      <Link href="/reviews#my-review-work"><span>{t("myWork.summary.reviews")}</span><strong>{reviewCount ?? "—"}</strong><small>{t("myWork.summary.reviewsNote")}</small></Link>
      <Link href="/evidence"><span>{t("myWork.summary.evidence")}</span><strong>{evidenceCount ?? "—"}</strong><small>{t("myWork.summary.evidenceNote")}</small></Link>
      <Link href="/profile"><span>{t("myWork.summary.contributions")}</span><strong>{provisionalContributionCount}</strong><small>{t("myWork.summary.contributionsNote")}</small></Link>
    </section>

    <div className={localConnection ? "my-work-agent is-connected" : "my-work-agent"}>
      <span><i aria-hidden="true" />{localConnection ? t("myWork.agent.active", { agent: localConnection.agentLabel }) : t("myWork.agent.none")}</span>
      <Link href={localConnection ? "/settings" : "/integrations#codex-beta"}>{localConnection ? t("myWork.agent.inspect") : t("myWork.agent.connect")} <span aria-hidden="true">→</span></Link>
    </div>

    {showLauncher && <section className="my-work-launcher" aria-label={t("myWork.launcherAria")}>
      <ResearchLauncher profile={profile} attempts={attempts} catalogTargets={catalogTargets} initialTargetSlug={initialTargetSlug} initialParentNodeId={initialParentNodeId} onAttemptReady={onAttemptReady} isAuthenticated signInPath="/sign-in?return_to=%2Fworkbench" storageAvailable={storageAvailable} writeAvailability={writeAvailability} eligibility={eligibility} />
    </section>}

    {nextRecord && <section className="my-work-next-action" aria-labelledby="my-work-next-action-title">
      <div><p className="eyebrow">{t("myWork.next.eyebrow")}</p><SectionTitle id="my-work-next-action-title">{nextRecord.presentation.nextAction}</SectionTitle><p>{nextRecord.presentation.detail}</p></div>
      <div className="my-work-next-action-meta"><span>{nextRecord.attempt.problemTitle}</span><ActionLink className="button button-primary" href={`/workbench/attempts/${encodeURIComponent(nextRecord.attempt.id)}`}>{t("myWork.next.open")} <span aria-hidden="true">→</span></ActionLink></div>
    </section>}

    {!storageAvailable ? <EmptyState as="section" className="my-work-empty"><p className="eyebrow">{t("myWork.unavailable.eyebrow")}</p><SectionTitle>{t("myWork.unavailable.title")}</SectionTitle><p>{t("myWork.unavailable.body")}</p></EmptyState>
      : attempts.length === 0 ? <EmptyState as="section" className="my-work-empty"><p className="eyebrow">{t("myWork.empty.eyebrow")}</p><SectionTitle>{t("myWork.empty.title")}</SectionTitle><p>{t("myWork.empty.body")}</p><div className="button-row"><ActionLink className="button button-primary" href="/explore">{t("myWork.empty.explore")} <span>→</span></ActionLink><Button className="button button-secondary" type="button" disabled={creationBlocked} onClick={() => setShowLauncher(true)}>{creationBlocked ? creationBlockedLabel : t("myWork.empty.launcher")}</Button></div></EmptyState>
        : <>
          <section className="my-work-command" aria-label={t("myWork.commandAria")}>
            <div><span className="micro-label">{t("myWork.taskQueue")}</span><strong>{t("myWork.focusWorklist")}</strong><small>{t("myWork.filterHint")}</small></div>
            <div className="my-work-view-tabs" role="tablist" aria-label={t("myWork.tabsAria")}>
              {[{ bucket: "all" as const, label: t("myWork.all") }, ...sections.map((section) => ({ bucket: section.bucket, label: t(section.titleKey) }))].map((item) => <Button key={item.bucket} className={view === item.bucket ? "is-active" : ""} onClick={() => setView(item.bucket)} role="tab" aria-selected={view === item.bucket} type="button"><span>{item.label}</span><strong>{item.bucket === "all" ? records.length : grouped.get(item.bucket)?.length ?? 0}</strong></Button>)}
            </div>
          </section>
          {visibleRecordCount === 0 ? <EmptyState as="section" className="my-work-filter-empty" aria-live="polite">
            <span className="micro-label">{t("myWork.filterEmpty.label")}</span>
            <SectionTitle>{selectedView ? t(selectedView.titleKey) : t("myWork.filterEmpty.noRecorded")}</SectionTitle>
            <p>{selectedView?.bucket === "needs-attention" ? t("myWork.filterEmpty.noAttention") : t("myWork.filterEmpty.noTasks")}</p>
            <Button className="button button-secondary" type="button" onClick={() => setView("all")}>{t("myWork.filterEmpty.viewAll")} <span aria-hidden="true">→</span></Button>
          </EmptyState> : <div className="my-work-sections">
          {sections.filter((section) => view === "all" || view === section.bucket).map((section) => {
            const sectionRecords = grouped.get(section.bucket) ?? [];
            if (sectionRecords.length === 0) return null;
            return <section className={`my-work-section is-${section.bucket}`} key={section.bucket} aria-labelledby={`my-work-${section.bucket}`}>
              <header><div><SectionTitle id={`my-work-${section.bucket}`}>{t(section.titleKey)}</SectionTitle><p>{t(section.descriptionKey)}</p></div><span>{sectionRecords.length}</span></header>
              <div className="my-work-card-list">
                {sectionRecords.map(({ attempt, presentation }) => <Surface as="article" className="my-work-card" key={attempt.id}>
                  <div className="my-work-card-top"><AttemptStatusBadge presentation={presentation} /><small>{t("myWork.card.updated", { time: formatTimestamp(attempt.updatedAt, locale) })}</small></div>
                  <CardTitle>{attempt.problemTitle}</CardTitle>
                  <p className="my-work-card-meta">{attempt.agentLabel} · {attempt.delegationScope ?? "research"}</p>
                  <FieldList>
                    <Field label={t("myWork.card.latest")}>{attempt.events.at(-1)?.message ?? t("myWork.card.noEvent")}</Field>
                    <Field label={t("myWork.card.next")}><strong>{presentation.nextAction}</strong><span>{presentation.detail}</span></Field>
                  </FieldList>
                  {typeof attempt.lastProgressPercent === "number" && <div className="my-work-progress" aria-label={t("myWork.card.progressAria", { percent: attempt.lastProgressPercent })}><span style={{ width: `${Math.max(0, Math.min(100, attempt.lastProgressPercent))}%` }} /></div>}
                  <div className="my-work-card-actions"><ActionLink className="button button-primary" href={`/workbench/attempts/${encodeURIComponent(attempt.id)}`}>{attempt.status === "active" ? t("myWork.card.continue") : attempt.status === "paused" ? t("myWork.card.resume") : t("myWork.card.history")} <span>→</span></ActionLink><Link className="text-link" href={`/explore/${attempt.problemSlug}`}>{t("myWork.card.inspectTarget")}</Link></div>
                </Surface>)}
              </div>
            </section>;
          })}
          </div>}
        </>}
  </>;
}
function formatTimestamp(value: string, locale: Locale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
