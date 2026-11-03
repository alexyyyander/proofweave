import { PageTitle, SectionTitle, CardTitle, Field, Badge, ActionLink, Button, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import Link from "next/link";
import { ProductStateBadge } from "../ui";
import { type DelegationProfile } from "@/db/repositories/delegation";
import type { Locale } from "@/app/i18n/config";
import type { Translator } from "@/app/i18n/translate";
import { type McpAttempt, type McpAttemptEvent, type McpRunSummary } from "@/packages/domain/mcp";
import { type ProvisionalContribution } from "@/db/repositories/provisional-contributions";
import { controlPlaneMaintenanceCopy, type ControlPlaneWriteAvailability } from "../lib/control-plane-write-capability";
import { attemptIntegrationHref } from "../lib/attempt-integration-href";
import { activeAttemptDelegation, activeLocalCodexInstallation, activeWorkDelegation, localAgentJourney } from "../lib/local-agent-journey";
import { hasAcceptedKernelEvidence } from "./accepted-kernel-evidence";
import { runnerWorkflowStatus } from "./runner-workflow-status";

type GateState = "passed" | "waiting" | "required" | "failed";

export function WorkspacePath() {
  return <nav className="workspace-path" aria-label="Workspace sections">
    <a href="#current-research"><span>01</span><strong>Choose research</strong></a>
    <a href="#local-agent"><span>02</span><strong>Work with your Agent</strong></a>
    <a href="#evidence-workspace"><span>03</span><strong>Inspect evidence</strong></a>
  </nav>;
}

export function FirstContributionPath({
  attempt,
  profile,
  runs,
  isAuthenticated,
  signInPath,
  storageAvailable,
  writeAvailability,
  t,
}: {
  attempt: McpAttempt | null;
  profile: DelegationProfile | null;
  runs: readonly McpRunSummary[];
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
  writeAvailability: ControlPlaneWriteAvailability;
  t: Translator;
}) {
  const agentConnected = Boolean(attempt
    ? activeLocalCodexInstallation(profile, activeAttemptDelegation(profile, attempt))
    : activeLocalCodexInstallation(profile));
  const attemptOpened = Boolean(attempt);
  const progressRecorded = Boolean(attempt?.events.some((event) => event.type === "agent_reported" || event.type === "bundle_staged"));
  const bundleStaged = Boolean(attempt?.events.some((event) => event.type === "bundle_staged"));
  const leanAccepted = hasAcceptedKernelEvidence(latestRunForAttempt(attempt, runs));
  const attemptReconnectHref = attempt ? attemptIntegrationHref(attempt) : "/integrations#codex-beta";
  const states = [attemptOpened, agentConnected, progressRecorded, bundleStaged, leanAccepted];
  const completed = states.filter(Boolean).length;
  const current = states.findIndex((state) => !state);
  const next = !isAuthenticated
    ? { href: signInPath, label: t("firstPath.next.signIn"), detail: t("firstPath.next.signInDetail") }
    : !storageAvailable
      ? { href: "/explore", label: t("firstPath.next.browseResearch"), detail: t("firstPath.next.browseResearchDetail") }
      : writeAvailability !== "available"
        ? { href: "/explore", label: t("firstPath.next.browsePublic"), detail: controlPlaneMaintenanceCopy(writeAvailability, t).detail }
        : !attemptOpened
          ? { href: "/explore#starter-work", label: t("firstPath.next.choose"), detail: t("firstPath.next.chooseDetail") }
          : !agentConnected
            ? { href: attemptReconnectHref, label: t("firstPath.next.connect"), detail: t("firstPath.next.connectDetail") }
            : !progressRecorded
              ? { href: "#next-action", label: t("firstPath.next.continue"), detail: t("firstPath.next.continueDetail") }
              : !bundleStaged
                ? { href: "#local-agent", label: t("firstPath.next.approveEvidence"), detail: t("firstPath.next.approveEvidenceDetail") }
                : !leanAccepted
                  ? { href: "#local-agent", label: t("firstPath.next.track"), detail: t("firstPath.next.trackDetail") }
                  : { href: "/evidence", label: t("firstPath.next.view"), detail: t("firstPath.next.viewDetail") };
  const steps = [
    [t("firstPath.step.choose"), t("firstPath.step.chooseDetail")],
    [t("firstPath.step.connect"), t("firstPath.step.connectDetail")],
    [t("firstPath.step.research"), t("firstPath.step.researchDetail")],
    [t("firstPath.step.evidence"), t("firstPath.step.evidenceDetail")],
    [t("firstPath.step.lean"), leanAccepted ? t("firstPath.step.leanAcceptedDetail") : t("firstPath.step.leanDetail")],
  ] as const;

  return <section className="first-contribution-path" aria-labelledby="first-contribution-title">
    <div className="first-contribution-intro">
      <div><span className="micro-label">{t("firstPath.ariaTitle")}</span><strong id="first-contribution-title">{t("firstPath.title")}</strong></div>
      <span>{t("firstPath.progress", { done: completed, total: steps.length })}</span>
    </div>
    <ol>
      {steps.map(([label, detail], index) => <li className={states[index] ? "is-complete" : index === current ? "is-current" : ""} key={label} aria-current={index === current ? "step" : undefined}>
        <span>{states[index] ? "✓" : String(index + 1).padStart(2, "0")}</span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </li>)}
    </ol>
    <div className="first-contribution-next">
      <div><span>{t("firstPath.next")}</span><p>{next.detail}</p></div>
      <Link className="text-link" href={next.href}>{next.label} <span aria-hidden="true">→</span></Link>
    </div>
    <p className="first-contribution-boundary">{t("firstPath.boundary")}</p>
  </section>;
}

function GateRow({ state, label, detail, t }: { state: GateState; label: string; detail: string; t: Translator }) {
  const stateText = state === "passed" ? t("gate.state.recorded") : state === "waiting" ? t("gate.state.awaiting") : state === "failed" ? t("gate.state.rerun") : t("gate.state.independent");
  const symbol = state === "passed" ? "✓" : state === "waiting" ? "·" : state === "failed" ? "!" : "↗";

  return <li className={`gate-row gate-${state}`}>
    <span className="gate-icon" aria-hidden="true">{symbol}</span>
    <span><strong>{label}</strong><small>{detail}</small></span>
    <em>{stateText}</em>
  </li>;
}

export function WorkbenchHero({
  profile,
  isAuthenticated,
  storageAvailable,
  attemptCount,
}: {
  profile: DelegationProfile | null;
  isAuthenticated: boolean;
  storageAvailable: boolean;
  attemptCount: number;
}) {
  const active = activeDelegation(profile);
  const agent = active && profile?.agents.find((candidate) => candidate.id === active.agentId);
  const connection = activeLocalCodexInstallation(profile);
  const status = connection ? "Website approval active" : active ? "Connect Codex next" : profile ? "Agent setup required" : isAuthenticated ? "Profile unavailable" : "Sign in required";
  const activityLabel = !storageAvailable
    ? "Control plane unavailable"
    : attemptCount > 0
      ? connection
        ? `${attemptCount} durable Attempt${attemptCount === 1 ? "" : "s"} recorded`
        : "Connect Codex to continue this Attempt"
      : connection
        ? "Ready to choose a target"
        : active
          ? "Local connection required"
        : "No active Agent authority";
  const marker = profile ? "Account connected" : isAuthenticated ? "Connection unavailable" : "Account required";

  return <SectionHeading as="section" className="workbench-hero" aria-labelledby="workbench-title">
    <div>
      <p className="eyebrow">Personal workspace <span className="preview-marker">{marker}</span></p>
      <PageTitle id="workbench-title">Your research agent</PageTitle>
      <p>Choose accountable work, hand a bounded brief to your local Agent, and inspect only the evidence that actually exists.</p>
    </div>
    <Surface as="div" className="agent-identity-card">
      <div className="agent-identity-top"><span className={connection ? "agent-live" : "agent-paused"}><i aria-hidden="true" />{activityLabel}</span><ProductStateBadge tone={!storageAvailable ? "not-deployed" : connection ? "available" : "provisional"}>{status}</ProductStateBadge></div>
      <strong>{agent?.label ?? "No delegated Agent selected"}</strong>
      <code>{agent?.id ?? "Connect local Codex to create its Agent identity and scoped delegation."}</code>
      <span>Owner&nbsp; <code>{profile?.person.id ?? "Sign in to create a Person record"}</code></span>
    </Surface>
  </SectionHeading>;
}

export function DelegationSummary({ profile, t, locale }: { profile: DelegationProfile | null; t: Translator; locale: Locale }) {
  const active = activeDelegation(profile);
  const agent = active && profile?.agents.find((candidate) => candidate.id === active.agentId);
  const signingKey = active && profile?.signingKeys.find((candidate) => candidate.id === active.personKeyId);
  const scopes = active?.scopes ?? [];
  const certificate = active?.id ?? t("delegationSummary.noCertificate");
  const fingerprint = signingKey?.fingerprint ?? t("delegationSummary.noKey");
  const expiration = active
    ? new Date(active.validUntil).toLocaleDateString(locale, { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" })
    : t("delegationSummary.setupRequired");

  return <section className="delegation-summary" aria-label={t("delegationSummary.aria")}>
    <div className="delegation-title"><span className="micro-label">{active ? t("delegationSummary.active") : profile ? t("delegationSummary.setup") : t("delegationSummary.account")}</span>{active ? <Link className="delegation-certificate-link" href={`/delegations/${encodeURIComponent(active.id)}`}>{certificate}</Link> : <strong>{certificate}</strong>}<small>{t("delegationSummary.keyFingerprint", { fingerprint })}</small></div>
    <div><span className="micro-label">{t("delegationSummary.allowedWork")}</span>{scopes.length > 0 ? <p className="scope-list">{scopes.map((scope) => <b key={scope}>{scope}</b>)}</p> : <small>{t("delegationSummary.noScopes")}</small>}</div>
    <div><span className="micro-label">{active ? t("delegationSummary.validUntil") : t("delegationSummary.setupStatus")}</span><strong>{active ? expiration : profile ? t("delegationSummary.counts", { keys: profile.signingKeys.length, agents: profile.agents.length }) : expiration}</strong><small>{active ? t("delegationSummary.revocable") : t("delegationSummary.setupHint")}</small></div>
    <div className="delegation-note"><span className="micro-label">{t("delegationSummary.creditRule")}</span><small>{agent && active ? t("delegationSummary.creditActive") : t("delegationSummary.creditInactive")}</small></div>
  </section>;
}

export function FocusAction({
  profile,
  attempt,
  canContinueLocally,
  isAuthenticated,
  signInPath,
  storageAvailable,
  writeAvailability,
  refreshError,
  refreshedAt,
  handoffNotice,
  lifecycleNotice,
  lifecycleAction,
  onCopyCodexBrief,
  onLifecycleAction,
  isPageHeading = false,
  t,
  locale,
}: {
  profile: DelegationProfile | null;
  attempt: McpAttempt | null;
  canContinueLocally: boolean;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
  writeAvailability: ControlPlaneWriteAvailability;
  refreshError: string | null;
  refreshedAt: string | null;
  handoffNotice: string | null;
  lifecycleNotice: string | null;
  lifecycleAction: "pause" | "resume" | "abandon" | null;
  onCopyCodexBrief: () => void;
  onLifecycleAction: (action: "pause" | "resume" | "abandon") => void;
  isPageHeading?: boolean;
  t: Translator;
  locale: Locale;
}) {
  const journey = localAgentJourney({
    profile,
    isAuthenticated,
    storageAvailable,
    hasAttempt: attempt?.status === "active",
    hasSelectedTarget: false,
    writeAvailability,
    links: {
      signIn: signInPath,
      connect: "/integrations#codex-beta",
      chooseTarget: "#research-launcher",
      openAttempt: "#research-launcher",
      work: "#local-agent",
    },
    t,
  });
  const isPausedAttempt = attempt?.status === "paused";
  const isHistoricalAttempt = Boolean(attempt && attempt.status !== "active" && !isPausedAttempt);
  const needsAttemptConnection = Boolean(attempt?.status === "active" && !canContinueLocally);
  const attemptReconnectHref = attempt ? attemptIntegrationHref(attempt) : "/integrations#codex-beta";
  const maintenance = controlPlaneMaintenanceCopy(writeAvailability, t);
  const action = writeAvailability !== "available" ? {
    title: maintenance.title,
    detail: maintenance.detail,
    label: t("focus.browsePublic"),
    href: attempt ? `/explore/${attempt.problemSlug}` : "/explore",
  } : isPausedAttempt ? {
    title: t("focus.pausedTitle"),
    detail: t("focus.pausedDetail"),
    label: t("focus.resumeFromManage"),
    href: "#current-research",
  } : isHistoricalAttempt ? {
    title: t("focus.historyTitle"),
    detail: t("focus.historyDetail"),
    label: t("focus.chooseAnother"),
    href: "/explore",
  } : needsAttemptConnection ? {
    title: t("focus.connectBoundTitle"),
    detail: t("focus.connectBoundDetail"),
    label: t("focus.reviewConnection"),
    href: attemptReconnectHref,
  } : {
    title: journey.title,
    detail: journey.detail,
    label: journey.stage === "work_locally" ? t("focus.continueCodex") : journey.actionLabel,
    href: journey.actionHref,
  };
  const focusTitle = attempt?.problemTitle ?? t("focus.chooseTitle");
  const focusDetail = attempt
    ? attempt.status === "active"
      ? t("focus.activeDetail", { agent: attempt.agentLabel })
      : attempt.status === "paused"
        ? t("focus.pausedSummary")
        : t("focus.historySummary")
    : t("focus.chooseDetail");
  const FocusTitle = isPageHeading ? PageTitle : SectionTitle;

  return <section className="focus-layout" id="current-research" aria-label={t("focus.aria")}>
    <div className="focus-summary">
      <span className="micro-label">{t("focus.label")}</span>
      <FocusTitle>{focusTitle}</FocusTitle>
      <p>{focusDetail}</p>
      <div className="toolbar-links">
        {attempt && <Link className="text-link" href={`/explore/${attempt.problemSlug}`}>{t("focus.inspectTarget")} <span>→</span></Link>}
        {(attempt?.status === "active" || attempt?.status === "paused") && <details className="attempt-lifecycle-menu">
          <summary>{t("focus.manage")}</summary>
          <div>
            <strong>{writeAvailability !== "available" ? t("focus.changesPaused") : attempt.status === "paused" ? t("focus.pausedResearch") : t("focus.controls")}</strong>
            <p>{writeAvailability !== "available" ? maintenance.detail : attempt.status === "paused" ? t("focus.manageHintPaused") : t("focus.manageHintActive")}</p>
            <div className="button-row">
              {attempt.status === "active"
                ? <Button type="button" disabled={writeAvailability !== "available" || Boolean(lifecycleAction)} onClick={() => onLifecycleAction("pause")}>{lifecycleAction === "pause" ? t("focus.pausing") : t("focus.pause")}</Button>
                : <Button type="button" disabled={writeAvailability !== "available" || Boolean(lifecycleAction)} onClick={() => onLifecycleAction("resume")}>{lifecycleAction === "resume" ? t("focus.resuming") : t("focus.resume")}</Button>}
              <Button type="button" disabled={writeAvailability !== "available" || Boolean(lifecycleAction)} onClick={() => onLifecycleAction("abandon")}>{lifecycleAction === "abandon" ? t("focus.ending") : t("focus.end")}</Button>
            </div>
          </div>
        </details>}
        {attempt && <details className="attempt-lifecycle-menu">
          <summary>{t("focus.technical")}</summary>
          <div>
            <strong>{t("focus.stableRecord")}</strong>
            <code className="focus-attempt-id">{attempt.id}</code>
            <p>{t("focus.authority", { agent: attempt.agentLabel, scope: attempt.delegationScope ?? t("focus.legacyScope"), status: attempt.status })}</p>
            <small>{attempt.status === "active"
              ? t("focus.technicalActive")
              : attempt.status === "paused"
                ? t("focus.technicalPaused")
                : t("focus.technicalClosed")}</small>
          </div>
        </details>}
      </div>
      {lifecycleNotice && <p className="attempt-lifecycle-notice" role="status">{lifecycleNotice}</p>}
    </div>
    <Surface as="div" className="next-action-card" id="next-action">
      <span className="micro-label">{t("focus.recommended")}</span>
      <strong>{action.title}</strong>
      <p id="next-action-help">{action.detail}</p>
      <div className="next-action-controls">
        {writeAvailability !== "available"
          ? <ActionLink className="button button-secondary focus-primary" href={action.href}>{action.label}</ActionLink>
          : isPausedAttempt
          ? <Button className="button button-primary focus-primary" type="button" disabled={Boolean(lifecycleAction)} onClick={() => onLifecycleAction("resume")}>{lifecycleAction === "resume" ? t("focus.resuming") : t("focus.resumeSame")}</Button>
          : !isHistoricalAttempt && !needsAttemptConnection && journey.stage === "work_locally"
          ? <Button className="button button-primary focus-primary" type="button" onClick={onCopyCodexBrief}>{action.label}</Button>
          : <ActionLink className="button button-primary focus-primary" href={action.href}>{action.label}</ActionLink>}
        {attempt && <ActionLink className="workspace-pause-button" href="#attempt-activity">{t("focus.viewActivity")}</ActionLink>}
      </div>
      {handoffNotice && <p className="activity-refresh-status" role="status">{handoffNotice}</p>}
      {refreshedAt && <p className="activity-refresh-status" role="status">{t("focus.recordsRefreshed", { time: formatTimestamp(refreshedAt, locale) })}</p>}
      {refreshError && <p className="activity-refresh-error" role="alert">{refreshError}</p>}
    </Surface>
  </section>;
}

export function WorkspaceSettingsPrompt({
  profile,
  isAuthenticated,
  storageAvailable,
  t,
}: {
  profile: DelegationProfile | null;
  isAuthenticated: boolean;
  storageAvailable: boolean;
  t: Translator;
}) {
  const active = activeDelegation(profile);
  const connection = activeLocalCodexInstallation(profile);
  const title = !isAuthenticated
    ? t("settingsPrompt.title.signIn")
    : !storageAvailable
      ? t("settingsPrompt.title.storage")
      : connection
        ? t("settingsPrompt.title.connected")
        : active
          ? t("settingsPrompt.title.active")
          : t("settingsPrompt.title.setup");
  const detail = !isAuthenticated
    ? t("settingsPrompt.detail.signIn")
    : !storageAvailable
      ? t("settingsPrompt.detail.storage")
      : connection
        ? t("settingsPrompt.detail.connected")
        : active
          ? t("settingsPrompt.detail.active")
          : t("settingsPrompt.detail.setup");

  return <section className="workspace-settings-prompt" aria-labelledby="workspace-settings-title">
    <div><p className="eyebrow">{t("settingsPrompt.eyebrow")}</p><SectionTitle id="workspace-settings-title">{title}</SectionTitle><p>{detail}</p></div>
    <ActionLink className="button button-secondary" href={connection ? "/settings#delegation-setup" : "/integrations#codex-beta"}>{connection ? t("settingsPrompt.manage") : t("settingsPrompt.connect")}<span aria-hidden="true">→</span></ActionLink>
  </section>;
}

export function ProvisionalContributionLedger({
  profile,
  contributions,
  isAuthenticated,
  ledgerAvailable,
  t,
  locale,
}: {
  profile: DelegationProfile | null;
  contributions: readonly ProvisionalContribution[];
  isAuthenticated: boolean;
  ledgerAvailable: boolean;
  t: Translator;
  locale: Locale;
}) {
  const emptyTitle = !isAuthenticated
    ? t("ledger.emptySignInTitle")
    : !profile
      ? t("ledger.emptyProfileTitle")
      : t("ledger.emptyTitle");
  const emptyDetail = !isAuthenticated
    ? t("ledger.emptySignInDetail")
    : !profile
      ? t("ledger.emptyProfileDetail")
      : t("ledger.emptyDetail");

  return <section className="provisional-ledger" id="provisional-ledger" aria-labelledby="provisional-ledger-title">
    <SectionHeading as="div" className="provisional-ledger-heading">
      <div><p className="eyebrow">{t("ledger.eyebrow")}</p><SectionTitle id="provisional-ledger-title">{t("ledger.title")}</SectionTitle><p>{t("ledger.body")}</p></div>
      <span className={ledgerAvailable ? "record-chip" : "record-chip provisional-unavailable"}>{ledgerAvailable ? t("ledger.count", { count: contributions.length }) : t("ledger.migration")}</span>
    </SectionHeading>
    {!ledgerAvailable ? <div className="provisional-ledger-unavailable"><strong>{t("ledger.unavailableTitle")}</strong><p>{t("ledger.unavailableBody")}</p></div> : contributions.length > 0 ? <ol className="provisional-ledger-list">{contributions.map((contribution) => <li key={contribution.id}>
      <div className="provisional-entry-top"><span className="provisional-state">{t("ledger.state")}</span><time dateTime={contribution.recordedAt}>{t("ledger.recorded", { time: formatTimestamp(contribution.recordedAt, locale) })}</time></div>
      <CardTitle>{contribution.attempt.problemTitle}</CardTitle>
      <p>{t("ledger.under", { agent: contribution.beneficiary.agentLabel, certificate: contribution.beneficiary.delegationCertificateId })}</p>
      <FieldList><Field label={t("ledger.bundleHash")}><code>{contribution.artifactBundleManifestHash}</code></Field><Field label={t("ledger.agentEvent")}><code>{contribution.agentEvent.id}</code> · {formatTimestamp(contribution.agentEvent.occurredAt, locale)}</Field></FieldList>
      <Link className="text-link" href={`/evidence/${encodeURIComponent(contribution.artifactBundleManifestHash)}`}>{t("ledger.inspect")} <span>→</span></Link>
    </li>)}</ol> : <EmptyState as="div" className="provisional-ledger-empty"><strong>{emptyTitle}</strong><p>{emptyDetail}</p>{isAuthenticated && profile && <Link className="text-link" href="/integrations">{t("ledger.reviewConnection")} <span>→</span></Link>}</EmptyState>}
  </section>;
}

export function ResearchWorkstation({ attempt, runs, t, locale }: { attempt: McpAttempt | null; runs: readonly McpRunSummary[]; t: Translator; locale: Locale }) {
  const bundleStaged = Boolean(attempt?.events.some((event) => event.type === "bundle_staged"));
  const latestRun = latestRunForAttempt(attempt, runs);
  const runnerResult = latestRun?.result?.summary ?? null;
  const runnerStatus = runnerWorkflowStatus(latestRun, bundleStaged, t);
  const evidenceHref = latestRun ? `/evidence/${encodeURIComponent(latestRun.artifactBundleHash)}` : "/evidence";

  return <section className="workstation-grid" id="evidence-workspace" aria-label={t("workstation.aria")}>
    <Surface as="article" className="workstation-panel context-panel">
      <div className="workstation-heading"><span>{t("workstation.context.panel")}</span><Badge className="record-chip">{attempt ? attempt.status : t("workstation.context.noSource")}</Badge></div>
      <CardTitle>{attempt ? attempt.problemTitle : t("workstation.context.noAttemptTitle")}</CardTitle>
      <p className="context-statement">{attempt ? t("workstation.context.body") : t("workstation.context.noAttemptBody")}</p>
      <details className="local-agent-guide">
        <summary><span>{t("workstation.context.technical")}</span><small>{t("workstation.context.technicalHint")}</small></summary>
        <FieldList className="context-list">{attempt ? <>
        <div><dt>{t("workstation.context.catalogTarget")}</dt><dd><Link href={`/explore/${attempt.problemSlug}`}>{attempt.problemSlug}</Link></dd></div>
        <div><dt>{t("workstation.context.authority")}</dt><dd>{attempt.agentLabel} · {attempt.delegationScope ?? t("focus.legacyScope")}</dd></div>
        <div><dt>{t("workstation.context.attemptRecord")}</dt><dd><code>{attempt.id}</code></dd></div>
      </> : <>
        <div><dt>{t("workstation.context.firstRequirement")}</dt><dd>{t("workstation.context.firstRequirementDetail")}</dd></div>
        <div><dt>{t("workstation.context.evidenceBoundary")}</dt><dd>{t("workstation.context.evidenceBoundaryDetail")}</dd></div>
      </>}</FieldList>
      </details>
      <div className="context-footer">{attempt ? <><span>{t("workstation.context.opened", { time: formatTimestamp(attempt.createdAt, locale) })}</span><span>{t("workstation.context.updated", { time: formatTimestamp(attempt.updatedAt, locale) })}</span></> : <><span>{t("workstation.context.noSource")}</span><span>{t("workstation.context.noActivity")}</span></>}</div>
    </Surface>
    <Surface as="article" className="workstation-panel source-panel">
      <div className="workstation-heading"><span>{t("workstation.source.panel")}</span><span className={`source-${runnerStatus.tone}`}>{runnerStatus.badge}</span></div>
      <div className="source-state" aria-live="polite">
        <strong>{runnerStatus.title}</strong>
        <p>{runnerStatus.detail}</p>
        {attempt && <Link className="text-link source-link" href={evidenceHref}>{t("workstation.source.viewEvidence")} <span>→</span></Link>}
      </div>
      <details className="local-agent-guide">
        <summary><span>{t("workstation.source.technical")}</span><small>{t("workstation.source.technicalHint")}</small></summary>
        <div className="diagnostic-box">
          <div><span className={`check-dot ${runnerDotClass(latestRun)}`} aria-hidden="true" />{runnerDiagnosticTitle(latestRun, t)}</div>
          <p>{runnerDiagnosticDetail(latestRun, t)}</p>
          {runnerResult && <FieldList className="diagnostic-checks">
            <Field label={t("workstation.source.build")}>{runnerResult.status} · {t("runnerWorkflow.exit", { code: runnerResult.exitCode })}</Field>
            <Field label={t("workstation.source.kernel")}>{runnerResult.kernelStatus}</Field>
            <Field label={t("workstation.source.network")}>{runnerResult.checks.network}</Field>
            <Field label={<><code>sorry</code></>}> {runnerResult.checks.noSorry}</Field>
            <Field label={t("workstation.source.axioms")}>{runnerResult.checks.allowedAxioms}</Field>
            <Field label={t("workstation.source.leanBuild")}>{runnerResult.checks.leanBuild}</Field>
          </FieldList>}
        </div>
        <div className="source-meta"><span>{attempt ? t("workstation.source.attemptBound") : t("workstation.source.noEvidence")}</span><span>{latestRun ? t("workstation.source.runnerState", { state: latestRun.state }) : t("workstation.source.runnerRequired")}</span><span>{latestRun?.evidenceState === "recorded" ? t("workstation.source.resultRecorded") : t("workstation.source.reviewRequired")}</span></div>
      </details>
    </Surface>
    <Surface as="article" className="workstation-panel run-panel" id="attempt-activity">
      <div className="workstation-heading"><span>{t("workstation.activity.panel")}</span><Badge className="record-chip">{t("workstation.activity.private")}</Badge></div>
      <p className="run-lede">{t("workstation.activity.lede")}</p>
      {attempt?.events.length ? <ol className="event-list" aria-live="polite">{attempt.events.map((event) => <AttemptEventRow event={event} key={event.id} t={t} locale={locale} />)}</ol> : <p className="event-empty">{t("workstation.activity.empty")}</p>}
      <p className="event-footer">{attempt ? t("workstation.activity.footer") : t("workstation.activity.noSimulation")}</p>
    </Surface>
  </section>;
}

export function SubmissionReadiness({
  attempt,
  profile,
  runs,
  writeAvailability,
  compact = false,
  t,
}: {
  attempt: McpAttempt | null;
  profile: DelegationProfile | null;
  runs: readonly McpRunSummary[];
  writeAvailability: ControlPlaneWriteAvailability;
  compact?: boolean;
  t: Translator;
}) {
  const hasAgentProgress = Boolean(attempt?.events.some((event) => event.type === "agent_reported"));
  const bundleStaged = Boolean(attempt?.events.some((event) => event.type === "bundle_staged"));
  const connectionActive = Boolean(attempt && activeLocalCodexInstallation(
    profile,
    activeAttemptDelegation(profile, attempt),
  ));
  const attemptIsActive = attempt?.status === "active";
  const leanGate = leanGateFor(latestRunForAttempt(attempt, runs), t);
  const passedGates = [Boolean(attempt), hasAgentProgress, bundleStaged, leanGate.state === "passed"].filter(Boolean).length;
  const action = writeAvailability !== "available"
    ? { href: attempt ? `/explore/${attempt.problemSlug}` : "/explore", label: t("submission.action.browse") }
    : !attempt
    ? { href: "#research-launcher", label: t("submission.action.start") }
    : !attemptIsActive
      ? { href: "/explore", label: t("submission.action.chooseAnother") }
    : !connectionActive
      ? { href: "/integrations", label: t("submission.action.reviewConnection") }
      : bundleStaged
        ? { href: "/evidence", label: t("submission.action.inspectEvidence") }
        : { href: "#local-agent", label: t("submission.action.continue") };

  const gateList = <ul className="gate-list">
    <GateRow state={attempt ? "passed" : "waiting"} label={t("submission.gate.question")} detail={attempt ? t("submission.gate.questionDetail") : t("submission.gate.questionWaiting")} t={t} />
    <GateRow state={hasAgentProgress ? "passed" : "waiting"} label={t("submission.gate.progress")} detail={hasAgentProgress ? t("submission.gate.progressDetail") : t("submission.gate.progressWaiting")} t={t} />
    <GateRow state={bundleStaged ? "passed" : "waiting"} label={t("submission.gate.evidence")} detail={bundleStaged ? t("submission.gate.evidenceDetail") : t("submission.gate.evidenceWaiting")} t={t} />
    <GateRow state={leanGate.state} label={t("submission.gate.lean")} detail={leanGate.detail} t={t} />
    <GateRow state="required" label={t("submission.gate.review")} detail={t("submission.gate.reviewDetail")} t={t} />
  </ul>;

  if (compact) return <section className="submission-section submission-section-compact" id="contribution-gates" aria-labelledby="submission-title">
    <div className="workspace-rail-heading">
      <span className="micro-label">{t("submission.compactRail")}</span>
      <strong id="submission-title">{t("submission.title")}</strong>
      <small>{t("submission.passed", { passed: passedGates, total: 5 })}</small>
    </div>
    <Surface as="div" className="submission-card">
      {gateList}
      <p className="submission-hint">{writeAvailability !== "available" ? controlPlaneMaintenanceCopy(writeAvailability, t).detail : !attemptIsActive && attempt ? t("submission.hint.finished") : connectionActive ? t("submission.hint.agentActive") : t("submission.hint.connect")}</p>
    </Surface>
  </section>;

  return <section className="submission-section" id="contribution-gates" aria-labelledby="submission-title">
    <div className="submission-copy"><p className="eyebrow">{t("submission.copy.eyebrow")}</p><SectionTitle id="submission-title">{t("submission.copy.title")}</SectionTitle><p>{t("submission.copy.body")}</p></div>
    <Surface as="div" className="submission-card">
      <div className="submission-card-heading"><strong>{t("submission.path")}</strong><span>{attempt ? t("submission.questionSelected") : t("submission.chooseQuestion")}</span></div>
      {gateList}
      <p className="submission-hint">{writeAvailability !== "available" ? controlPlaneMaintenanceCopy(writeAvailability, t).detail : !attemptIsActive && attempt ? t("submission.hint.finished") : connectionActive ? t("submission.hint.connectedActive") : t("submission.hint.connectAssigned")}</p>
      <ActionLink className="button button-primary submit-button" href={action.href}>{action.label}</ActionLink>
    </Surface>
  </section>;
}

function latestRunForAttempt(attempt: McpAttempt | null, runs: readonly McpRunSummary[]): McpRunSummary | null {
  if (!attempt) return null;
  return runs.find((run) => run.attemptId === attempt.id) ?? null;
}

function runnerDotClass(run: McpRunSummary | null): string {
  if (hasAcceptedKernelEvidence(run)) return "is-passed";
  if (run?.evidenceState === "unreadable" || ["failed", "timed_out", "rejected", "cancelled"].includes(run?.state ?? "")) return "is-failed";
  return run ? "is-waiting" : "is-pending";
}

function runnerDiagnosticTitle(run: McpRunSummary | null, t: Translator): string {
  return runnerWorkflowStatus(run, true, t).technicalTitle;
}

function runnerDiagnosticDetail(run: McpRunSummary | null, t: Translator): string {
  return runnerWorkflowStatus(run, true, t).technicalDetail;
}

function leanGateFor(run: McpRunSummary | null, t: Translator): { state: GateState; detail: string } {
  if (!run) return { state: "waiting", detail: t("leanGate.noRun") };
  if (hasAcceptedKernelEvidence(run)) return { state: "passed", detail: t("leanGate.accepted") };
  if (run.evidenceState === "unreadable") return { state: "failed", detail: t("leanGate.unreadable") };
  if (run.result?.summary) return { state: "failed", detail: t("leanGate.failed", { status: run.result.summary.status, kernel: run.result.summary.kernelStatus }) };
  return { state: "waiting", detail: t("leanGate.running", { state: run.state }) };
}

function AttemptEventRow({ event, t, locale }: { event: McpAttemptEvent; t: Translator; locale: Locale }) {
  return <li>
    <time dateTime={event.occurredAt}>#{event.sequence}</time>
    <span className={`event-dot ${eventStyle(event.type)}`} aria-hidden="true" />
    <div><strong>{eventLabel(event.type, t)}</strong><p>{event.message}</p><small>{formatTimestamp(event.occurredAt, locale)}{event.progressPercent === null ? "" : ` · ${t("event.progress", { percent: event.progressPercent })}`}</small></div>
  </li>;
}

function eventLabel(type: McpAttemptEvent["type"], t: Translator): string {
  const keys: Record<McpAttemptEvent["type"], Parameters<Translator>[0]> = {
    attempt_created: "event.attempt_created",
    authority_renewed: "event.authority_renewed",
    agent_reported: "event.agent_reported",
    checkpoint_published: "event.checkpoint_published",
    bundle_staged: "event.bundle_staged",
    attempt_paused: "event.attempt_paused",
    attempt_resumed: "event.attempt_resumed",
    attempt_submitted: "event.attempt_submitted",
    attempt_completed: "event.attempt_completed",
    attempt_abandoned: "event.attempt_abandoned",
    attempt_cancelled: "event.attempt_cancelled",
  };
  return t(keys[type]);
}

function eventStyle(type: McpAttemptEvent["type"]): "branch" | "evidence" | "check" {
  if (["attempt_created", "authority_renewed", "attempt_paused", "attempt_resumed"].includes(type)) return "branch";
  if (["agent_reported", "checkpoint_published"].includes(type)) return "evidence";
  return "check";
}

function formatTimestamp(value: string, locale: Locale): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function activeDelegation(profile: DelegationProfile | null) {
  return activeWorkDelegation(profile);
}
