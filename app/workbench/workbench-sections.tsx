import Link from "next/link";
import { ProductStateBadge } from "../ui";
import type { DelegationProfile } from "@/db/repositories/delegation";
import type { McpAttempt, McpAttemptEvent, McpRunSummary } from "@/packages/domain/mcp";
import type { ProvisionalContribution } from "@/db/repositories/provisional-contributions";
import {
  controlPlaneMaintenanceCopy,
  type ControlPlaneWriteAvailability,
} from "../lib/control-plane-write-capability";
import { activeAttemptDelegation, activeLocalCodexInstallation, activeWorkDelegation, localAgentJourney } from "../lib/local-agent-journey";

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
}: {
  attempt: McpAttempt | null;
  profile: DelegationProfile | null;
  runs: readonly McpRunSummary[];
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
  writeAvailability: ControlPlaneWriteAvailability;
}) {
  const agentConnected = Boolean(attempt
    ? activeLocalCodexInstallation(profile, activeAttemptDelegation(profile, attempt))
    : activeLocalCodexInstallation(profile));
  const attemptOpened = Boolean(attempt);
  const progressRecorded = Boolean(attempt?.events.some((event) => event.type === "agent_reported" || event.type === "bundle_staged"));
  const bundleStaged = Boolean(attempt?.events.some((event) => event.type === "bundle_staged"));
  const leanAccepted = hasAcceptedKernel(latestRunForAttempt(attempt, runs));
  const states = [attemptOpened, agentConnected, progressRecorded, bundleStaged, leanAccepted];
  const completed = states.filter(Boolean).length;
  const current = states.findIndex((state) => !state);
  const next = !isAuthenticated
    ? { href: signInPath, label: "Sign in", detail: "Create the stable Person record that will own your Agent work." }
    : !storageAvailable
      ? { href: "/explore", label: "Browse research", detail: "The contribution control plane is temporarily unavailable; public records remain readable." }
      : writeAvailability !== "available"
        ? { href: "/explore", label: "Browse public research", detail: controlPlaneMaintenanceCopy(writeAvailability).detail }
        : !attemptOpened
          ? { href: "/explore#starter-work", label: "Choose a question", detail: "Choose a precise public question so your Agent can build on shared work." }
          : !agentConnected
            ? { href: "/integrations#codex-beta", label: "Connect Agent", detail: "Approve your local Codex once. No API key, public key, or workspace is pasted." }
          : !progressRecorded
            ? { href: "#next-action", label: "Continue in Codex", detail: "Research locally, then choose whether one useful milestone should be recorded." }
            : !bundleStaged
              ? { href: "#local-agent", label: "Approve evidence", detail: "Review the exact files and hashes before allowing any evidence to leave your computer." }
              : !leanAccepted
                ? { href: "#local-agent", label: "Track verification", detail: "Your approved evidence is waiting for an isolated Lean check." }
                : { href: "/evidence", label: "View verification", detail: "Lean accepted this evidence. Independent review is still required before contribution credit." };
  const steps = [
    ["Choose question", "One precise public target"],
    ["Connect Agent", "One-time private approval"],
    ["Research locally", "Private work stays local"],
    ["Approve evidence", "You review before sharing"],
    ["Verification & credit", leanAccepted ? "Lean accepted · review next" : "Lean, review, then credit"],
  ] as const;

  return <section className="first-contribution-path" aria-labelledby="first-contribution-title">
    <div className="first-contribution-intro">
      <div><span className="micro-label">First evidence path</span><strong id="first-contribution-title">One step at a time.</strong></div>
      <span>{completed} / {steps.length} ready</span>
    </div>
    <ol>
      {steps.map(([label, detail], index) => <li className={states[index] ? "is-complete" : index === current ? "is-current" : ""} key={label} aria-current={index === current ? "step" : undefined}>
        <span>{states[index] ? "✓" : String(index + 1).padStart(2, "0")}</span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </li>)}
    </ol>
    <div className="first-contribution-next">
      <div><span>Next</span><p>{next.detail}</p></div>
      <Link className="text-link" href={next.href}>{next.label} <span aria-hidden="true">→</span></Link>
    </div>
    <p className="first-contribution-boundary">After Lean acceptance, a different owner must complete the reproducibility, kernel, and project-acceptance gates before a Contribution Receipt can be issued. Statement fidelity and novelty remain additional quality reviews; none of these are inferred from the five owner-side steps.</p>
  </section>;
}

