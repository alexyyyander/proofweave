"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { DelegationProfile, StoredDelegation } from "@/db/repositories/delegation";
import type { CatalogProblem } from "@/packages/domain/catalog";
import type { McpAttempt } from "@/packages/domain/mcp";
import { closedAlphaAttemptLimits } from "@/packages/domain/attempt-policy.mjs";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";

type WorkScope = "formalize" | "prove";

/**
 * The normal research entry point deliberately hides certificate identifiers,
 * idempotency keys, and raw MCP vocabulary. The server still derives and
 * validates every authority binding before an Attempt is opened.
 */
export function ResearchLauncher({
  profile,
  attempts,
  catalogTargets,
  initialTargetSlug,
  initialParentNodeId,
  onAttemptReady,
  isAuthenticated,
  signInPath,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  attempts: readonly McpAttempt[];
  catalogTargets: readonly CatalogProblem[];
  initialTargetSlug: string | null;
  initialParentNodeId: string | null;
  onAttemptReady: (attempt: McpAttempt) => void;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
}) {
  const connection = useMemo(() => activeLocalCodexInstallation(profile), [profile]);
  const delegation = useMemo(() => connectedWorkDelegation(profile, connection?.agentId, connection?.delegationCertificateId), [connection, profile]);
  const [targetSlug, setTargetSlug] = useState(initialTargetSlug ?? "");
  const [isStarting, setIsStarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const target = catalogTargets.find((candidate) => candidate.slug === targetSlug) ?? catalogTargets[0] ?? null;
  const entryTarget = initialTargetSlug
    ? catalogTargets.find((candidate) => candidate.slug === initialTargetSlug) ?? null
    : null;
  const integrationHref = entryTarget
    ? researchIntegrationHref(entryTarget.slug, initialParentNodeId)
    : "/integrations#codex-beta";
  const scope = preferredScope(delegation);
  const activeCount = attempts.filter((attempt) => attempt.status === "active").length;
  const atCapacity = activeCount >= closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson;
  const existing = target && connection && delegation
    ? attempts.find((attempt) =>
      (attempt.status === "active" || attempt.status === "paused") &&
      attempt.problemSlug === target.slug &&
      attempt.agentId === connection.agentId &&
      attempt.delegationScope === scope,
    ) ?? null
    : null;

  const start = async () => {
    if (!target || !delegation || !scope || isStarting || atCapacity) return;
    setError(null);
    setNotice(null);
    if (existing) {
      onAttemptReady(existing);
      activateLocalResearch();
      setNotice(initialParentNodeId
        ? "This research is already active. The local handoff below names the exact shared checkpoint you chose to continue."
        : "This research is already active. In Codex, say “Continue my Proofweave research” to resume the same bounded target.");
      return;
    }

    setIsStarting(true);
    try {
      const response = await fetch("/api/me/attempts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          problemSlug: target.slug,
          delegationCertificateId: delegation.id,
          delegationScope: scope,
          idempotencyKey: `research-launcher:${crypto.randomUUID()}`,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.attempt) {
        throw new Error(payload?.error?.message ?? "Proofweave could not start this research workspace.");
      }
      onAttemptReady(payload.attempt as McpAttempt);
      activateLocalResearch();
      setNotice(initialParentNodeId
        ? "Research is ready. The local handoff below names the exact shared checkpoint you chose to continue."
        : "Research is ready. In Codex, say “Continue my Proofweave research” — the plugin will recover this exact target automatically.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Proofweave could not start this research workspace.");
    } finally {
      setIsStarting(false);
    }
  };

  return <section className="research-launcher" id="research-launcher" aria-labelledby="research-launcher-title">
    <div className="research-launcher-heading">
      <div>
        <p className="eyebrow">Research launcher</p>
        <h2 id="research-launcher-title">Choose a question. Start with your Agent.</h2>
        <p>Proofweave binds the selected source revision to your connected Agent in the background. Your Lean workspace and private exploration stay on this computer.</p>
      </div>
      <span className="record-chip">No files shared</span>
    </div>

    {entryTarget && (!connection || !delegation || !scope) && <div className="research-entry-context">
      <div>
        <span className="micro-label">Your selected research stays here</span>
        <strong>{entryTarget.title}</strong>
        <p>{entryTarget.informalStatement}</p>
      </div>
      <Link href={`/explore/${entryTarget.slug}`}>Inspect target <span aria-hidden="true">→</span></Link>
    </div>}

    {!isAuthenticated ? <LauncherState
      title="Keep the work on your computer."
      detail="Local-first research starts with a private sign-in. Creating an Attempt establishes a Person-owned record for your delegated Agent without uploading a workspace."
      href={signInPath}
      action="Sign in to start"
    /> : !storageAvailable ? <LauncherState
      title="Research setup is temporarily unavailable."
      detail="Proofweave will not substitute an untracked local record while its accountable control plane is unavailable."
      href="/explore"
      action="Browse the frontier"
    /> : !connection ? <LauncherState
      title="Connect Codex once before starting research."
      detail={entryTarget ? `Connect once, then return to start or resume ${entryTarget.title}. Your target will not be discarded.` : "The one-time browser approval creates your local Agent identity and revocable authority. No public key, token, or workspace is pasted into Proofweave."}
      href={integrationHref}
      action="Connect and return"
    /> : !delegation || !scope ? <LauncherState
      title="This local Agent needs an active research delegation."
      detail={entryTarget ? `Reconnect the research authority, then return to ${entryTarget.title}.` : "Reconnect your local Codex to refresh a formalize or prove approval before starting a bounded target."}
      href={integrationHref}
      action="Reconnect Codex"
    /> : catalogTargets.length === 0 ? <LauncherState
      title="The public frontier is temporarily unavailable."
      detail="Proofweave only opens work against a source-pinned public target; it does not fall back to sample mathematics."
      href="/explore"
      action="Browse the catalog"
    /> : <div className="research-launcher-body">
      <label className="research-target-select">Research target
        <select value={target?.slug ?? ""} onChange={(event) => { setTargetSlug(event.target.value); setNotice(null); setError(null); }} disabled={isStarting}>
          {catalogTargets.map((candidate) => <option value={candidate.slug} key={candidate.id}>{candidate.title} · {candidate.domain}</option>)}
        </select>
      </label>
      {target && <div className="research-target-summary">
        <div>
          <span className="micro-label">Selected target</span>
          <strong>{target.title}</strong>
          <p>{target.informalStatement}</p>
        </div>
        <div className="research-target-meta">
          <span>{scope === "formalize" ? "Formalization" : "Proof"}</span>
          <span>{target.source.leanToolchain}</span>
          <Link href={`/explore/${target.slug}`}>Inspect source <span aria-hidden="true">→</span></Link>
        </div>
      </div>}
      {initialParentNodeId && <div className="research-branch-selection">
        <span className="micro-label">Selected branch parent</span>
        <code>{initialParentNodeId}</code>
        <p>Your new public checkpoint can derive from this node. The parent is only declared when you review and approve the locally signed checkpoint draft.</p>
      </div>}
      <div className="research-launcher-footer">
        <p><strong>{connection.agentLabel}</strong> is ready. We record only a provisional Attempt now; progress, evidence, Lean execution, and review remain separate gates.</p>
        <button className="button button-primary" type="button" onClick={() => { void start(); }} disabled={isStarting || atCapacity}>
          {isStarting ? "Starting research…" : existing ? "Continue research" : atCapacity ? "Active research capacity reached" : "Start research"}
          {!isStarting && !atCapacity && <span aria-hidden="true">→</span>}
        </button>
      </div>
      {atCapacity && <p className="research-launcher-message is-error" role="alert">This Person already has the closed-alpha maximum of {closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson} active research workspaces.</p>}
      {notice && <p className="research-launcher-message is-success" role="status">{notice}</p>}
      {error && <p className="research-launcher-message is-error" role="alert">{error}</p>}
    </div>}
    <p className="research-launcher-boundary">Starting research never uploads files, runs Lean, records a theorem, or creates contribution credit.</p>
  </section>;
}

function LauncherState({ title, detail, href, action }: { title: string; detail: string; href: string; action: string }) {
  return <div className="research-launcher-state">
    <div><strong>{title}</strong><p>{detail}</p></div>
    <Link className="button button-primary" href={href}>{action} <span aria-hidden="true">→</span></Link>
  </div>;
}

function connectedWorkDelegation(
  profile: DelegationProfile | null,
  agentId: string | undefined,
  certificateId: string | undefined,
): StoredDelegation | null {
  if (!profile || !agentId || !certificateId) return null;
  const now = Date.now();
  return profile.delegations.find((candidate) =>
    candidate.id === certificateId &&
    candidate.agentId === agentId &&
    candidate.revokedAt === null &&
    candidate.signerKeyRevokedAt === null &&
    Date.parse(candidate.validFrom) <= now &&
    now < Date.parse(candidate.validUntil) &&
    preferredScope(candidate) !== null,
  ) ?? null;
}

function preferredScope(delegation: StoredDelegation | null): WorkScope | null {
  if (!delegation) return null;
  if (delegation.scopes.includes("formalize")) return "formalize";
  if (delegation.scopes.includes("prove")) return "prove";
  return null;
}

function activateLocalResearch() {
  window.setTimeout(() => {
    document.getElementById("local-agent")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 0);
}

function researchIntegrationHref(targetSlug: string, parentNodeId: string | null): string {
  const workbench = new URLSearchParams({ target: targetSlug });
  const integration = new URLSearchParams({ target: targetSlug });
  if (parentNodeId) {
    workbench.set("parent", parentNodeId);
    integration.set("parent", parentNodeId);
  }
  integration.set("return_to", `/workbench?${workbench.toString()}#research-launcher`);
  return `/integrations?${integration.toString()}#codex-beta`;
}
