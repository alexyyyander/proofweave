import Link from "next/link";
import type { DelegationProfile } from "@/db/repositories/delegation";
import type { McpAttempt, McpAttemptEvent, McpRunSummary } from "@/packages/domain/mcp";
import type { ProvisionalContribution } from "@/db/repositories/provisional-contributions";

type GateState = "passed" | "waiting" | "required" | "failed";

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
  const status = active ? "Delegation active" : profile ? "Agent setup required" : isAuthenticated ? "Profile unavailable" : "Sign in required";
  const activityLabel = !storageAvailable
    ? "Control plane unavailable"
    : attemptCount > 0
      ? `${attemptCount} durable Attempt${attemptCount === 1 ? "" : "s"} recorded`
      : active
        ? "Ready to open an Attempt"
        : "No active Agent authority";
  const marker = profile ? "Account connected" : isAuthenticated ? "Connection unavailable" : "Account required";

  return <section className="workbench-hero" aria-labelledby="workbench-title">
    <div>
      <p className="eyebrow">Personal workspace <span className="preview-marker">{marker}</span></p>
      <h1 id="workbench-title">Your research agent</h1>
      <p>Open accountable work, inspect the evidence that exists, and see the exact gate that must be met next.</p>
    </div>
    <div className="agent-identity-card">
      <div className="agent-identity-top"><span className={active ? "agent-live" : "agent-paused"}><i aria-hidden="true" />{activityLabel}</span><span className="record-chip">{status}</span></div>
      <strong>{agent?.label ?? "No delegated Agent selected"}</strong>
      <code>{agent?.id ?? "Create a signing key, Agent, and scoped delegation to begin."}</code>
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
  attempts,
  isAuthenticated,
  signInPath,
  storageAvailable,
  isRefreshing,
  refreshError,
  refreshedAt,
  onRefresh,
}: {
  profile: DelegationProfile | null;
  attempts: readonly McpAttempt[];
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
  isRefreshing: boolean;
  refreshError: string | null;
  refreshedAt: string | null;
  onRefresh: () => void;
}) {
  const latestAttempt = attempts[0] ?? null;
  const action = nextAction({
    active: Boolean(activeDelegation(profile)),
    hasAttempt: Boolean(latestAttempt),
    isAuthenticated,
    signInPath,
    storageAvailable,
  });
  const focusTitle = latestAttempt?.problemTitle ?? "Choose a source-pinned research target.";
  const focusDetail = latestAttempt
    ? `${latestAttempt.agentLabel} · ${latestAttempt.delegationScope ?? "legacy"} authority · ${latestAttempt.status}`
    : "An Attempt is a bounded, durable workspace—not a claim that a proof has been found.";

  return <section className="focus-layout" aria-label="Current focus and next action">
    <div className="focus-summary">
      <span className="micro-label">Current focus</span>
      <h2>{focusTitle}</h2>
      <p>{focusDetail}</p>
      <div className="toolbar-links">
        {latestAttempt && <Link className="text-link" href={`/explore/${latestAttempt.problemSlug}`}>Inspect target <span>→</span></Link>}
        <Link className="text-link" href="#provisional-ledger">Provisional ledger <span>→</span></Link>
        <Link className="text-link" href="/evidence">Evidence records <span>→</span></Link>
        <Link className="text-link" href="/reviews">Review queue <span>→</span></Link>
        <Link className="text-link" href="/integrations">Connection status <span>→</span></Link>
      </div>
    </div>
    <div className="next-action-card">
      <span className="micro-label">Recommended next action</span>
      <strong>{action.title}</strong>
      <p id="next-action-help">{action.detail}</p>
      <div className="next-action-controls">
        <Link className="button button-primary focus-primary" href={action.href}>{action.label}</Link>
        {latestAttempt && <Link className="workspace-pause-button" href="#attempt-activity">Inspect recorded activity</Link>}
        {latestAttempt && <button className="workspace-secondary-button" type="button" disabled={isRefreshing} onClick={onRefresh}>{isRefreshing ? "Refreshing records…" : "Refresh records"}</button>}
      </div>
      {refreshedAt && <p className="activity-refresh-status" role="status">Records refreshed {formatTimestamp(refreshedAt)}.</p>}
      {refreshError && <p className="activity-refresh-error" role="alert">{refreshError}</p>}
    </div>
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
      <div><p className="eyebrow">Immediate evidence record</p><h2 id="provisional-ledger-title">Provisional contribution ledger</h2><p>Each entry records an attributable signed Bundle. It is not a theorem, Lean result, novelty finding, independent review, or final Contribution Receipt.</p></div>
      <span className={ledgerAvailable ? "record-chip" : "record-chip provisional-unavailable"}>{ledgerAvailable ? `${contributions.length} record${contributions.length === 1 ? "" : "s"}` : "Migration required"}</span>
    </div>
    {!ledgerAvailable ? <div className="provisional-ledger-unavailable"><strong>The ledger schema is not active in this control plane.</strong><p>Proofweave will not infer provisional credit from a timeline event. Apply the D1 migration before this owner-visible record can be read.</p></div> : contributions.length > 0 ? <ol className="provisional-ledger-list">{contributions.map((contribution) => <li key={contribution.id}>
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

  return <section className="workstation-grid" aria-label="Research workstation">
    <article className="workstation-panel context-panel">
      <div className="workstation-heading"><span>01 / Bounded Attempt</span><span className="record-chip">{attempt ? attempt.status : "Not opened"}</span></div>
      <h3>{attempt ? attempt.problemTitle : "Open a source-pinned target before starting research work."}</h3>
      <p className="context-statement">{attempt ? "This workspace is bound to one catalog revision and one delegated Agent authority. It does not imply progress or verification." : "Proofweave shows no invented research branch before a durable Attempt has been opened."}</p>
      <dl className="context-list">{attempt ? <>
        <div><dt>Catalog target</dt><dd><Link href={`/explore/${attempt.problemSlug}`}>{attempt.problemSlug}</Link></dd></div>
        <div><dt>Agent authority</dt><dd>{attempt.agentLabel} · {attempt.delegationScope ?? "legacy authority"}</dd></div>
        <div><dt>Attempt record</dt><dd><code>{attempt.id}</code></dd></div>
      </> : <>
        <div><dt>First requirement</dt><dd>Sign in, issue a scoped delegation, then select a public frontier target.</dd></div>
        <div><dt>Evidence boundary</dt><dd>Only a remote Agent may report signed progress; only the isolated runner may produce Lean evidence.</dd></div>
      </>}</dl>
      <div className="context-footer">{attempt ? <><span>Opened {formatTimestamp(attempt.createdAt)}</span><span>Last updated {formatTimestamp(attempt.updatedAt)}</span></> : <><span>No source snapshot selected</span><span>No Agent activity recorded</span></>}</div>
    </article>
    <article className="workstation-panel source-panel">
      <div className="workstation-heading"><span>02 / Artifact &amp; Lean evidence</span><span className={runnerAccepted ? "source-good" : "source-waiting"}>{runnerAccepted ? "Kernel accepted" : bundleStaged ? "Bundle staged" : "Awaiting bundle"}</span></div>
      <div className="source-state">
        <strong>{runnerAccepted ? "The isolated Lean Runner recorded an accepted kernel result." : bundleStaged ? "A signed Artifact Bundle is staged for this Attempt." : "No Artifact Bundle has been staged."}</strong>
        <p>{runnerAccepted ? "This Runner result satisfies only the Lean execution gate. It is not independent review or a Contribution Receipt." : bundleStaged ? "Open controlled evidence to inspect the hash-bound bundle. Staging alone is not a Lean check or an accepted contribution." : "Proofweave does not render a sample source file or a fictional compiler result in place of Agent-supplied evidence."}</p>
        {attempt && <Link className="text-link source-link" href={evidenceHref}>Open controlled evidence <span>→</span></Link>}
      </div>
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
    </article>
    <article className="workstation-panel run-panel" id="attempt-activity">
      <div className="workstation-heading"><span>03 / Agent events &amp; artifacts</span><span className="record-chip">Structured</span></div>
      <p className="run-lede">Only publication-facing evidence appears here. Private chain-of-thought is never displayed.</p>
      {attempt?.events.length ? <ol className="event-list" aria-live="polite">{attempt.events.map((event) => <AttemptEventRow event={event} key={event.id} />)}</ol> : <p className="event-empty">No Agent activity has been recorded. Opening an Attempt creates the first durable owner event; remote Agent progress is separately authorized.</p>}
      <p className="event-footer">{attempt ? "This timeline records only immutable Attempt events. It is not Lean verification, independent review, or a Contribution Receipt." : "No simulated Agent work is created in this workspace. Open an Attempt to establish a bounded record."}</p>
    </article>
  </section>;
}

export function SubmissionReadiness({ attempt, profile, runs }: { attempt: McpAttempt | null; profile: DelegationProfile | null; runs: readonly McpRunSummary[] }) {
  const hasAgentProgress = Boolean(attempt?.events.some((event) => event.type === "agent_reported"));
  const bundleStaged = Boolean(attempt?.events.some((event) => event.type === "bundle_staged"));
  const connectionActive = Boolean(attempt && profile?.agentInstallations.some((installation) => installation.status === "active" && installation.agentId === attempt.agentId));
  const leanGate = leanGateFor(latestRunForAttempt(attempt, runs));

  return <section className="submission-section" aria-labelledby="submission-title">
    <div className="submission-copy"><p className="eyebrow">Evidence before credit</p><h2 id="submission-title">See every gate before a contribution can count.</h2><p>Proofweave records only evidence that exists. Agent-reported activity, Lean execution, independent review, and a Contribution Receipt remain separate gates.</p></div>
    <div className="submission-card">
      <div className="submission-card-heading"><strong>Contribution path</strong><span>{attempt ? "Attempt selected" : "No Attempt yet"}</span></div>
      <ul className="gate-list">
        <GateRow state={attempt ? "passed" : "waiting"} label="Bounded Attempt" detail={attempt ? "Target and delegated Agent authority are durably bound." : "Open a source-pinned Attempt first."} />
        <GateRow state={hasAgentProgress ? "passed" : "waiting"} label="Agent-reported progress" detail={hasAgentProgress ? "A separately authorized Agent event is recorded." : "Requires the remote OAuth MCP connection; browser clicks cannot create this event."} />
        <GateRow state={bundleStaged ? "passed" : "waiting"} label="Signed Artifact Bundle" detail={bundleStaged ? "A bundle-staged event is recorded; inspect its controlled evidence separately." : "Requires a complete signed bundle from the authorized Agent."} />
        <GateRow state={leanGate.state} label="Isolated Lean result" detail={leanGate.detail} />
        <GateRow state="required" label="Independent review" detail="Must be performed by a different owner." />
      </ul>
      <p className="submission-hint">{connectionActive ? "An active Agent installation is recorded. The remote gateway still controls which operations it may perform." : "No active Agent installation is recorded for this Attempt. Connection approval is separate from delegation."}</p>
      <Link className="button button-primary submit-button" href="/integrations">Review connection status</Link>
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

function nextAction({ active, hasAttempt, isAuthenticated, signInPath, storageAvailable }: { active: boolean; hasAttempt: boolean; isAuthenticated: boolean; signInPath: string; storageAvailable: boolean }) {
  if (!isAuthenticated) return { title: "Sign in to create accountable research work.", detail: "Proofweave creates a Person record only from an authenticated session; no sample identity is used.", label: "Sign in to your workspace", href: signInPath };
  if (!storageAvailable) return { title: "Wait for the control plane to recover.", detail: "No local fallback can create an accountable Attempt while durable storage is unavailable.", label: "Browse public research", href: "/explore" };
  if (!active) return { title: "Create scoped authority before any work can be attributed.", detail: "A Person key, registered Agent, and active formalize or prove delegation are required before an Attempt can open.", label: "Set up delegation", href: "#delegation-setup" };
  if (!hasAttempt) return { title: "Open one durable Attempt for your selected Agent.", detail: "This records a bounded workspace only. It does not impersonate Agent activity or run Lean.", label: "Open a durable Attempt", href: "#attempt-queue" };
  return { title: "Inspect the evidence recorded for the current Attempt.", detail: "The next missing gate is shown below; nothing is marked verified until its own evidence has been recorded.", label: "View Attempt activity", href: "#attempt-activity" };
}

function eventLabel(type: McpAttemptEvent["type"]): string {
  if (type === "attempt_created") return "Attempt opened";
  if (type === "agent_reported") return "Agent-reported progress";
  return "Signed Artifact Bundle staged";
}

function eventStyle(type: McpAttemptEvent["type"]): "branch" | "evidence" | "check" {
  if (type === "attempt_created") return "branch";
  if (type === "agent_reported") return "evidence";
  return "check";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

function activeDelegation(profile: DelegationProfile | null) {
  const now = Date.now();
  return profile?.delegations.find((candidate) =>
    candidate.revokedAt === null &&
    candidate.signerKeyRevokedAt === null &&
    profile.agents.some((agent) => agent.id === candidate.agentId && agent.status === "active" && agent.revokedAt === null) &&
    Date.parse(candidate.validFrom) <= now &&
    now < Date.parse(candidate.validUntil),
  ) ?? null;
}