function GateRow({ state, label, detail }: { state: GateState; label: string; detail: string }) {
  const stateText = state === "passed" ? "Recorded" : state === "waiting" ? "Awaiting" : state === "failed" ? "Needs rerun" : "Independent";
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

  return <section className="workbench-hero" aria-labelledby="workbench-title">
    <div>
      <p className="eyebrow">Personal workspace <span className="preview-marker">{marker}</span></p>
      <h1 id="workbench-title">Your research agent</h1>
      <p>Choose accountable work, hand a bounded brief to your local Agent, and inspect only the evidence that actually exists.</p>
    </div>
    <div className="agent-identity-card">
      <div className="agent-identity-top"><span className={connection ? "agent-live" : "agent-paused"}><i aria-hidden="true" />{activityLabel}</span><ProductStateBadge tone={!storageAvailable ? "not-deployed" : connection ? "available" : "provisional"}>{status}</ProductStateBadge></div>
      <strong>{agent?.label ?? "No delegated Agent selected"}</strong>
      <code>{agent?.id ?? "Connect local Codex to create its Agent identity and scoped delegation."}</code>
      <span>Owner&nbsp; <code>{profile?.person.id ?? "Sign in to create a Person record"}</code></span>
    </div>
  </section>;
}

export function DelegationSummary({ profile }: { profile: DelegationProfile | null }) {
  const active = activeDelegation(profile);
  const agent = active && profile?.agents.find((candidate) => candidate.id === active.agentId);
  const signingKey = active && profile?.signingKeys.find((candidate) => candidate.id === active.personKeyId);
  const scopes = active?.scopes ?? [];
  const certificate = active?.id ?? "No active certificate";
  const fingerprint = signingKey?.fingerprint ?? "No active signing key";
  const expiration = active
    ? new Date(active.validUntil).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
    : "Set up required";

  return <section className="delegation-summary" aria-label="Delegation certificate">
    <div className="delegation-title"><span className="micro-label">{active ? "Active delegation" : profile ? "Delegation setup" : "Account authority"}</span>{active ? <Link className="delegation-certificate-link" href={`/delegations/${encodeURIComponent(active.id)}`}>{certificate}</Link> : <strong>{certificate}</strong>}<small>Key fingerprint · {fingerprint}</small></div>
    <div><span className="micro-label">Allowed work</span>{scopes.length > 0 ? <p className="scope-list">{scopes.map((scope) => <b key={scope}>{scope}</b>)}</p> : <small>No active scopes</small>}</div>
    <div><span className="micro-label">{active ? "Valid until" : "Setup status"}</span><strong>{active ? expiration : profile ? `${profile.signingKeys.length} key · ${profile.agents.length} Agent` : expiration}</strong><small>{active ? "Revocable by owner" : "Create a signed delegation before reporting work"}</small></div>
    <div className="delegation-note"><span className="micro-label">Credit rule</span><small>{agent && active ? "This signed authority credits its owner; same-owner Agents cannot independently verify it." : "Same-owner Agents cannot independently verify this branch."}</small></div>
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
  });
  const isPausedAttempt = attempt?.status === "paused";
  const isHistoricalAttempt = Boolean(attempt && attempt.status !== "active" && !isPausedAttempt);
  const needsAttemptConnection = Boolean(attempt?.status === "active" && !canContinueLocally);
  const maintenance = controlPlaneMaintenanceCopy(writeAvailability);
  const action = writeAvailability !== "available" ? {
    title: maintenance.title,
    detail: maintenance.detail,
    label: "Browse public research",
    href: attempt ? `/explore/${attempt.problemSlug}` : "/explore",
  } : isPausedAttempt ? {
    title: "This Attempt is paused, not lost.",
    detail: "Its stable id, branch history, and evidence remain intact. Resume it under current same-Agent authority when you are ready.",
    label: "Resume from Manage Attempt",
    href: "#current-research",
  } : isHistoricalAttempt ? {
    title: "This Attempt is retained in your research history.",
    detail: "Its recorded events and evidence remain inspectable. Open a new Attempt if you want your Agent to continue this target or explore another direction.",
    label: "Choose another target",
    href: "/explore",
  } : needsAttemptConnection ? {
    title: "Connect the Agent bound to this Attempt.",
    detail: "This research record belongs to a different or expired Agent approval. Reconnect before copying a brief or recording more work.",
    label: "Review Agent connection",
    href: "/integrations#codex-beta",
  } : {
    title: journey.title,
    detail: journey.detail,
    label: journey.stage === "work_locally" ? "Continue in Codex" : journey.actionLabel,
    href: journey.actionHref,
  };
  const focusTitle = attempt?.problemTitle ?? "Choose a source-pinned research target.";
  const focusDetail = attempt
    ? attempt.status === "active"
      ? `Research with ${attempt.agentLabel}. Your private work stays on your computer.`
      : attempt.status === "paused"
        ? "This research task is paused. Its public record and evidence remain available."
        : "This research task is part of your history and remains available to inspect."
    : "Choose a precise public question. Starting a task does not claim that a proof has been found.";
  const FocusTitle = isPageHeading ? "h1" : "h2";

  return <section className="focus-layout" id="current-research" aria-label="Current focus and next action">
    <div className="focus-summary">
      <span className="micro-label">Current focus</span>
      <FocusTitle>{focusTitle}</FocusTitle>
      <p>{focusDetail}</p>
      <div className="toolbar-links">
        {attempt && <Link className="text-link" href={`/explore/${attempt.problemSlug}`}>Inspect target <span>→</span></Link>}
        {(attempt?.status === "active" || attempt?.status === "paused") && <details className="attempt-lifecycle-menu">
          <summary>Manage research</summary>
          <div>
            <strong>{writeAvailability !== "available" ? "Changes are paused" : attempt.status === "paused" ? "Paused research" : "Research controls"}</strong>
            <p>{writeAvailability !== "available" ? maintenance.detail : attempt.status === "paused" ? "Resume this same task, or end this direction permanently." : "Pause keeps this task resumable. Ending it preserves every existing record."}</p>
            <div className="button-row">
              {attempt.status === "active"
                ? <button type="button" disabled={writeAvailability !== "available" || Boolean(lifecycleAction)} onClick={() => onLifecycleAction("pause")}>{lifecycleAction === "pause" ? "Pausing…" : "Pause research"}</button>
                : <button type="button" disabled={writeAvailability !== "available" || Boolean(lifecycleAction)} onClick={() => onLifecycleAction("resume")}>{lifecycleAction === "resume" ? "Resuming…" : "Resume research"}</button>}
              <button type="button" disabled={writeAvailability !== "available" || Boolean(lifecycleAction)} onClick={() => onLifecycleAction("abandon")}>{lifecycleAction === "abandon" ? "Ending…" : "End this research"}</button>
            </div>
          </div>
        </details>}
        {attempt && <details className="attempt-lifecycle-menu">
          <summary>Technical details</summary>
          <div>
            <strong>Stable research record</strong>
            <code className="focus-attempt-id">{attempt.id}</code>
            <p>{attempt.agentLabel} · {attempt.delegationScope ?? "legacy"} authority · {attempt.status}</p>
            <small>{attempt.status === "active"
              ? "“Continue in Codex” will copy instructions for this exact record."
              : attempt.status === "paused"
                ? "Resume this record before asking the Agent to publish more progress."
                : "This closed record cannot receive additional Agent writes."}</small>
          </div>
        </details>}
      </div>
      {lifecycleNotice && <p className="attempt-lifecycle-notice" role="status">{lifecycleNotice}</p>}
    </div>
    <div className="next-action-card" id="next-action">
      <span className="micro-label">Recommended next action</span>
      <strong>{action.title}</strong>
      <p id="next-action-help">{action.detail}</p>
      <div className="next-action-controls">
        {writeAvailability !== "available"
          ? <Link className="button button-secondary focus-primary" href={action.href}>{action.label}</Link>
          : isPausedAttempt
          ? <button className="button button-primary focus-primary" type="button" disabled={Boolean(lifecycleAction)} onClick={() => onLifecycleAction("resume")}>{lifecycleAction === "resume" ? "Resuming…" : "Resume same Attempt"}</button>
          : !isHistoricalAttempt && !needsAttemptConnection && journey.stage === "work_locally"
          ? <button className="button button-primary focus-primary" type="button" onClick={onCopyCodexBrief}>{action.label}</button>
          : <Link className="button button-primary focus-primary" href={action.href}>{action.label}</Link>}
        {attempt && <Link className="workspace-pause-button" href="#attempt-activity">View recorded activity</Link>}
      </div>
      {handoffNotice && <p className="activity-refresh-status" role="status">{handoffNotice}</p>}
      {refreshedAt && <p className="activity-refresh-status" role="status">Records refreshed {formatTimestamp(refreshedAt)}.</p>}
      {refreshError && <p className="activity-refresh-error" role="alert">{refreshError}</p>}
    </div>
  </section>;
}

