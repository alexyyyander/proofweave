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
  isAuthenticated,
  signInPath,
  storageAvailable,
  isRefreshing,
  onRefresh,
}: {
  profile: DelegationProfile | null;
  attempt: McpAttempt | null;
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

  const codexInstruction = researchBrief({ agentLabel: agent.label, attempt });

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

    <ol className="local-agent-steps" aria-label="Local research workflow">
      <li>
        <span>01</span>
        <div><strong>Bounded question</strong><p>{attempt.problemTitle}</p><small>{attempt.delegationScope ?? "formalize"} scope · {agent.label}</small></div>
      </li>
      <li>
        <span>02</span>
        <div><strong>Continue in Codex</strong><p>Open Codex on this computer and paste the ready instruction below. Codex reads this exact Attempt through the local Connector before it works.</p><small>You never need to type an Attempt ID, public key, or API token.</small></div>
      </li>
      <li>
        <span>03</span>
        <div><strong>Share one material milestone</strong><p>Only after a local observable result, ask Codex to show the concise progress message and percentage it proposes. Confirm it before Codex records the signed event.</p><small>Private reasoning remains local; an Agent event is still not Lean verification.</small></div>
      </li>
    </ol>

    <div className="local-agent-actions">
      <div>
        <span className="micro-label">Your next Codex message</span>
        <strong>Continue this Proofweave Attempt in Codex.</strong>
        <p>It names the selected target and tells Codex to request your confirmation before recording provisional progress. Nothing from your private workspace is included.</p>
      </div>
      <div className="local-agent-buttons">
        <button className="button button-primary" type="button" onClick={() => { void copyCodexInstruction(); }}>Copy for Codex</button>
        <button className="workspace-secondary-button" type="button" disabled={isRefreshing} onClick={onRefresh}>{isRefreshing ? "Checking…" : "Check recorded progress"}</button>
        <button className="workspace-secondary-button" type="button" onClick={downloadCodexInstruction}>Download .md</button>
      </div>
    </div>
    {notice && <p className="local-agent-notice" role="status">{notice}</p>}
    <p className="local-agent-boundary">This page cannot access your computer, run Codex, or create Agent progress. Only the connected local Agent can sign a reported milestone; the connection is revocable in Settings and never grants workspace access.</p>
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
    href: "#attempt-queue",
  };
  return {
    title: "Your local research handoff is not ready yet.",
    detail: "Return to the Workspace after completing the required setup step.",
    label: "Return to Workspace",
    href: "/workbench",
  };
}

function researchBrief({ agentLabel, attempt }: { agentLabel: string; attempt: McpAttempt }): string {
  return `# Continue this Proofweave Attempt in Codex

Use the connected Proofweave Research plugin on this computer. This instruction is local-only; it is not an Agent event, Lean result, or contribution receipt.

## Bounded target

- Problem: ${attempt.problemTitle}
- Catalog slug: ${attempt.problemSlug}
- Delegated scope: ${attempt.delegationScope ?? "formalize"}
- Agent label: ${agentLabel}
- Attempt: ${attempt.id}

## Start safely

1. Call \`get_attempt\` for ${attempt.id} before working, then inspect the pinned target and its existing events.
2. Work only in the Lean project and toolchain I control. Keep prompts, reasoning, credentials, and unrelated files local.
3. Do not record progress merely for exploration. Wait for a material local fact such as a checked file, reproducible command outcome, reusable lemma, refuted direction, or prepared evidence bundle.

## Before recording anything

When a material milestone exists, show me the exact concise message and percentage you propose to record. State where the local evidence lives, avoid private reasoning, and do not call \`report_progress\` unless I explicitly confirm. Use a fresh opaque idempotency key after confirmation.

Never call a milestone Lean-verified, independently reviewed, novel, or a Contribution Receipt unless that separate evidence is recorded.
`;
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "research";
}
