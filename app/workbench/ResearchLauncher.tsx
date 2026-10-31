"use client";

import { SectionTitle, Badge, ActionLink, Button, SectionHeading, Select } from "@/app/components/ui";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type DelegationProfile, type StoredDelegation } from "@/db/repositories/delegation";
import { type WorkbenchCatalogTarget } from "../lib/runner-availability";
import { type McpAttempt } from "@/packages/domain/mcp";
import { closedAlphaAttemptLimits } from "@/packages/domain/attempt-policy.mjs";
import { controlPlaneMaintenanceCopy, type ControlPlaneWriteAvailability } from "../lib/control-plane-write-capability";
import type { ResearchEligibility } from "../lib/research-eligibility";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";
import { RESEARCH_WINDOW_REQUEST_ACCESS_HREF, researchWindowBlockedCopy } from "./ResearchWindowNotice";
import { useI18n } from "@/app/i18n/client";
import { runnerAvailabilityKeys } from "../lib/runner-availability";

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
  writeAvailability,
  eligibility,
}: {
  profile: DelegationProfile | null;
  attempts: readonly McpAttempt[];
  catalogTargets: readonly WorkbenchCatalogTarget[];
  initialTargetSlug: string | null;
  initialParentNodeId: string | null;
  onAttemptReady: (attempt: McpAttempt) => void;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
  writeAvailability: ControlPlaneWriteAvailability;
  eligibility?: ResearchEligibility | null;
}) {
  const { t } = useI18n();
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
  const creationBlockedByWindow = eligibility ? !eligibility.canCreateAttempt : false;
  const connectedAgentAllowed = !eligibility || !connection
    ? true
    : eligibility.agentsAllowed.items.some((agent) => agent.id === connection.agentId && agent.allowed);
  const connectedAgentBlocked = Boolean(eligibility && connection && !connectedAgentAllowed);
  const existingCoverage = eligibility && existing
    ? eligibility.attemptsAllowed.items.find((attempt) => attempt.id === existing.id) ?? null
    : null;
  // An Attempt created after this page rendered is not in the server snapshot.
  // A valid creation window still covers it when this Person and connected
  // Agent are allowed, matching the gate's attempt:write behavior.
  const existingWritable = !eligibility || !existing
    ? true
    : existingCoverage
      ? existingCoverage.covered
      : Boolean(eligibility.window.valid
        && eligibility.window.allowNewAttempts
        && eligibility.personAllowed
        && connectedAgentAllowed);
  const continueBlocked = Boolean(eligibility && existing && !existingWritable);
  const newAttemptBlocked = creationBlockedByWindow || connectedAgentBlocked;
  const launcherBlocked = (newAttemptBlocked && !existing) || continueBlocked;
  const connectedAgentCopy = {
    title: t("researchLauncher.window.agent.title"),
    detail: t("researchLauncher.window.agent.detail"),
  };
  const windowBlocked = eligibility && launcherBlocked
    ? continueBlocked
      ? connectedAgentBlocked
        ? connectedAgentCopy
        : {
          title: t("researchLauncher.window.attempt.title"),
          detail: t("researchLauncher.window.attempt.detail"),
        }
      : connectedAgentBlocked
        ? connectedAgentCopy
        : researchWindowBlockedCopy(eligibility, t)
    : null;

  const start = async () => {
    if (writeAvailability !== "available") {
      setError(controlPlaneMaintenanceCopy(writeAvailability, t).detail);
      return;
    }
    if (continueBlocked) {
      setError(windowBlocked?.detail ?? t("researchLauncher.error.existingWindow"));
      return;
    }
    if (newAttemptBlocked && !existing) {
      setError(windowBlocked?.detail ?? t("researchLauncher.error.newWindow"));
      return;
    }
    if (!target || !delegation || !scope || isStarting || atCapacity) return;
    setError(null);
    setNotice(null);
    if (existing) {
      onAttemptReady(existing);
      activateLocalResearch();
      setNotice(initialParentNodeId ? t("researchLauncher.notice.existingParent") : t("researchLauncher.notice.existing"));
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
        throw new Error(payload?.error?.message ?? t("researchLauncher.error.start"));
      }
      onAttemptReady(payload.attempt as McpAttempt);
      activateLocalResearch();
      setNotice(initialParentNodeId ? t("researchLauncher.notice.readyParent") : t("researchLauncher.notice.ready"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("researchLauncher.error.start"));
    } finally {
      setIsStarting(false);
    }
  };

  return <section className="research-launcher" id="research-launcher" aria-labelledby="research-launcher-title">
    <SectionHeading as="div" className="research-launcher-heading">
      <div>
        <p className="eyebrow">{t("researchLauncher.eyebrow")}</p>
        <SectionTitle id="research-launcher-title">{t("researchLauncher.title")}</SectionTitle>
        <p>{t("researchLauncher.body")}</p>
      </div>
      <Badge className="record-chip">{t("researchLauncher.badge")}</Badge>
    </SectionHeading>

    {entryTarget && (!connection || !delegation || !scope) && <div className="research-entry-context">
      <div>
        <span className="micro-label">{t("researchLauncher.entry.label")}</span>
        <strong>{entryTarget.title}</strong>
        <p>{entryTarget.informalStatement}</p>
      </div>
      <Link href={`/explore/${entryTarget.slug}`}>{t("researchLauncher.entry.inspect")} <span aria-hidden="true">→</span></Link>
    </div>}

    {!isAuthenticated ? <LauncherState
      title={t("researchLauncher.state.signIn.title")}
      detail={t("researchLauncher.state.signIn.detail")}
      href={signInPath}
      action={t("researchLauncher.state.signIn.action")}
    /> : !storageAvailable ? <LauncherState
      title={t("researchLauncher.state.storage.title")}
      detail={t("researchLauncher.state.storage.detail")}
      href="/explore"
      action={t("researchLauncher.state.storage.action")}
    /> : writeAvailability !== "available" ? <LauncherState
      title={controlPlaneMaintenanceCopy(writeAvailability, t).title}
      detail={`${controlPlaneMaintenanceCopy(writeAvailability, t).detail} ${t("researchLauncher.state.maintenanceSuffix")}`}
      href="/explore"
      action={t("researchLauncher.state.maintenanceAction")}
    /> : windowBlocked ? <LauncherState
      title={windowBlocked.title}
      detail={windowBlocked.detail}
      href={RESEARCH_WINDOW_REQUEST_ACCESS_HREF}
      action={t("researchLauncher.state.window.action")}
      external
    /> : !connection ? <LauncherState
      title={t("researchLauncher.state.connect.title")}
      detail={entryTarget ? t("researchLauncher.state.connect.detailTarget", { title: entryTarget.title }) : t("researchLauncher.state.connect.detail")}
      href={integrationHref}
      action={t("researchLauncher.state.connect.action")}
    /> : !delegation || !scope ? <LauncherState
      title={t("researchLauncher.state.delegation.title")}
      detail={entryTarget ? t("researchLauncher.state.delegation.detailTarget", { title: entryTarget.title }) : t("researchLauncher.state.delegation.detail")}
      href={integrationHref}
      action={t("researchLauncher.state.delegation.action")}
    /> : catalogTargets.length === 0 ? <LauncherState
      title={t("researchLauncher.state.catalog.title")}
      detail={t("researchLauncher.state.catalog.detail")}
      href="/explore"
      action={t("researchLauncher.state.catalog.action")}
    /> : <div className="research-launcher-body">
      <label className="research-target-select">{t("researchLauncher.target.label")}
        <Select value={target?.slug ?? ""} onChange={(event) => { setTargetSlug(event.target.value); setNotice(null); setError(null); }} disabled={isStarting}>
          {catalogTargets.map((candidate) => <option value={candidate.slug} key={candidate.id}>{candidate.title} · {candidate.domain}</option>)}
        </Select>
      </label>
      {target && <div className="research-target-summary">
        <div>
          <span className="micro-label">{t("researchLauncher.target.selected")}</span>
          <strong>{target.title}</strong>
          <p>{target.informalStatement}</p>
        </div>
        <div className="research-target-meta">
          <span>{scope === "formalize" ? t("researchLauncher.target.formalization") : t("researchLauncher.target.proof")}</span>
          <span>{target.source.leanToolchain}</span>
          <p className={`research-target-runner is-${target.runnerAvailability.status}`} title={t(runnerAvailabilityKeys[target.runnerAvailability.reason].detail)}>{t(runnerAvailabilityKeys[target.runnerAvailability.reason].label)}</p>
          <Link href={`/explore/${target.slug}`}>{t("researchLauncher.target.inspect")} <span aria-hidden="true">→</span></Link>
        </div>
      </div>}
      {initialParentNodeId && <div className="research-branch-selection">
        <span className="micro-label">{t("researchLauncher.branch.label")}</span>
        <code>{initialParentNodeId}</code>
        <p>{t("researchLauncher.branch.body")}</p>
      </div>}
      <div className="research-launcher-footer">
        <p>{t("researchLauncher.footer.ready", { agent: connection.agentLabel })}</p>
        <Button className="button button-primary" type="button" onClick={() => { void start(); }} disabled={isStarting || atCapacity || (newAttemptBlocked && !existing) || continueBlocked}>
          {isStarting ? t("researchLauncher.footer.starting") : existing ? t("researchLauncher.footer.continue") : atCapacity ? t("researchLauncher.footer.capacity") : t("researchLauncher.footer.start")}
          {!isStarting && !atCapacity && <span aria-hidden="true">→</span>}
        </Button>
      </div>
      {atCapacity && <p className="research-launcher-message is-error" role="alert">{t("researchLauncher.capacity", { max: closedAlphaAttemptLimits.maximumActiveAttemptsPerPerson })}</p>}
      {notice && <p className="research-launcher-message is-success" role="status">{notice}</p>}
      {error && <p className="research-launcher-message is-error" role="alert">{error}</p>}
    </div>}
    <p className="research-launcher-boundary">{t("researchLauncher.boundary")}</p>
  </section>;
}

function LauncherState({ title, detail, href, action, external = false }: {
  title: string;
  detail: string;
  href: string;
  action: string;
  external?: boolean;
}) {
  return <div className="research-launcher-state">
    <div><strong>{title}</strong><p>{detail}</p></div>
    <ActionLink className="button button-primary" href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined}>{action} <span aria-hidden="true">→</span></ActionLink>
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