export function WorkspaceSettingsPrompt({
  profile,
  isAuthenticated,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  isAuthenticated: boolean;
  storageAvailable: boolean;
}) {
  const active = activeDelegation(profile);
  const connection = activeLocalCodexInstallation(profile);
  const title = !isAuthenticated
    ? "Keep Agent authority in one account settings page."
    : !storageAvailable
      ? "Account controls are waiting for the durable control plane."
      : connection
        ? "Your research Agent is configured outside the active research flow."
        : active
          ? "Connect your local Codex before continuing research."
          : "Connect local Codex to create accountable Agent authority.";
  const detail = !isAuthenticated
    ? "Signing keys, Agent registration, and revocable delegations are personal account controls—not properties of a single research Attempt."
    : !storageAvailable
      ? "Proofweave will not expose a local fallback for keys or delegation changes while account storage is unavailable."
      : connection
        ? "Use Settings to inspect or revoke keys, delegated scopes, and external Agent approvals without interrupting the workbench."
        : active
          ? "Your existing authority needs a local Codex approval before it can use the bounded Proofweave tools."
          : "The normal setup happens during browser-approved Codex pairing. Manual key management remains available only as an advanced control.";

  return <section className="workspace-settings-prompt" aria-labelledby="workspace-settings-title">
    <div><p className="eyebrow">Account controls</p><h2 id="workspace-settings-title">{title}</h2><p>{detail}</p></div>
    <Link className="button button-secondary" href={connection ? "/settings#delegation-setup" : "/integrations#codex-beta"}>{connection ? "Manage Agent settings" : "Install or connect Codex"}<span aria-hidden="true">→</span></Link>
  </section>;
}

