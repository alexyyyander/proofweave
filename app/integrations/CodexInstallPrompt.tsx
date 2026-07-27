"use client";

import { useState } from "react";

const installationRequest = `Install the Proofweave Research plugin by following the public, auditable instructions at https://proofweave-research.yualex031821.chatgpt.site/codex-install.md.

Use the Proofweave-hosted marketplace archive, not a GitHub checkout. Before changing my computer, show me the local download and marketplace directories plus every command you will run to download the archive and checksum, verify the checksum offline, extract into the local marketplace directory, add that local marketplace to Codex, and install proofweave-research@proofweave-private-beta. Wait for my confirmation. Never pipe downloaded content into a shell.

After it is installed, do not connect Proofweave, create an Agent, or open my private workspace unless I explicitly ask.`;

export function CodexInstallPrompt() {
  const [copied, setCopied] = useState(false);

  async function copyInstallRequest() {
    try {
      await navigator.clipboard.writeText(installationRequest);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="codex-install-prompt">
      <div>
        <span className="micro-label">Ask Codex</span>
        <strong>Let Codex perform the install—with your confirmation.</strong>
        <p>
          Copy one request into a Codex chat. It tells Codex to use the
          checksum-published local marketplace archive, show every command,
          and stop before connecting your account.
        </p>
      </div>
      <div className="codex-install-actions">
        <button className="button button-primary" type="button" onClick={copyInstallRequest}>
          {copied ? "Install request copied" : "Copy request for Codex"}
        </button>
        <a className="text-link" href="/codex-install.md" target="_blank" rel="noreferrer">
          Read the install guide <span>→</span>
        </a>
      </div>
    </div>
  );
}

const roleDescriptions = {
  research: "research",
  review: "independent review",
  research_and_review: "research and independent review",
} as const;

export function CodexConnectPrompt({
  role,
  targetTitle,
  returnHref,
  onRequestCopied,
}: {
  role: keyof typeof roleDescriptions;
  targetTitle?: string;
  returnHref?: string;
  onRequestCopied?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const destination = returnHref
    ? `https://proofweave-research.yualex031821.chatgpt.site${returnHref}`
    : "https://proofweave-research.yualex031821.chatgpt.site/workbench";
  const connectionRequest = `Check Proofweave connection_status first. Connect this Codex to https://proofweave-research.yualex031821.chatgpt.site for ${roleDescriptions[role]}.

If it is disconnected, reconnectRequired, or configured for a different Proofweave address, explain the current and requested connection, then ask for my approval before running connect_proofweave with role ${role}. Do not delete local keys or tokens and do not create an Attempt yet.

After connection succeeds, tell me to return to ${destination}${targetTitle ? ` to continue “${targetTitle}”` : ""}.`;

  async function copyConnectionRequest() {
    try {
      await navigator.clipboard.writeText(connectionRequest);
      setCopied(true);
      onRequestCopied?.();
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return <button className="button button-primary" type="button" onClick={copyConnectionRequest}>
    {copied ? "Request copied" : role === "review" ? "Copy review connection request" : "Copy connection request"}
  </button>;
}

const workflowRequests = {
  research_submission: "Prepare my current Git/Lean workspace as a Proofweave research submission. Keep everything local while preparing it, show me the exact Bundle manifest hash and three file hashes, and wait for my approval before uploading or requesting an isolated Run.",
  review_queue: "Show my Proofweave independent-review assignments. Use list_review_assignments, summarize the target, claim, status, and exact-Agent replay state, then wait for me to choose one before inspecting or running anything.",
} as const;

export function CodexWorkflowPrompt({ workflow }: { workflow: keyof typeof workflowRequests }) {
  const [copied, setCopied] = useState(false);

  async function copyWorkflowRequest() {
    try {
      await navigator.clipboard.writeText(workflowRequests[workflow]);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  }

  return <button className="button button-secondary" type="button" onClick={copyWorkflowRequest}>
    {copied ? "Request copied" : workflow === "review_queue" ? "Copy “show my reviews”" : "Copy submission request"}
  </button>;
}
