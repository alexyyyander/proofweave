"use client";

import Link from "next/link";
import { useState } from "react";
import type { DelegationProfile, StoredDelegation } from "@/db/repositories/delegation";
import type { McpAttempt } from "@/packages/domain/mcp";
import { ProductStateBadge } from "../ui";

export function LocalAgentHandoff({
  profile,
  attempt,
  isAuthenticated,
  signInPath,
  storageAvailable,
}: {
  profile: DelegationProfile | null;
  attempt: McpAttempt | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
}) {
  const active = activeWorkDelegation(profile);
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

  const brief = researchBrief({ agentLabel: agent.label, attempt });

  const copyBrief = async () => {
    try {
      await navigator.clipboard.writeText(brief);
      setNotice("Research brief copied. Paste it into the local Codex or Agent session you want to use.");
    } catch {
      setNotice("Your browser could not copy the brief. Download it instead, then open it from your local workspace.");
    }
  };

  const downloadBrief = () => {
    const blob = new Blob([brief], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `proofweave-${safeFilename(attempt.problemSlug)}-brief.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setNotice("Research brief downloaded. No project file or private reasoning was uploaded.");
  };

  return <section className="local-agent-section" id="local-agent" aria-labelledby="local-agent-title">
    <div className="local-agent-heading">
      <div>
        <p className="eyebrow">Local-first research</p>
        <h2 id="local-agent-title">Send a bounded brief to your own Agent.</h2>
        <p>Your Lean project, model choice, and private exploration stay on this computer. Proofweave gives your Agent a precise target and later asks you to review any evidence before it leaves the device.</p>
      </div>
      <div className="local-agent-badges">
        <ProductStateBadge tone="available">Authority ready</ProductStateBadge>
        <ProductStateBadge tone="not-deployed">Secure sync in preparation</ProductStateBadge>
      </div>
    </div>

    <ol className="local-agent-steps" aria-label="Local research workflow">
      <li>
        <span>01</span>
        <div><strong>Bounded question</strong><p>{attempt.problemTitle}</p><small>{attempt.delegationScope ?? "formalize"} scope · {agent.label}</small></div>
      </li>
      <li>
        <span>02</span>
        <div><strong>Work locally</strong><p>Open your Lean workspace and hand this brief to Codex or another Agent you control.</p><small>No automatic command is run from this page.</small></div>
      </li>
      <li>
        <span>03</span>
        <div><strong>Review before sharing</strong><p>When secure sync opens, Proofweave will show the exact patch, manifest, and checks before any submission.</p><small>Private reasoning remains local by default.</small></div>
      </li>
    </ol>

    <div className="local-agent-actions">
      <div>
        <span className="micro-label">Research brief</span>
        <strong>Ready for your local Agent</strong>
        <p>Contains the selected catalog target, bounded scope, and evidence boundary—nothing from your private workspace.</p>
      </div>
      <div className="local-agent-buttons">
        <button className="button button-primary" type="button" onClick={() => { void copyBrief(); }}>Copy brief</button>
        <button className="workspace-secondary-button" type="button" onClick={downloadBrief}>Download .md</button>
      </div>
    </div>
    {notice && <p className="local-agent-notice" role="status">{notice}</p>}
    <p className="local-agent-boundary">This page does not connect to your computer, run Codex, or upload files. The future OAuth connection will be a separate, revocable approval.</p>
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
    title: "Prepare Agent authority once, then keep working locally.",
    detail: "Create a device signing key, register the public half of your Agent key, and grant only the scope you intend to use.",
    label: "Set up your Agent",
    href: "/settings#delegation-setup",
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

function activeWorkDelegation(profile: DelegationProfile | null): StoredDelegation | null {
  const now = Date.now();
  return profile?.delegations.find((delegation) =>
    delegation.revokedAt === null &&
    delegation.signerKeyRevokedAt === null &&
    Date.parse(delegation.validFrom) <= now &&
    now < Date.parse(delegation.validUntil) &&
    delegation.scopes.some((scope) => scope === "formalize" || scope === "prove") &&
    profile.agents.some((agent) => agent.id === delegation.agentId && agent.status === "active" && agent.revokedAt === null),
  ) ?? null;
}

function researchBrief({ agentLabel, attempt }: { agentLabel: string; attempt: McpAttempt }): string {
  return `# Proofweave local research brief

This is an owner-created local research brief. It is not an Agent event, a Lean result, or a contribution receipt.

## Bounded target

- Problem: ${attempt.problemTitle}
- Catalog slug: ${attempt.problemSlug}
- Delegated scope: ${attempt.delegationScope ?? "formalize"}
- Agent label: ${agentLabel}
- Attempt: ${attempt.id}

## Local working agreement

1. Work only in the Lean project and toolchain you control.
2. Keep private prompts, reasoning, credentials, and unrelated source files local.
3. Record a small reproducible patch, relevant manifests, and the exact Lean command when you have something worth reviewing.
4. Do not describe a theorem as verified unless an isolated kernel check and the required review have actually been recorded.

## Future evidence handoff

When Proofweave secure sync is available, review the proposed evidence package before submitting it. The default package should be the smallest reproducible proof patch and its checks, not a copy of your whole workspace.
`;
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "research";
}