export function ProvisionalContributionLedger({
  profile,
  contributions,
  isAuthenticated,
  ledgerAvailable,
}: {
  profile: DelegationProfile | null;
  contributions: readonly ProvisionalContribution[];
  isAuthenticated: boolean;
  ledgerAvailable: boolean;
}) {
  const emptyTitle = !isAuthenticated
    ? "Sign in to view your personal evidence ledger."
    : !profile
      ? "Your contribution profile is not available yet."
      : "No signed Artifact Bundle has been staged yet.";
  const emptyDetail = !isAuthenticated
    ? "The ledger is private to the Person who delegated the Agent."
    : !profile
      ? "No local or sample contribution record is shown while the control plane is unavailable."
      : "When an authorized Agent stages a complete signed Bundle, Proofweave creates one immutable provisional evidence record here.";

  return <section className="provisional-ledger" id="provisional-ledger" aria-labelledby="provisional-ledger-title">
    <div className="provisional-ledger-heading">
      <div><p className="eyebrow">Immediate evidence record</p><h2 id="provisional-ledger-title">Staged evidence ledger</h2><p>Each entry records an attributable signed Bundle awaiting later checks. It is not a theorem, Lean result, novelty finding, independent review, credit award, or final Contribution Receipt.</p></div>
      <span className={ledgerAvailable ? "record-chip" : "record-chip provisional-unavailable"}>{ledgerAvailable ? `${contributions.length} record${contributions.length === 1 ? "" : "s"}` : "Migration required"}</span>
    </div>
    {!ledgerAvailable ? <div className="provisional-ledger-unavailable"><strong>The ledger schema is not active in this control plane.</strong><p>Proofweave will not award credit from a timeline event. Apply the D1 migration before this owner-visible staged evidence record can be read.</p></div> : contributions.length > 0 ? <ol className="provisional-ledger-list">{contributions.map((contribution) => <li key={contribution.id}>
      <div className="provisional-entry-top"><span className="provisional-state">Bundle staged · provisional</span><time dateTime={contribution.recordedAt}>Recorded {formatTimestamp(contribution.recordedAt)}</time></div>
      <h3>{contribution.attempt.problemTitle}</h3>
      <p>{contribution.beneficiary.agentLabel} under <code>{contribution.beneficiary.delegationCertificateId}</code></p>
      <dl><div><dt>Bundle hash</dt><dd><code>{contribution.artifactBundleManifestHash}</code></dd></div><div><dt>Signed Agent event</dt><dd><code>{contribution.agentEvent.id}</code> · {formatTimestamp(contribution.agentEvent.occurredAt)}</dd></div></dl>
      <Link className="text-link" href={`/evidence/${encodeURIComponent(contribution.artifactBundleManifestHash)}`}>Inspect bound evidence <span>→</span></Link>
    </li>)}</ol> : <div className="provisional-ledger-empty"><strong>{emptyTitle}</strong><p>{emptyDetail}</p>{isAuthenticated && profile && <Link className="text-link" href="/integrations">Review Agent connection <span>→</span></Link>}</div>}
  </section>;
}

