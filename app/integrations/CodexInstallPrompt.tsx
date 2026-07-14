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
