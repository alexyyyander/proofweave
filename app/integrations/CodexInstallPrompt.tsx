"use client";

import { useState } from "react";

const installationRequest = `Install the Proofweave Research plugin by following the public, auditable instructions at https://proofweave-research.yualex031821.chatgpt.site/codex-install.md.

First show me the two Codex plugin commands you will run and wait for my confirmation. After it is installed, do not connect Proofweave, create an Agent, or open my private workspace unless I explicitly ask.`;

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
          Copy one request into a Codex chat. It points Codex to a public,
          versioned guide and tells it to stop before connecting your account.
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

const connectionRequests = {
  research: "Connect this Codex to Proofweave for research. Use connect_proofweave with role research, show me the requested authority, and wait for me to approve it in the browser.",
  review: "Connect this Codex to Proofweave for independent review. Use connect_proofweave with role review, show me the requested authority, and wait for me to approve it in the browser.",
  research_and_review: "Upgrade this Codex connection for both research and independent review. Use connect_proofweave with role research_and_review, show me the requested authority, and wait for me to approve it in the browser.",
} as const;

export function CodexConnectPrompt({ role }: { role: keyof typeof connectionRequests }) {
  const [copied, setCopied] = useState(false);

  async function copyConnectionRequest() {
    try {
      await navigator.clipboard.writeText(connectionRequests[role]);
      setCopied(true);
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