export function ResearchWorkstation({ attempt, runs }: { attempt: McpAttempt | null; runs: readonly McpRunSummary[] }) {
  const bundleStaged = Boolean(attempt?.events.some((event) => event.type === "bundle_staged"));
  const latestRun = latestRunForAttempt(attempt, runs);
  const runnerResult = latestRun?.result?.summary ?? null;
  const runnerAccepted = hasAcceptedKernel(latestRun);
  const evidenceHref = latestRun ? `/evidence/${encodeURIComponent(latestRun.artifactBundleHash)}` : "/evidence";

  return <section className="workstation-grid" id="evidence-workspace" aria-label="Research workstation">
    <article className="workstation-panel context-panel">
      <div className="workstation-heading"><span>01 / Selected question</span><span className="record-chip">{attempt ? attempt.status : "Not selected"}</span></div>
      <h3>{attempt ? attempt.problemTitle : "Choose a precise public question before starting research."}</h3>
      <p className="context-statement">{attempt ? "This is the exact question assigned to your Agent. Selecting it does not imply progress or verification." : "Proofweave shows no invented research branch before a durable research task has been opened."}</p>
      <details className="local-agent-guide">
        <summary><span>Technical task details</span><small>Source, authority, and stable record</small></summary>
        <dl className="context-list">{attempt ? <>
        <div><dt>Catalog target</dt><dd><Link href={`/explore/${attempt.problemSlug}`}>{attempt.problemSlug}</Link></dd></div>
        <div><dt>Agent authority</dt><dd>{attempt.agentLabel} · {attempt.delegationScope ?? "legacy authority"}</dd></div>
        <div><dt>Attempt record</dt><dd><code>{attempt.id}</code></dd></div>
      </> : <>
        <div><dt>First requirement</dt><dd>Sign in, issue a scoped delegation, then select a public frontier target.</dd></div>
        <div><dt>Evidence boundary</dt><dd>Only a remote Agent may report signed progress; only the isolated runner may produce Lean evidence.</dd></div>
      </>}</dl>
      </details>
      <div className="context-footer">{attempt ? <><span>Opened {formatTimestamp(attempt.createdAt)}</span><span>Last updated {formatTimestamp(attempt.updatedAt)}</span></> : <><span>No source snapshot selected</span><span>No Agent activity recorded</span></>}</div>
    </article>
    <article className="workstation-panel source-panel">
      <div className="workstation-heading"><span>02 / Evidence &amp; verification</span><span className={runnerAccepted ? "source-good" : "source-waiting"}>{runnerAccepted ? "Lean accepted" : bundleStaged ? "Evidence approved" : "Awaiting evidence"}</span></div>
      <div className="source-state">
        <strong>{runnerAccepted ? "Lean accepted the approved evidence." : bundleStaged ? "Your approved evidence is recorded and ready for verification." : "No evidence has been approved for verification."}</strong>
        <p>{runnerAccepted ? "This confirms only the Lean check. Independent review and contribution credit remain separate." : bundleStaged ? "You can inspect exactly what was shared. Approval alone is not a Lean check or an accepted contribution." : "Private work and local previews do not move this step. Proofweave does not render a sample source file or a fictional compiler result in place of a complete, Agent-signed Bundle."}</p>
        {attempt && <Link className="text-link source-link" href={evidenceHref}>View evidence <span>→</span></Link>}
      </div>
      <details className="local-agent-guide">
        <summary><span>Technical verification details</span><small>Runner, kernel, and policy checks</small></summary>
        <div className="diagnostic-box">
          <div><span className={`check-dot ${runnerDotClass(latestRun)}`} aria-hidden="true" />{runnerDiagnosticTitle(latestRun)}</div>
          <p>{runnerDiagnosticDetail(latestRun)}</p>
          {runnerResult && <dl className="diagnostic-checks">
            <div><dt>Build</dt><dd>{runnerResult.status} · exit {runnerResult.exitCode}</dd></div>
            <div><dt>Kernel</dt><dd>{runnerResult.kernelStatus}</dd></div>
            <div><dt>Network</dt><dd>{runnerResult.checks.network}</dd></div>
            <div><dt><code>sorry</code></dt><dd>{runnerResult.checks.noSorry}</dd></div>
            <div><dt>Axioms</dt><dd>{runnerResult.checks.allowedAxioms}</dd></div>
            <div><dt>Lean build</dt><dd>{runnerResult.checks.leanBuild}</dd></div>
          </dl>}
        </div>
        <div className="source-meta"><span>{attempt ? "Attempt-bound evidence" : "No workspace evidence"}</span><span>{latestRun ? `Runner · ${latestRun.state}` : "Runner required"}</span><span>{latestRun?.evidenceState === "recorded" ? "Result evidence recorded" : "Independent review required"}</span></div>
      </details>
    </article>
    <article className="workstation-panel run-panel" id="attempt-activity">
      <div className="workstation-heading"><span>03 / Recorded activity</span><span className="record-chip">Private by default</span></div>
      <p className="run-lede">Only progress and evidence approved for the research record appear here. Private reasoning is never displayed.</p>
      {attempt?.events.length ? <ol className="event-list" aria-live="polite">{attempt.events.map((event) => <AttemptEventRow event={event} key={event.id} />)}</ol> : <p className="event-empty">No Agent activity has been recorded. Opening an Attempt creates the first durable owner event; remote Agent progress is separately authorized.</p>}
      <p className="event-footer">{attempt ? "This timeline records only immutable Attempt events. It is not Lean verification, independent review, or a Contribution Receipt." : "No simulated Agent work is created in this workspace. Open an Attempt to establish a bounded record."}</p>
    </article>
  </section>;
}

