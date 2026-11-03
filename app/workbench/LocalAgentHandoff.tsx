"use client";

import { SectionTitle, ActionLink, Button, EmptyState, SectionHeading } from "@/app/components/ui";

import { useState } from "react";
import { type DelegationProfile, type StoredDelegation } from "@/db/repositories/delegation";
import { type McpAttempt } from "@/packages/domain/mcp";
import { ProductStateBadge } from "../ui";
import { controlPlaneAvailabilityLabel, controlPlaneMaintenanceCopy, type ControlPlaneWriteAvailability } from "../lib/control-plane-write-capability";
import { attemptIntegrationHref } from "../lib/attempt-integration-href";
import { activeAttemptDelegation, activeLocalCodexInstallation, activeWorkDelegation } from "../lib/local-agent-journey";
import { useI18n } from "@/app/i18n/client";
import type { Translator } from "@/app/i18n/translate";

export function LocalAgentHandoff({
  profile,
  attempt,
  initialParentNodeId,
  isAuthenticated,
  signInPath,
  storageAvailable,
  writeAvailability,
  isRefreshing,
  onRefresh,
}: {
  profile: DelegationProfile | null;
  attempt: McpAttempt | null;
  initialParentNodeId: string | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
  writeAvailability: ControlPlaneWriteAvailability;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const active = attempt ? activeAttemptDelegation(profile, attempt) : activeWorkDelegation(profile);
  const connection = activeLocalCodexInstallation(profile, active);
  const agent = active ? profile?.agents.find((candidate) => candidate.id === active.agentId) ?? null : null;
  const [notice, setNotice] = useState<string | null>(null);

  if (!isAuthenticated || !storageAvailable) {
    const state = unavailableState({ active, attempt, isAuthenticated, signInPath, storageAvailable, t });
    return <section className="local-agent-section local-agent-unavailable" id="local-agent" aria-labelledby="local-agent-title">
      <SectionHeading as="div" className="local-agent-heading">
        <div>
          <p className="eyebrow">{t("localAgent.eyebrow.localFirst")}</p>
          <SectionTitle id="local-agent-title">{t("localAgent.title.keep")}</SectionTitle>
          <p>{t("localAgent.body.keep")}</p>
        </div>
        <ProductStateBadge tone="provisional">{t("localAgent.badge.setup")}</ProductStateBadge>
      </SectionHeading>
      <EmptyState as="div" className="local-agent-empty">
        <strong>{state.title}</strong>
        <p>{state.detail}</p>
        <ActionLink className="button button-primary" href={state.href}>{state.label} <span aria-hidden="true">→</span></ActionLink>
      </EmptyState>
    </section>;
  }

  if (writeAvailability !== "available") {
    const maintenance = controlPlaneMaintenanceCopy(writeAvailability, t);
    return <section className="local-agent-section local-agent-unavailable" id="local-agent" aria-labelledby="local-agent-title">
      <SectionHeading as="div" className="local-agent-heading">
        <div>
          <p className="eyebrow">{t("localAgent.eyebrow.research")}</p>
          <SectionTitle id="local-agent-title">{maintenance.title}</SectionTitle>
          <p>{maintenance.detail}</p>
        </div>
        <ProductStateBadge tone="not-deployed">{controlPlaneAvailabilityLabel(writeAvailability, t)}</ProductStateBadge>
      </SectionHeading>
      <EmptyState as="div" className="local-agent-empty">
        <strong>{t("localAgent.maintenance.safeTitle")}</strong>
        <p>{t("localAgent.maintenance.safeBody")}</p>
        <ActionLink className="button button-secondary" href={attempt ? `/explore/${attempt.problemSlug}` : "/explore"}>{attempt ? t("localAgent.maintenance.viewQuestion") : t("localAgent.maintenance.browse")} <span aria-hidden="true">→</span></ActionLink>
      </EmptyState>
    </section>;
  }

  if (!active || !agent || !attempt) {
    const state = unavailableState({ active, attempt, isAuthenticated, signInPath, storageAvailable, t });
    return <section className="local-agent-section local-agent-unavailable" id="local-agent" aria-labelledby="local-agent-title">
      <SectionHeading as="div" className="local-agent-heading">
        <div>
          <p className="eyebrow">{t("localAgent.eyebrow.localFirst")}</p>
          <SectionTitle id="local-agent-title">{t("localAgent.title.keep")}</SectionTitle>
          <p>{t("localAgent.body.keep")}</p>
        </div>
        <ProductStateBadge tone="provisional">{t("localAgent.badge.setup")}</ProductStateBadge>
      </SectionHeading>
      <EmptyState as="div" className="local-agent-empty">
        <strong>{state.title}</strong>
        <p>{state.detail}</p>
        <ActionLink className="button button-primary" href={state.href}>{state.label} <span aria-hidden="true">→</span></ActionLink>
      </EmptyState>
    </section>;
  }

  if (!connection) {
    return <section className="local-agent-section local-agent-unavailable" id="local-agent" aria-labelledby="local-agent-title">
      <SectionHeading as="div" className="local-agent-heading">
        <div>
          <p className="eyebrow">{t("localAgent.connect.eyebrow")}</p>
          <SectionTitle id="local-agent-title">{t("localAgent.connect.title")}</SectionTitle>
          <p>{t("localAgent.connect.body")}</p>
        </div>
        <ProductStateBadge tone="provisional">{t("localAgent.badge.connection")}</ProductStateBadge>
      </SectionHeading>
      <EmptyState as="div" className="local-agent-empty">
        <strong>{t("localAgent.connect.strong")}</strong>
        <p>{t("localAgent.connect.body2")}</p>
        <ActionLink className="button button-primary" href={attemptIntegrationHref(attempt)}>{t("localAgent.connect.action")} <span aria-hidden="true">→</span></ActionLink>
      </EmptyState>
    </section>;
  }

  const codexInstruction = buildCodexResearchBrief({ agentLabel: agent.label, attempt, parentNodeId: initialParentNodeId });
  const hasRecordedMilestone = attempt.events.some((event) => event.type === "agent_reported" || event.type === "bundle_staged");

  const downloadCodexInstruction = () => {
    const blob = new Blob([codexInstruction], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `proofweave-${safeFilename(attempt.problemSlug)}-codex-brief.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice(t("localAgent.notice.downloaded"));
  };

  return <section className="local-agent-section" id="local-agent" aria-labelledby="local-agent-title">
    <SectionHeading as="div" className="local-agent-heading">
      <div>
        <p className="eyebrow">{t("localAgent.eyebrow.research")}</p>
          <SectionTitle id="local-agent-title">{t("localAgent.connected.title")}</SectionTitle>
          <p>{t("localAgent.connected.body")}</p>
        </div>
        <div className="local-agent-badges">
          <ProductStateBadge tone="available">{t("localAgent.connected.badge")}</ProductStateBadge>
      </div>
    </SectionHeading>

    <div className="local-agent-actions">
      <div>
        <span className="micro-label">{t("localAgent.next.label")}</span>
        <strong>{t("localAgent.next.strong")}</strong>
        <p>{t("localAgent.next.body")}</p>
      </div>
      <div className="local-agent-buttons">
        <Button className="workspace-secondary-button" type="button" disabled={isRefreshing} onClick={onRefresh}>{isRefreshing ? t("localAgent.next.checking") : t("localAgent.next.check")}</Button>
      </div>
    </div>
    {notice && <p className="local-agent-notice" role="status">{notice}</p>}
    <details className="local-agent-guide" open={!hasRecordedMilestone}>
      <summary><span>{t("localAgent.guide.title")}</span><small>{t("localAgent.guide.subtitle")}</small></summary>
      <ol className="local-agent-steps" aria-label={t("localAgent.guide.title")}>
        <li>
          <span>01</span>
          <div><strong>{t("localAgent.step1.title")}</strong><p>{t("localAgent.step1.body", { title: attempt.problemTitle })}</p><small>{t("localAgent.step1.small")}</small></div>
        </li>
        <li>
          <span>02</span>
          <div><strong>{t("localAgent.step2.title")}</strong><p>{t("localAgent.step2.body")}</p><small>{t("localAgent.step2.small")}</small></div>
        </li>
        <li>
          <span>03</span>
          <div><strong>{t("localAgent.step3.title")}</strong><p>{t("localAgent.step3.body")}</p><small>{t("localAgent.step3.small")}</small></div>
        </li>
      </ol>
    </details>
    <details className="local-agent-guide">
      <summary><span>{t("localAgent.audit.title")}</span><small>{t("localAgent.audit.subtitle")}</small></summary>
      <div className="local-agent-actions">
        <div>
          <span className="micro-label">{t("localAgent.bound.label")}</span>
          <strong>{attempt.problemTitle}</strong>
          <p>{t("localAgent.bound.authority", { agent: agent.label, scope: attempt.delegationScope ?? t("localAgent.bound.scopeFallback"), id: attempt.id })}</p>
        </div>
        <Button className="workspace-secondary-button" type="button" onClick={downloadCodexInstruction}>{t("localAgent.download")}</Button>
      </div>
    </details>
    <p className="local-agent-boundary">{t("localAgent.boundary")}</p>
  </section>;
}

function unavailableState({
  active,
  attempt,
  isAuthenticated,
  signInPath,
  storageAvailable,
  t,
}: {
  active: StoredDelegation | null;
  attempt: McpAttempt | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
  t: Translator;
}) {
  if (!isAuthenticated) return {
    title: t("localAgent.unavailable.signIn.title"),
    detail: t("localAgent.unavailable.signIn.detail"),
    label: t("localAgent.unavailable.signIn.action"),
    href: signInPath,
  };
  if (!storageAvailable) return {
    title: t("localAgent.unavailable.storage.title"),
    detail: t("localAgent.unavailable.storage.detail"),
    label: t("localAgent.unavailable.storage.action"),
    href: "/explore",
  };
  if (!active) return {
    title: t("localAgent.unavailable.noActive.title"),
    detail: t("localAgent.unavailable.noActive.detail"),
    label: t("localAgent.unavailable.noActive.action"),
    href: attempt ? attemptIntegrationHref(attempt) : "/integrations#codex-beta",
  };
  if (!attempt) return {
    title: t("localAgent.unavailable.noAttempt.title"),
    detail: t("localAgent.unavailable.noAttempt.detail"),
    label: t("localAgent.unavailable.noAttempt.action"),
    href: "#research-launcher",
  };
  return {
    title: t("localAgent.unavailable.notReady.title"),
    detail: t("localAgent.unavailable.notReady.detail"),
    label: t("localAgent.unavailable.notReady.action"),
    href: "/workbench",
  };
}

export function buildCodexResearchBrief({ agentLabel, attempt, parentNodeId }: { agentLabel: string; attempt: McpAttempt; parentNodeId: string | null }): string {
  return `# Continue this Proofweave Attempt in Codex

Use the Proofweave Research plugin on this computer. This instruction is local-only; it is not an Agent event, Lean result, or contribution receipt.

## Bounded target

- Problem: ${attempt.problemTitle}
- Catalog slug: ${attempt.problemSlug}
- Delegated scope: ${attempt.delegationScope ?? "formalize"}
- Agent label: ${agentLabel}
- Attempt: ${attempt.id}
${parentNodeId ? `- Selected parent checkpoint: ${parentNodeId}` : "- Selected parent checkpoint: none — inspect the graph before choosing whether to open or continue a branch"}

## Start safely

1. Call \`connection_status\`. If it reports disconnected, a different \`baseUrl\`, or \`reconnectRequired\`, stop and ask for my approval before calling \`connect_proofweave\` with role \`research\`.
2. Once connected to \`https://proofweave.org\`, call \`continue_research\` with \`attemptId: "${attempt.id}"\` and \`targetSlug: "${attempt.problemSlug}"\`. The Attempt id is authoritative; the slug is a cross-check. This is read-only recovery: if it reports \`research_connection_mismatch\`, stop and do not create a replacement Attempt.
3. Confirm that the resumed target is ${attempt.problemTitle}, then call \`inspect_research_graph\` for ${attempt.problemSlug} before working. If that operation is unavailable, report a plugin or gateway version mismatch and stop rather than guessing a branch.
${parentNodeId ? `4. Confirm that ${parentNodeId} is still visible on this exact problem revision, and treat it as the intended parent of the next public milestone.` : "4. Decide with me whether the next material milestone is an independent starting point or derives from one or more existing checkpoint nodes."}
5. Work only in the Lean project and toolchain I control. Keep prompts, reasoning, credentials, and unrelated files local.
6. Do not record progress merely for exploration. Wait for a material local fact such as a checked file, reproducible command outcome, reusable lemma, refuted direction, or prepared evidence bundle.

## Before recording anything

When a material milestone exists, show me the exact concise message and percentage you propose to record. State where the local evidence lives, avoid private reasoning, and do not call \`report_progress\` unless I explicitly confirm. Use a fresh opaque idempotency key after confirmation.

For a milestone that should join the public branch graph, call \`prepare_research_checkpoint\` first with the correct kind, concise summary, explicit parent node IDs, and any already imported historical citations. This signs a draft locally and publishes nothing. Show me the exact checkpoint hash, summary, parents, and citations. Only after I approve that exact draft, call \`publish_prepared_research_checkpoint\` with \`ownerConfirmation: "I_CONFIRM_PUBLISH_CHECKPOINT"\`. The result is public \`shared_unverified\` progress—not Lean verification, novelty, review, contribution credit, or a Receipt.

## Prepare one complete Bundle locally

Ask me to choose one local Git/Lean workspace root and the relative Lean \`entryFile\` to reproduce. Before reading it, tell me that the current one-click alpha will inspect only that selected workspace locally, create temporary evidence files outside it, and upload nothing. After I explicitly approve, call \`prepare_workspace_bundle_v2\` with \`ownerConfirmation: "I_CONFIRM_PREPARE_WORKSPACE_BUNDLE"\`.

This standard path prepares \`source.tar.zst\`, \`normalized.patch\`, \`lake-manifest.json\`, and the final regular-file tree itself. It accepts a Git workspace with modifications to existing tracked text files only; it intentionally stops rather than guessing how to package new, deleted, renamed, binary, symlinked, or untracked files. If it stops, explain the reason and use the advanced three-artifact flow only after I explicitly select those exact files.

Show me the returned manifest hash and the exact three-file name, byte-size, and SHA-256 list. Make clear that the draft is a local, signed description of reproducible evidence—not a Lean result, review, or contribution receipt.

## Submit that exact Bundle only with my final confirmation

Only after I explicitly approve that exact manifest, file list, and isolated Run request, call \`submit_prepared_research_submission\` with the unchanged Bundle, its matching \`expectedArtifactSha256\` object, matching \`expectedBundleHash\`, one fresh opaque \`runIdempotencyKey\`, and \`ownerConfirmation: "I_CONFIRM_STAGE_AND_RUN"\`. It must re-read and re-check all three local files and the local Agent signature before sending bytes. If a hash, target, environment, or signature changed, stop and prepare a fresh Bundle.

If it returns \`bundle_staged_run_requested\`, poll only the returned exact Attempt/Run pair. A queued Run is not a Lean result. If it returns \`bundle_staged_run_not_requested\`, the immutable Bundle is already safe: retry only \`request_runner_run\` later with the returned Attempt, Bundle hash, and the same idempotency key; do not upload the Bundle again.

Never call a milestone Lean-verified, independently reviewed, novel, or a Contribution Receipt unless that separate evidence is recorded.
`;
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "research";
}
