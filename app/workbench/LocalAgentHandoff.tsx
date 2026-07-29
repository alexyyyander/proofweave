"use client";

import Link from "next/link";
import { useState } from "react";
import type { DelegationProfile, StoredDelegation } from "@/db/repositories/delegation";
import type { McpAttempt } from "@/packages/domain/mcp";
import { ProductStateBadge } from "../ui";
import {
  controlPlaneMaintenanceCopy,
  type ControlPlaneWriteAvailability,
} from "../lib/control-plane-write-capability";
import { activeAttemptDelegation, activeLocalCodexInstallation, activeWorkDelegation } from "../lib/local-agent-journey";

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
  const active = attempt ? activeAttemptDelegation(profile, attempt) : activeWorkDelegation(profile);
  const connection = activeLocalCodexInstallation(profile, active);
  const agent = active ? profile?.agents.find((candidate) => candidate.id === active.agentId) ?? null : null;
  const [notice, setNotice] = useState<string | null>(null);

  if (!isAuthenticated || !storageAvailable) {
    const state = unavailableState({ active, attempt, isAuthenticated, signInPath, storageAvailable });
    return <section className="local-agent-section local-agent-unavailable" id="local-agent" aria-labelledby="local-agent-title">
      <div className="local-agent-heading">
        <div>
          <p className="eyebrow">Local-first research</p>
          <h2 id="local-agent-title">Keep the work on your computer.</h2>
          <p>Proofweave will only receive reviewable evidence. It never needs your private workspace, model credentials, or raw reasoning.</p>
        </div>
        <ProductStateBadge tone="provisional">Setup needed</ProductStateBadge>
      </div>
      <div className="local-agent-empty">
        <strong>{state.title}</strong>
        <p>{state.detail}</p>
        <Link className="button button-primary" href={state.href}>{state.label} <span aria-hidden="true">→</span></Link>
      </div>
    </section>;
  }

  if (writeAvailability !== "available") {
    const maintenance = controlPlaneMaintenanceCopy(writeAvailability);
    return <section className="local-agent-section local-agent-unavailable" id="local-agent" aria-labelledby="local-agent-title">
      <div className="local-agent-heading">
        <div>
          <p className="eyebrow">Research locally</p>
          <h2 id="local-agent-title">{maintenance.title}</h2>
          <p>{maintenance.detail}</p>
        </div>
        <ProductStateBadge tone="not-deployed">{writeAvailability === "checking" ? "Checking" : "Read only"}</ProductStateBadge>
      </div>
      <div className="local-agent-empty">
        <strong>Your existing research is safe and still readable.</strong>
        <p>Proofweave will not offer a button that appears to submit work while updates are paused.</p>
        <Link className="button button-secondary" href={attempt ? `/explore/${attempt.problemSlug}` : "/explore"}>{attempt ? "View public question" : "Browse public research"} <span aria-hidden="true">→</span></Link>
      </div>
    </section>;
  }

  if (!active || !agent || !attempt) {
    const state = unavailableState({ active, attempt, isAuthenticated, signInPath, storageAvailable });
    return <section className="local-agent-section local-agent-unavailable" id="local-agent" aria-labelledby="local-agent-title">
      <div className="local-agent-heading">
        <div>
          <p className="eyebrow">Local-first research</p>
          <h2 id="local-agent-title">Keep the work on your computer.</h2>
          <p>Proofweave will only receive reviewable evidence. It never needs your private workspace, model credentials, or raw reasoning.</p>
        </div>
        <ProductStateBadge tone="provisional">Setup needed</ProductStateBadge>
      </div>
      <div className="local-agent-empty">
        <strong>{state.title}</strong>
        <p>{state.detail}</p>
        <Link className="button button-primary" href={state.href}>{state.label} <span aria-hidden="true">→</span></Link>
      </div>
    </section>;
  }

  if (!connection) {
    return <section className="local-agent-section local-agent-unavailable" id="local-agent" aria-labelledby="local-agent-title">
      <div className="local-agent-heading">
        <div>
          <p className="eyebrow">Connect Agent</p>
          <h2 id="local-agent-title">Connect this research task to Codex.</h2>
          <p>Your question is saved. Connect the Agent assigned to it before continuing local research.</p>
        </div>
        <ProductStateBadge tone="provisional">Connection needed</ProductStateBadge>
      </div>
      <div className="local-agent-empty">
        <strong>One private approval connects this Agent.</strong>
        <p>No API key, public key, private workspace, or model credentials are pasted into Proofweave.</p>
        <Link className="button button-primary" href="/integrations#codex-beta">Connect Agent <span aria-hidden="true">→</span></Link>
      </div>
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
    setNotice("Codex instruction downloaded. No project file or private reasoning was uploaded.");
  };

  return <section className="local-agent-section" id="local-agent" aria-labelledby="local-agent-title">
    <div className="local-agent-heading">
      <div>
        <p className="eyebrow">Research locally</p>
          <h2 id="local-agent-title">Continue in Codex.</h2>
          <p>Your Lean project, model choice, and unfinished exploration stay on this computer. You decide whether a useful milestone becomes a Proofweave record.</p>
        </div>
        <div className="local-agent-badges">
          <ProductStateBadge tone="available">Agent connected</ProductStateBadge>
      </div>
    </div>

    <div className="local-agent-actions">
      <div>
        <span className="micro-label">Your next step</span>
        <strong>Use “Continue in Codex” above.</strong>
        <p>Codex resumes this question, keeps private work local, and asks before recording progress or sharing evidence.</p>
      </div>
      <div className="local-agent-buttons">
        <button className="workspace-secondary-button" type="button" disabled={isRefreshing} onClick={onRefresh}>{isRefreshing ? "Checking…" : "Check recorded progress"}</button>
      </div>
    </div>
    {notice && <p className="local-agent-notice" role="status">{notice}</p>}
    <details className="local-agent-guide" open={!hasRecordedMilestone}>
      <summary><span>What happens next</span><small>Three clear steps · private by default</small></summary>
      <ol className="local-agent-steps" aria-label="Local research workflow">
        <li>
          <span>01</span>
          <div><strong>Research locally</strong><p>Work on {attempt.problemTitle} in the Lean project you choose.</p><small>Prompts, reasoning, and unfinished files stay on this computer.</small></div>
        </li>
        <li>
          <span>02</span>
          <div><strong>Approve useful evidence</strong><p>Codex shows exactly what it proposes to record or share. Nothing is published until you confirm it.</p><small>File hashes are rechecked after approval; a change stops safely.</small></div>
        </li>
        <li>
          <span>03</span>
          <div><strong>Track verification and credit</strong><p>Approved evidence can be checked by Lean and then reviewed by a different owner.</p><small>A progress record or queued check is not yet verification, independent review, or contribution credit.</small></div>
        </li>
      </ol>
    </details>
    <details className="local-agent-guide">
      <summary><span>Technical details / Copy Codex brief</span><small>Advanced recovery and audit information</small></summary>
      <div className="local-agent-actions">
        <div>
          <span className="micro-label">Bound record</span>
          <strong>{attempt.problemTitle}</strong>
          <p>{agent.label} · {attempt.delegationScope ?? "formalize"} authority · stable record {attempt.id}</p>
        </div>
        <button className="workspace-secondary-button" type="button" onClick={downloadCodexInstruction}>Download technical brief</button>
      </div>
    </details>
    <p className="local-agent-boundary">The website cannot access your computer, run Codex, or read private reasoning. It records only the Agent approval and the progress or evidence you explicitly confirm. Lean verification, independent review, and contribution credit remain separate later results.</p>
  </section>;
}