export function SubmissionReadiness({
  attempt,
  profile,
  runs,
  writeAvailability,
  compact = false,
}: {
  attempt: McpAttempt | null;
  profile: DelegationProfile | null;
  runs: readonly McpRunSummary[];
  writeAvailability: ControlPlaneWriteAvailability;
  compact?: boolean;
}) {
  const hasAgentProgress = Boolean(attempt?.events.some((event) => event.type === "agent_reported"));
  const bundleStaged = Boolean(attempt?.events.some((event) => event.type === "bundle_staged"));
  const connectionActive = Boolean(attempt && activeLocalCodexInstallation(
    profile,
    activeAttemptDelegation(profile, attempt),
  ));
  const attemptIsActive = attempt?.status === "active";
  const leanGate = leanGateFor(latestRunForAttempt(attempt, runs));
  const passedGates = [Boolean(attempt), hasAgentProgress, bundleStaged, leanGate.state === "passed"].filter(Boolean).length;
  const action = writeAvailability !== "available"
    ? { href: attempt ? `/explore/${attempt.problemSlug}` : "/explore", label: "Browse public research" }
    : !attempt
    ? { href: "#research-launcher", label: "Start research" }
    : !attemptIsActive
      ? { href: "/explore", label: "Choose another target" }
    : !connectionActive
      ? { href: "/integrations", label: "Review connection" }
      : bundleStaged
        ? { href: "/evidence", label: "Inspect evidence" }
        : { href: "#local-agent", label: "Continue with Agent" };

  const gateList = <ul className="gate-list">
    <GateRow state={attempt ? "passed" : "waiting"} label="Question selected" detail={attempt ? "One precise public target is saved for this research task." : "Choose a precise public question first."} />
    <GateRow state={hasAgentProgress ? "passed" : "waiting"} label="Research progress" detail={hasAgentProgress ? "A useful milestone approved by the owner is recorded." : "Private exploration does not count until you approve a concise milestone."} />
    <GateRow state={bundleStaged ? "passed" : "waiting"} label="Evidence approved" detail={bundleStaged ? "The owner-approved, hash-checked evidence is recorded." : "You must review the exact files and hashes before evidence is shared."} />
    <GateRow state={leanGate.state} label="Lean verification" detail={leanGate.detail} />
    <GateRow state="required" label="Independent review & credit" detail="A different owner must review accepted evidence before contribution credit." />
  </ul>;

  if (compact) return <section className="submission-section submission-section-compact" id="contribution-gates" aria-labelledby="submission-title">
    <div className="workspace-rail-heading">
      <span className="micro-label">Your contribution path</span>
      <strong id="submission-title">Verification and credit</strong>
      <small>{passedGates} of 5 recorded</small>
    </div>
    <div className="submission-card">
      {gateList}
      <p className="submission-hint">{writeAvailability !== "available" ? controlPlaneMaintenanceCopy(writeAvailability).detail : !attemptIsActive && attempt ? "This finished research task remains inspectable, but it no longer accepts new progress." : connectionActive ? "Your Agent may continue this task; every later claim still needs its own evidence." : "Connecting an Agent does not by itself verify any mathematics."}</p>
    </div>
  </section>;

  return <section className="submission-section" id="contribution-gates" aria-labelledby="submission-title">
    <div className="submission-copy"><p className="eyebrow">Verification and credit</p><h2 id="submission-title">See every step before a contribution can count.</h2><p>Progress, approved evidence, Lean verification, independent review, and contribution credit remain separate results.</p></div>
    <div className="submission-card">
      <div className="submission-card-heading"><strong>Contribution path</strong><span>{attempt ? "Question selected" : "Choose a question"}</span></div>
      {gateList}
      <p className="submission-hint">{writeAvailability !== "available" ? controlPlaneMaintenanceCopy(writeAvailability).detail : !attemptIsActive && attempt ? "This finished research task remains inspectable, but it no longer accepts new progress." : connectionActive ? "Your connected Agent may continue. Every mathematical claim still needs its own evidence." : "Connect the Agent assigned to this question before continuing."}</p>
      <Link className="button button-primary submit-button" href={action.href}>{action.label}</Link>
    </div>
  </section>;
}

