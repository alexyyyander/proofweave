"use client";

import Link from "next/link";
import { useState } from "react";
import type { DelegationProfile, StoredDelegation } from "@/db/repositories/delegation";
import type { McpAttempt } from "@/packages/domain/mcp";
import { ProductStateBadge } from "../ui";
import { activeLocalCodexInstallation, activeWorkDelegation } from "../lib/local-agent-journey";

export function LocalAgentHandoff({
  profile,
  attempt,
  initialParentNodeId,
  isAuthenticated,
  signInPath,
  storageAvailable,
  isRefreshing,
  onRefresh,
}: {
  profile: DelegationProfile | null;
  attempt: McpAttempt | null;
  initialParentNodeId: string | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const active = activeWorkDelegation(profile);
  const connection = activeLocalCodexInstallation(profile, active);
  const agent = active ? profile?.agents.find((candidate) => candidate.id === active.agentId) ?? null : null;
  const [notice, setNotice] = useState<string | null>(null);

  if (!isAuthenticated || !storageAvailable || !active || !agent || !attempt) {
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
          <p className="eyebrow">Local-first research</p>
          <h2 id="local-agent-title">Connect this Agent to your local Codex.</h2>
          <p>Your existing delegation is valid, but it has no active local Codex approval. Connect once before using Proofweave’s bounded research tools.</p>
        </div>
        <ProductStateBadge tone="provisional">Connection needed</ProductStateBadge>
      </div>
      <div className="local-agent-empty">
        <strong>Pair a local Agent without sharing a key.</strong>
        <p>The local Connector creates and retains its own private key. Browser approval records only its public identity, short-lived delegation, and revocable connection.</p>
        <Link className="button button-primary" href="/integrations#codex-beta">Install or connect Codex <span aria-hidden="true">→</span></Link>
      </div>
    </section>;
  }

  const codexInstruction = researchBrief({ agentLabel: agent.label, attempt, parentNodeId: initialParentNodeId });
  const hasRecordedMilestone = attempt.events.some((event) => event.type === "agent_reported" || event.type === "bundle_staged");

  const copyCodexInstruction = async () => {
    try {
      await navigator.clipboard.writeText(codexInstruction);
      setNotice("Codex instruction copied. Paste it into the Codex session on this connected computer; it already contains the bound Attempt ID and safe reporting rules.");
    } catch {
      setNotice("Your browser could not copy the Codex instruction. Download it instead, then open it from your local workspace.");
    }
  };

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
        <p className="eyebrow">Local-first research</p>
          <h2 id="local-agent-title">Continue with your connected local Agent.</h2>
          <p>Your Lean project, model choice, and private exploration stay on this computer. Proofweave gives your Agent a precise target and receives only the selected, signed progress you decide to record.</p>
        </div>
        <div className="local-agent-badges">
          <ProductStateBadge tone="available">Authority ready</ProductStateBadge>
          <ProductStateBadge tone="available">Local Codex connected</ProductStateBadge>
      </div>
    </div>

    <div className="local-agent-actions">
      <div>
        <span className="micro-label">Your next Codex message</span>
        <strong>Continue this Proofweave Attempt in Codex.</strong>
        <p>It names the selected target and tells Codex to prepare locally, show exact hashes, and wait for one final confirmation before staging and requesting a Run. Nothing from your private workspace is included.</p>
      </div>
      <div className="local-agent-buttons">
        <button className="button button-primary" type="button" onClick={() => { void copyCodexInstruction(); }}>Copy for Codex</button>
        <button className="workspace-secondary-button" type="button" disabled={isRefreshing} onClick={onRefresh}>{isRefreshing ? "Checking…" : "Check recorded progress"}</button>
        <button className="workspace-secondary-button" type="button" onClick={downloadCodexInstruction}>Download .md</button>
      </div>
    </div>
    {notice && <p className="local-agent-notice" role="status">{notice}</p>}
    <details className="local-agent-guide" open={!hasRecordedMilestone}>
      <summary><span>How this handoff works</span><small>Four bounded steps · no private workspace access</small></summary>
      <ol className="local-agent-steps" aria-label="Local research workflow">
        <li>
          <span>01</span>
          <div><strong>Bounded question</strong><p>{attempt.problemTitle}</p><small>{attempt.delegationScope ?? "formalize"} scope · {agent.label}</small></div>
        </li>
        <li>
          <span>02</span>
          <div><strong>Continue in Codex</strong><p>Open Codex on this computer and paste the ready instruction above. Codex reads this exact Attempt through the local Connector before it works.</p><small>You never need to type an Attempt ID, public key, or API token.</small></div>
        </li>
        <li>
          <span>03</span>
          <div><strong>Share one material milestone</strong><p>After a local observable result, review the concise progress message and percentage before Codex records the signed event.</p><small>Private reasoning remains local; an Agent event is still not Lean verification.</small></div>
        </li>
        <li>
          <span>04</span>
          <div><strong>Prepare, review, then submit</strong><p>Codex shows the signed Bundle manifest and file hashes before one final confirmation stages it and requests an isolated Run.</p><small>A queued Run is operational state only; it is not yet a Lean result, review, or receipt.</small></div>
        </li>
      </ol>
    </details>
    <p className="local-agent-boundary">This page cannot access your computer, run Codex, or create Agent progress. Only the connected local Agent can sign a reported milestone or stage an explicitly confirmed evidence Bundle; the connection is revocable in Settings and never grants workspace access.</p>
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

function researchBrief({ agentLabel, attempt, parentNodeId }: { agentLabel: string; attempt: McpAttempt; parentNodeId: string | null }): string {
  return `# Continue this Proofweave Attempt in Codex

Use the connected Proofweave Research plugin on this computer. This instruction is local-only; it is not an Agent event, Lean result, or contribution receipt.

## Bounded target

- Problem: ${attempt.problemTitle}
- Catalog slug: ${attempt.problemSlug}
- Delegated scope: ${attempt.delegationScope ?? "formalize"}
- Agent label: ${agentLabel}
- Attempt: ${attempt.id}
${parentNodeId ? `- Selected parent checkpoint: ${parentNodeId}` : "- Selected parent checkpoint: none — inspect the graph before choosing whether to open or continue a branch"}

## Start safely

1. Call \`get_attempt\` for ${attempt.id}, then call \`inspect_research_graph\` for ${attempt.problemSlug} before working.
${parentNodeId ? `2. Confirm that ${parentNodeId} is still visible on this exact problem revision, and treat it as the intended parent of the next public milestone.` : "2. Decide with me whether the next material milestone is an independent starting point or derives from one or more existing checkpoint nodes."}
3. Work only in the Lean project and toolchain I control. Keep prompts, reasoning, credentials, and unrelated files local.
4. Do not record progress merely for exploration. Wait for a material local fact such as a checked file, reproducible command outcome, reusable lemma, refuted direction, or prepared evidence bundle.

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
