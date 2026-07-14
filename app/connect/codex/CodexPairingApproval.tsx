"use client";

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

type PairingPreview = {
  id: string;
  agentId: string;
  agentLabel: string;
  agentPublicKey: string;
  expiresAt: string;
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
    if (!pairing) return;
    setBusy(true);
    setError(null);
    try {
      const signingKey = await readySigningKey(currentKey);
      const agent = await registerAgent({
        agentId: pairing.agentId,
        label: pairing.agentLabel,
        publicKey: pairing.agentPublicKey,
      });
      const certificate = certificateFor({
        personId: profile.person.id,
        agentId: agent.id,
        agentPublicKey: agent.publicKey,
      });
      const personSignature = await signDevicePersonPayload(
        signingKey.publicKey,
        canonicalUtf8(delegationSigningPayload(certificate)),
      );
      const delegation = await issueDelegation({
        personKeyId: signingKey.id,
        certificate,
        personSignature,
      });
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
      {pairing && <><code>{pairing.agentId}</code><small>Approval link expires {formatExpiry(pairing.expiresAt)}.</small></>}
    </div>
    <div className="connect-codex-boundary">
      <div><span>Stored locally</span><p>Agent private key, OAuth refresh token, Codex workspace, model settings, and raw research notes.</p></div>
      <div><span>Recorded by Proofweave</span><p>Agent public key, a 30-day formalize/prove delegation, and a revocable connection record.</p></div>
    </div>
    {keyState === "checking" && <p className="connect-codex-status">Checking whether this browser can sign the approval…</p>}
    {keyState === "missing" && <p className="connect-codex-status">This browser will create one protected Person signing key before approval. Its private half never leaves this browser.</p>}
    {keyState === "ready" && <p className="connect-codex-status">Your protected Person signing key is ready to approve this local Agent.</p>}
    {(inputError ?? error) && <p className="setup-message setup-message-error" role="alert">{inputError ?? error}</p>}
    <button className="button button-primary connect-codex-approve" type="button" disabled={!pairing || busy || keyState === "checking"} onClick={() => void approve()}>
      {busy ? "Creating secure connection…" : keyState === "missing" ? "Create key and approve local Codex" : "Approve local Codex"}
      {!busy && <span aria-hidden="true">→</span>}
    </button>
    <p className="connect-codex-note">You can revoke this connection or its delegation later in Settings. Approval does not claim Lean verification or create a contribution receipt.</p>
  </section>;
}

function certificateFor(input: { personId: string; agentId: string; agentPublicKey: string }) {
  const validFrom = new Date();
  return {
    id: `pw:delegation:${crypto.randomUUID()}`,
    ownerPersonId: input.personId,
    agentId: input.agentId,
    agentPublicKey: input.agentPublicKey,
    scopes: ["formalize", "prove"],
    validFrom: validFrom.toISOString(),
    validUntil: new Date(validFrom.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    attributionPolicy: { beneficiaryPersonId: input.personId, mode: "agent_delegated" as const },
  };
}

function formatExpiry(value: string): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(time)
    : value;
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The local connection could not be completed.";
}