function latestRunForAttempt(attempt: McpAttempt | null, runs: readonly McpRunSummary[]): McpRunSummary | null {
  if (!attempt) return null;
  return runs.find((run) => run.attemptId === attempt.id) ?? null;
}

function hasAcceptedKernel(run: McpRunSummary | null): boolean {
  const summary = run?.result?.summary;
  return Boolean(
    run?.evidenceState === "recorded" &&
    run.state === "succeeded" &&
    summary?.status === "succeeded" &&
    summary.kernelStatus === "accepted" &&
    summary.checks.network === "passed" &&
    summary.checks.noSorry === "passed" &&
    summary.checks.allowedAxioms === "passed" &&
    summary.checks.leanBuild === "passed",
  );
}

function runnerDotClass(run: McpRunSummary | null): string {
  if (hasAcceptedKernel(run)) return "is-passed";
  if (run?.evidenceState === "unreadable" || ["failed", "timed_out", "rejected", "cancelled"].includes(run?.state ?? "")) return "is-failed";
  return run ? "is-waiting" : "is-pending";
}

function runnerDiagnosticTitle(run: McpRunSummary | null): string {
  if (!run) return "Lean kernel status · no Run recorded";
  if (hasAcceptedKernel(run)) return "Lean kernel status · accepted";
  if (run.evidenceState === "unreadable") return "Lean Runner result needs controlled inspection";
  if (run.result?.summary) return `Lean Runner result · ${run.result.summary.status}`;
  return `Lean Runner lifecycle · ${run.state}`;
}

