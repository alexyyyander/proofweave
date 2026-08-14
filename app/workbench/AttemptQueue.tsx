"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DelegationProfile, StoredDelegation } from "@/db/repositories/delegation";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt } from "@/packages/domain/mcp";
import { closedAlphaAttemptLimits } from "@/packages/domain/attempt-policy.mjs";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";

type AttemptScope = "formalize" | "prove";

export function AttemptQueue({
  profile,
  attempts,
  catalogTargets,
  initialTargetSlug,
  onAttemptCreated,
  isAuthenticated,
  signInPath,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  attempts: readonly McpAttempt[];
  catalogTargets: readonly CatalogProblem[];
  initialTargetSlug: string | null;
  onAttemptCreated: (attempt: McpAttempt) => void;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
}) {
  const connection = useMemo(() => activeLocalCodexInstallation(profile), [profile]);
  const eligibleDelegations = useMemo(() => activeWorkDelegations(profile).filter((delegation) =>
    connection !== null &&
    delegation.agentId === connection.agentId &&
    delegation.id === connection.delegationCertificateId,
  ), [connection, profile]);
  const [requestedTargetSlug, setRequestedTargetSlug] = useState(initialTargetSlug ?? "");
  const [requestedScope, setRequestedScope] = useState<AttemptScope>("prove");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedDelegation = eligibleDelegations[0] ?? null;
  const selectedTarget = catalogTargets.find((candidate) => candidate.slug === requestedTargetSlug) ?? catalogTargets[0] ?? null;
  const allowedScopes = selectedDelegation ? workScopes(selectedDelegation) : [];
  const scope = allowedScopes.includes(requestedScope) ? requestedScope : allowedScopes[0] ?? "prove";
  const activeAttemptCount = attempts.filter((candidate) => candidate.status === "active").length;
  const atAttemptCapacity = activeAttemptCount >= closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson;

  const openAttempt = async () => {
    if (!selectedDelegation || !selectedTarget || !allowedScopes.includes(scope) || isSubmitting || atAttemptCapacity) return;
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/me/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problemSlug: selectedTarget.slug,
          delegationCertificateId: selectedDelegation.id,
          delegationScope: scope,
          idempotencyKey: `workbench-attempt:${crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.attempt) {
        throw new Error(payload?.error?.message ?? "The work queue could not open this Attempt.");
      }
      const attempt = payload.attempt as McpAttempt;
      onAttemptCreated(attempt);
      setNotice("Durable Attempt opened. It is an owner-created workspace, not an Agent work event or a verified result.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The work queue could not open this Attempt.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return <section className="attempt-queue" id="attempt-queue" aria-labelledby="attempt-queue-title">
    <div className="attempt-queue-heading">
      <div>
        <p className="eyebrow">Closed-alpha work queue</p>
        <h2 id="attempt-queue-title">Open a durable research Attempt.</h2>
        <p>Choose a source-pinned frontier target for your approved local Agent. This records only an owner-created workspace; a running Connector verifies the saved website address before any later Agent progress can arrive.</p>
      </div>
      <span className="record-chip">Provisional only</span>
    </div>

    {!isAuthenticated ? <div className="attempt-queue-empty">
      <strong>Sign in to open accountable work.</strong>
      <p>A durable Attempt is owned by the signed-in Person and bound to one of that Person’s active Agent delegations.</p>
      <Link className="button button-primary" href={signInPath}>Sign in to your workspace</Link>
    </div> : !storageAvailable ? <div className="attempt-queue-empty">
      <strong>Work queue temporarily unavailable.</strong>
      <p>Delegated Attempt records require the closed-alpha D1 control plane. No local fallback is used for accountable work.</p>
    </div> : catalogTargets.length === 0 ? <div className="attempt-queue-empty">
      <strong>Frontier catalog temporarily unavailable.</strong>
      <p>No durable Attempt can be opened until a source-pinned public frontier target is available. Proofweave does not fall back to preview data for accountable work.</p>
      <Link className="quiet-action" href="/explore">Browse the public catalog</Link>
    </div> : !connection ? <div className="attempt-queue-empty">
      <strong>Connect local Codex before opening accountable work.</strong>
      <p>The normal browser approval creates the local Agent identity and its scoped authority together. No public key needs to be pasted here.</p>
      <Link className="quiet-action" href="/integrations#codex-beta">Install or connect Codex</Link>
    </div> : eligibleDelegations.length === 0 ? <div className="attempt-queue-empty">
      <strong>Your local connection needs an active work delegation.</strong>
      <p>Reconnect the same local Agent. Proofweave reuses compatible authority when possible, or records renewed authority without replacing any stable Attempt id.</p>
      <Link className="quiet-action" href="/integrations#codex-beta">Reconnect local Codex</Link>
    </div> : <div className="attempt-queue-grid">
      <form className="attempt-open-form" onSubmit={(event) => { event.preventDefault(); void openAttempt(); }}>
        <label>Public frontier target
          <select value={selectedTarget?.slug ?? ""} onChange={(event) => { setRequestedTargetSlug(event.target.value); setNotice(null); setError(null); }} disabled={isSubmitting}>
            {catalogTargets.map((candidate) => <option value={candidate.slug} key={candidate.id}>{candidate.title} · {candidate.domain}</option>)}
          </select>
        </label>
        {selectedTarget && <div className="attempt-target"><span className="micro-label">Selected catalog target</span><strong>{selectedTarget.title}</strong><code>{selectedTarget.slug} · {selectedTarget.source.revisionTag} · {selectedTarget.source.leanToolchain}</code><p>{selectedTarget.informalStatement}</p><Link className="text-link" href={`/explore/${selectedTarget.slug}`}>Inspect pinned source target <span>→</span></Link></div>}
        <div className="attempt-target">
          <span className="micro-label">Connected Agent authority</span>
          <strong>{connection.agentLabel}</strong>
          <code>{selectedDelegation?.id ?? "Authority unavailable"} · {allowedScopes.join(", ")}</code>
          <p>This Attempt will be bound to the local Agent you approved in Codex. Change or revoke that connection in Settings.</p>
        </div>
        <label>Bounded work scope
          <select value={scope} onChange={(event) => setRequestedScope(event.target.value as AttemptScope)} disabled={isSubmitting}>
            {allowedScopes.map((candidate) => <option value={candidate} key={candidate}>{candidate}</option>)}
          </select>
        </label>
        <p className="attempt-form-note">Agent label and certificate binding are derived server-side. Opening work does not report mathematical progress. Closed alpha permits at most {closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson} active Attempts per Person, regardless of Agent count.</p>
        <button className="button button-primary" type="submit" disabled={isSubmitting || atAttemptCapacity}>{isSubmitting ? "Opening Attempt…" : atAttemptCapacity ? "Active Attempt capacity reached" : "Open durable Attempt"}</button>
        {atAttemptCapacity && <p className="attempt-message attempt-message-error" role="alert">This Person has reached the closed-alpha active Attempt capacity. Existing work must become terminal before another Attempt can open.</p>}
        {notice && <p className="attempt-message attempt-message-success" role="status">{notice}</p>}
        {error && <p className="attempt-message attempt-message-error" role="alert">{error}</p>}
      </form>
      <div className="attempt-list-panel">
        <div className="attempt-list-heading"><span className="micro-label">Your durable Attempts</span><span>{attempts.length === 0 ? "None yet" : `${activeAttemptCount}/${closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson} active`}</span></div>
        {attempts.length === 0 ? <p className="attempt-list-empty">No durable Attempt has been opened for this Person. Open one to create the first accountable activity record.</p> : <ol className="attempt-list">
          {attempts.slice(0, 6).map((attempt) => <li key={attempt.id}>
            <div><strong>{attempt.problemTitle}</strong><code>{attempt.id}</code></div>
            <div className="attempt-metadata"><span>{attempt.agentLabel}</span><span>{attempt.delegationScope ?? "legacy authority"}</span><span>{attempt.lastProgressPercent === null ? "No Agent-reported progress" : `${attempt.lastProgressPercent}% agent-reported`}</span></div>
            <p>{attempt.events.at(-1)?.message ?? "Attempt event unavailable."}</p>
            <small>Updated {formatTime(attempt.updatedAt)} · {attempt.verificationState.replaceAll("_", " ")}</small>
          </li>)}
        </ol>}
      </div>
    </div>}
    <p className="attempt-queue-boundary">This queue never produces a Lean kernel result, an independent review, or a Contribution Receipt. Those require their own evidence and authorization gates.</p>
  </section>;
}

function activeWorkDelegations(profile: DelegationProfile | null): StoredDelegation[] {
  const now = Date.now();
  return (profile?.delegations ?? []).filter((candidate) =>
    candidate.revokedAt === null &&
    candidate.signerKeyRevokedAt === null &&
    profile?.agents.some((agent) => agent.id === candidate.agentId && agent.status === "active" && agent.revokedAt === null) &&
    Date.parse(candidate.validFrom) <= now &&
    now < Date.parse(candidate.validUntil) &&
    workScopes(candidate).length > 0,
  );
}

function workScopes(delegation: StoredDelegation): AttemptScope[] {
  return delegation.scopes.filter(isWorkScope);
}

function isWorkScope(scope: string): scope is AttemptScope {
  return scope === "formalize" || scope === "prove";
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown time" : new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