function unavailableState({
  active,
  attempt,
  isAuthenticated,
  signInPath,
  storageAvailable,
}: {
  active: StoredDelegation | null;
  attempt: McpAttempt | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
}) {
  if (!isAuthenticated) return {
    title: "Sign in before preparing accountable local work.",
    detail: "A local brief is tied to a Person and later needs a scoped, revocable Agent authority.",
    label: "Sign in to begin",
    href: signInPath,
  };
  if (!storageAvailable) return {
    title: "Local handoff is waiting for the account control plane.",
    detail: "Proofweave will not create an untracked local substitute for accountable research work.",
    label: "Browse public research",
    href: "/explore",
  };
  if (!active) return {
    title: "Connect a local Codex before you open accountable work.",
    detail: "The normal browser approval creates the Person key, Agent identity, and short scoped delegation together. No public key needs to be pasted.",
    label: "Install or connect Codex",
    href: "/integrations#codex-beta",
  };
  if (!attempt) return {
    title: "Choose one question before starting local research.",
    detail: "Opening an Attempt pins the public source target and gives your local Agent a bounded brief. It does not upload or run anything.",
    label: "Choose a research target",
    href: "#research-launcher",
  };
  return {
    title: "Your local research handoff is not ready yet.",
    detail: "Return to the Workspace after completing the required setup step.",
    label: "Return to Workspace",
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
2. Once connected to \`https://proofweave-research.yualex031821.chatgpt.site\`, call \`continue_research\` with \`attemptId: "${attempt.id}"\` and \`targetSlug: "${attempt.problemSlug}"\`. The Attempt id is authoritative; the slug is a cross-check. This is read-only recovery: if it reports \`research_connection_mismatch\`, stop and do not create a replacement Attempt.
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