function runnerDiagnosticDetail(run: McpRunSummary | null): string {
  if (!run) return "No isolated Lean Run is recorded for this Attempt. Only a Runner can record compiler diagnostics, a sorry audit, axioms, and kernel acceptance.";
  if (hasAcceptedKernel(run)) return "The recorded signed result passed the network, sorry, axiom, and Lean build checks. Inspect controlled evidence for the complete immutable record.";
  if (run.evidenceState === "unreadable") return "A stored result row could not be normalized and bound to this Run, so Proofweave will not show it as a Lean verdict. Inspect controlled evidence before acting on it.";
  if (run.result?.summary) return "This terminal Runner result is recorded, but it did not meet the accepted Lean gate. A corrected Bundle or a new isolated Run may be required.";
  return "This is lifecycle state only, not a Lean verdict. A terminal signed result must be recorded before kernel, axiom, and sorry checks can count.";
}

function leanGateFor(run: McpRunSummary | null): { state: GateState; detail: string } {
  if (!run) return { state: "waiting", detail: "Requires a fresh runner execution with kernel, axiom, and sorry evidence." };
  if (hasAcceptedKernel(run)) return { state: "passed", detail: "A hash-bound Runner result recorded accepted kernel and all required policy checks." };
  if (run.evidenceState === "unreadable") return { state: "failed", detail: "A stored Runner result could not be safely normalized for this Attempt; inspect controlled evidence and create a new Run if needed." };
  if (run.result?.summary) return { state: "failed", detail: `The recorded Runner ended ${run.result.summary.status} with kernel ${run.result.summary.kernelStatus}; a successful isolated rerun is required.` };
  return { state: "waiting", detail: `Runner is ${run.state}; lifecycle state is not a kernel result.` };
}

function AttemptEventRow({ event }: { event: McpAttemptEvent }) {
  return <li>
    <time dateTime={event.occurredAt}>#{event.sequence}</time>
    <span className={`event-dot ${eventStyle(event.type)}`} aria-hidden="true" />
    <div><strong>{eventLabel(event.type)}</strong><p>{event.message}</p><small>{formatTimestamp(event.occurredAt)}{event.progressPercent === null ? "" : ` · ${event.progressPercent}% reported`}</small></div>
  </li>;
}

function eventLabel(type: McpAttemptEvent["type"]): string {
  const labels: Record<McpAttemptEvent["type"], string> = {
    attempt_created: "Attempt opened",
    authority_renewed: "Agent authority renewed",
    agent_reported: "Agent-reported progress",
    checkpoint_published: "Research checkpoint published",
    bundle_staged: "Signed Artifact Bundle staged",
    attempt_paused: "Attempt paused by owner",
    attempt_resumed: "Attempt resumed by owner",
    attempt_submitted: "Attempt submitted",
    attempt_completed: "Attempt completed",
    attempt_abandoned: "Attempt abandoned by owner",
    attempt_cancelled: "Attempt closed by owner",
  };
  return labels[type];
}

function eventStyle(type: McpAttemptEvent["type"]): "branch" | "evidence" | "check" {
  if (["attempt_created", "authority_renewed", "attempt_paused", "attempt_resumed"].includes(type)) return "branch";
  if (["agent_reported", "checkpoint_published"].includes(type)) return "evidence";
  return "check";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function activeDelegation(profile: DelegationProfile | null) {
  return activeWorkDelegation(profile);
}
