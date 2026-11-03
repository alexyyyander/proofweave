"use client";

import { SectionTitle, Badge, Button, EmptyState, SectionHeading } from "@/app/components/ui";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type AgentInstallation } from "@/db/repositories/delegation";
import { useI18n } from "@/app/i18n/client";

export function AgentConnections({ installations }: { installations: readonly AgentInstallation[] }) {
  const { t } = useI18n();
  const router = useRouter();
  const [connections, setConnections] = useState<readonly AgentInstallation[]>(installations);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function revoke(installation: AgentInstallation) {
    if (!window.confirm(t("agentConnections.confirm", { client: installation.clientName, agent: installation.agentLabel }))) return;
    setPendingId(installation.id);
    setMessage(null);
    try {
      const response = await fetch(`/api/me/agent-installations/${encodeURIComponent(installation.id)}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: t("agentConnections.ownerRevokedReason"), revokedAt: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(t("agentConnections.error"));
      const revokedAt = new Date().toISOString();
      setConnections((current) => current.map((candidate) => candidate.id === installation.id
        ? { ...candidate, status: "revoked", revokedAt, revocationReason: t("agentConnections.ownerRevokedReason") }
        : candidate));
      setPendingId(null);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("agentConnections.error"));
      setPendingId(null);
    }
  }

  return <section className="agent-connections" aria-labelledby="agent-connections-title">
    <SectionHeading as="div" className="agent-connections-heading">
      <div><p className="eyebrow">{t("agentConnections.eyebrow")}</p><SectionTitle id="agent-connections-title">{t("agentConnections.title")}</SectionTitle><p>{t("agentConnections.body")}</p></div>
      <Badge className="record-chip">{t("agentConnections.active", { count: connections.filter((item) => item.status === "active").length })}</Badge>
    </SectionHeading>
    {message && <p className="agent-connections-message" role="alert">{message}</p>}
    {connections.length === 0 ? <EmptyState as="div" className="agent-connections-empty"><strong>{t("agentConnections.emptyTitle")}</strong><p>{t("agentConnections.emptyBody")}</p></EmptyState> : <ul className="agent-connection-list">
      {connections.map((installation) => <li key={installation.id}>
        <div><strong>{installation.clientName}</strong><span>{installation.agentLabel} · {installation.delegationScopes.join(", ")}</span><code>{installation.id}</code></div>
        <div className="agent-connection-actions"><span className={installation.status === "active" ? "connection-active" : "connection-revoked"}>{installation.status === "active" ? t("agentConnections.statusActive") : t("agentConnections.statusRevoked")}</span>{installation.status === "active" ? <Button className="quiet-action connection-revoke" type="button" disabled={pendingId === installation.id} onClick={() => revoke(installation)}>{pendingId === installation.id ? t("agentConnections.revoking") : t("agentConnections.revoke")}</Button> : <small>{installation.revocationReason ?? t("agentConnections.ownerRevoked")}</small>}</div>
      </li>)}
    </ul>}
  </section>;
}
