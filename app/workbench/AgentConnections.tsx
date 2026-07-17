"use client";

import { useState } from "react";
import type { AgentInstallation } from "@/db/repositories/delegation";

export function AgentConnections({ installations }: { installations: readonly AgentInstallation[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function revoke(installation: AgentInstallation) {
    if (!window.confirm(`Revoke ${installation.clientName}'s access through ${installation.agentLabel}?`)) return;
    setPendingId(installation.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/me/agent-installations/${encodeURIComponent(installation.id)}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Owner revoked this Agent connection.", revokedAt: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error("Proofweave could not revoke this connection.");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Proofweave could not revoke this connection.");
      setPendingId(null);
    }
  }

  return <section className="agent-connections" aria-labelledby="agent-connections-title">
    <div className="agent-connections-heading">
      <div><p className="eyebrow">Connection control</p><h2 id="agent-connections-title">Your Agent connections</h2><p>Each approval is bound to one Codex client and one delegated Agent. Revoking it immediately blocks its tokens.</p></div>
      <span className="record-chip">{installations.filter((item) => item.status === "active").length} active</span>
    </div>
    {message && <p className="agent-connections-message" role="alert">{message}</p>}
    {installations.length === 0 ? <div className="agent-connections-empty"><strong>No local Codex connection yet.</strong><p>Install the Proofweave Research plugin, then ask Codex to connect. Browser approval creates the first revocable entry here; no key needs to be pasted.</p></div> : <ul className="agent-connection-list">
      {installations.map((installation) => <li key={installation.id}>
        <div><strong>{installation.clientName}</strong><span>{installation.agentLabel} · {installation.delegationScopes.join(", ")}</span><code>{installation.id}</code></div>
        <div className="agent-connection-actions"><span className={installation.status === "active" ? "connection-active" : "connection-revoked"}>{installation.status === "active" ? "Active" : "Revoked"}</span>{installation.status === "active" ? <button className="quiet-action connection-revoke" type="button" disabled={pendingId === installation.id} onClick={() => revoke(installation)}>{pendingId === installation.id ? "Revoking…" : "Revoke connection"}</button> : <small>{installation.revocationReason ?? "Owner revoked"}</small>}</div>
      </li>)}
    </ul>}
  </section>;
}
