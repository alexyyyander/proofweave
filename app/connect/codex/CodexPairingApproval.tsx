"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DelegationProfile, PersonSigningKey } from "@/db/repositories/delegation";
import { delegationSigningPayload } from "@/packages/domain/delegation.mjs";
import { canonicalUtf8 } from "@/packages/protocol/canonical-json.mjs";
import { personKeyProofChallengeSigningPayload } from "@/packages/protocol/person-key-proof.mjs";
import {
  createDevicePersonKey,
  hasDevicePersonKey,
  signDevicePersonPayload,
} from "@/app/workbench/browser-signing-key";
import {
  issueDelegation,
  issuePersonKeyProofChallenge,
  registerAgent,
  registerPersonKey,
  submitPersonKeyProof,
} from "@/app/workbench/delegation-control-api";
import { reusableAgentDelegation } from "@/app/lib/local-agent-journey";

type PairingPreview = {
  id: string;
  agentId: string;
  agentLabel: string;
  agentPublicKey: string;
  connectionMode: "research" | "review" | "research_and_review";
  delegationScopes: readonly ("formalize" | "prove" | "review")[];
  expiresAt: string;
  status: "pending" | "approved" | "expired";
};

export function CodexPairingApproval({ profile, pairingId, secret }: {
  profile: DelegationProfile;
  pairingId: string;
  secret: string;
}) {
  const [pairing, setPairing] = useState<PairingPreview | null>(null);
  const currentKey = useMemo(() => profile.signingKeys.find(
    (key) => key.revokedAt === null && key.possessionVerifiedAt !== null,
  ) ?? null, [profile.signingKeys]);
  const [keyState, setKeyState] = useState<"checking" | "ready" | "missing">(currentKey ? "checking" : "missing");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reusableDelegation = useMemo(() => pairing ? reusableAgentDelegation(profile, {
    agentId: pairing.agentId,
    agentPublicKey: pairing.agentPublicKey,
    requiredScopes: pairing.delegationScopes,
  }) : null, [pairing, profile]);
  const inputError = !pairingId || !secret
    ? "This local connection link is incomplete. Return to Codex and start the connection again."
    : null;

  useEffect(() => {
    let live = true;
    if (inputError) return () => { live = false; };
    void fetch(`/api/connect/sessions/${encodeURIComponent(pairingId)}?secret=${encodeURIComponent(secret)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error?.message ?? "This local connection link has expired.");
        return payload.pairing as PairingPreview;
      })
      .then((value) => { if (live) setPairing(value); })
      .catch((cause: unknown) => { if (live) setError(messageFor(cause)); });
    return () => { live = false; };
  }, [inputError, pairingId, secret]);

  useEffect(() => {
    let live = true;
    if (!currentKey) return () => { live = false; };
    void hasDevicePersonKey(currentKey.publicKey)
      .then((available) => { if (live) setKeyState(available ? "ready" : "missing"); })
      .catch(() => { if (live) setKeyState("missing"); });
    return () => { live = false; };
  }, [currentKey]);

  const approve = async () => {
    if (!pairing || pairing.status !== "pending") return;
    setBusy(true);
    setError(null);
    try {
      const agent = await registerAgent({
        agentId: pairing.agentId,
        label: pairing.agentLabel,
        publicKey: pairing.agentPublicKey,
      });
      const delegation = reusableDelegation ?? await issueFreshDelegation(agent);
      const response = await fetch(`/api/connect/sessions/${encodeURIComponent(pairing.id)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret, delegationCertificateId: delegation.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error?.message ?? "The local connection could not be approved.");
      window.location.assign(result.redirectUrl);
    } catch (cause) {
      setError(messageFor(cause));
      setBusy(false);
    }
  };

  async function issueFreshDelegation(agent: { id: string; publicKey: string }) {
    const signingKey = await readySigningKey(currentKey);
    const certificate = certificateFor({
      personId: profile.person.id,
      agentId: agent.id,
      agentPublicKey: agent.publicKey,
      scopes: pairing!.delegationScopes,
    });
    const personSignature = await signDevicePersonPayload(
      signingKey.publicKey,
      canonicalUtf8(delegationSigningPayload(certificate)),
    );
    return issueDelegation({ personKeyId: signingKey.id, certificate, personSignature });
  }

  async function readySigningKey(existing: PersonSigningKey | null): Promise<PersonSigningKey> {
    if (existing && await hasDevicePersonKey(existing.publicKey)) return existing;
    const key = await createDevicePersonKey();
    const registered = await registerPersonKey(key.publicKey);
    const challenge = await issuePersonKeyProofChallenge(registered.id);
    const signature = await signDevicePersonPayload(
      registered.publicKey,
      canonicalUtf8(personKeyProofChallengeSigningPayload(challenge)),
    );
    await submitPersonKeyProof({ keyId: registered.id, challengeId: challenge.id, personSignature: signature });
    return registered;
  }

  return <section className="connect-codex-card" aria-live="polite">
    <div className="connect-codex-device">
      <span className="micro-label">This local Agent</span>
      <strong>{pairing?.agentLabel ?? "Reading local connection…"}</strong>
      {pairing && <><code>{pairing.agentId}</code><small>{connectionModeLabel(pairing.connectionMode)} · {pairingStatusLabel(pairing)}.</small></>}
    </div>
    <div className="connect-codex-boundary">
      <div><span>Stored locally</span><p>Agent private key, OAuth refresh token, Codex workspace, model settings, and raw research notes.</p></div>
      <div><span>Recorded by Proofweave</span><p>Agent public key, a 30-day {pairing ? delegationLabel(pairing.delegationScopes) : "scoped"} delegation, and a revocable connection record.</p></div>
    </div>
    {pairing?.status === "approved" ? <p className="connect-codex-status">This one-time link was already approved. The connection, compatible delegation, Agent identity, and stable Attempt ids remain recorded; return to Codex to continue.</p>
      : pairing?.status === "expired" ? <p className="connect-codex-status">This one-time link expired without changing the Agent or any Attempt. Ask Codex to create a fresh approval link for the same local Agent.</p>
        : reusableDelegation ? <p className="connect-codex-status">The same Agent already has compatible active authority. Proofweave will reuse it and keep every existing Attempt reachable.</p> : <>
      {keyState === "checking" && <p className="connect-codex-status">Checking whether this browser can sign the approval…</p>}
      {keyState === "missing" && <p className="connect-codex-status">This browser will create one protected Person signing key before approval. Its private half never leaves this browser.</p>}
      {keyState === "ready" && <p className="connect-codex-status">Your protected Person signing key is ready to approve this local Agent.</p>}
    </>}
    {(inputError ?? error) && <p className="setup-message setup-message-error" role="alert">{inputError ?? error}</p>}
    {pairing?.status === "approved" ? <Link className="button button-primary connect-codex-approve" href="/workbench">Open my work <span aria-hidden="true">→</span></Link>
      : pairing?.status === "expired" ? <Link className="button button-primary connect-codex-approve" href="/integrations#codex-beta">Create a fresh link in Codex <span aria-hidden="true">→</span></Link>
        : <button className="button button-primary connect-codex-approve" type="button" disabled={!pairing || busy || (!reusableDelegation && keyState === "checking")} onClick={() => void approve()}>
          {busy ? "Creating secure connection…" : reusableDelegation ? "Reconnect existing Agent" : keyState === "missing" ? "Create key and approve local Codex" : "Approve local Codex"}
          {!busy && <span aria-hidden="true">→</span>}
        </button>}
    <p className="connect-codex-note">You can revoke this connection or its delegation later in Settings. Approval does not claim Lean verification or create a contribution receipt.</p>
  </section>;
}

function certificateFor(input: {
  personId: string;
  agentId: string;
  agentPublicKey: string;
  scopes: readonly ("formalize" | "prove" | "review")[];
}) {
  const validFrom = new Date();
  return {
    id: `pw:delegation:${crypto.randomUUID()}`,
    ownerPersonId: input.personId,
    agentId: input.agentId,
    agentPublicKey: input.agentPublicKey,
    scopes: [...input.scopes],
    validFrom: validFrom.toISOString(),
    validUntil: new Date(validFrom.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    attributionPolicy: { beneficiaryPersonId: input.personId, mode: "agent_delegated" as const },
  };
}

function connectionModeLabel(mode: PairingPreview["connectionMode"]): string {
  if (mode === "review") return "Independent review connection";
  if (mode === "research_and_review") return "Research and independent review connection";
  return "Research connection";
}

function delegationLabel(scopes: PairingPreview["delegationScopes"]): string {
  if (scopes.includes("review") && scopes.some((scope) => scope === "formalize" || scope === "prove")) {
    return "formalize/prove/review";
  }
  if (scopes.includes("review")) return "review";
  return "formalize/prove";
}

function formatExpiry(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", timeStyle: "short" }).format(time)
    : value;
}

function pairingStatusLabel(pairing: PairingPreview): string {
  if (pairing.status === "approved") return "one-time link already approved";
  if (pairing.status === "expired") return `one-time link expired ${formatExpiry(pairing.expiresAt)}`;
  return `approval link expires ${formatExpiry(pairing.expiresAt)}`;
}

function messageFor(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : "The local connection could not be completed.";
  if (/Agent id cannot be reused with different ownership or key material/i.test(message)) {
    return "This approval page was created with an Agent identity that is already bound elsewhere. Close this stale tab, update the Proofweave plugin, and start connect_proofweave again from a new Codex task. The updated Connector creates a fresh identity while preserving the previous Agent and its records.";
  }
  return message;
}
