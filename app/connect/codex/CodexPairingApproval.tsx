"use client";

import { ActionLink, Button, Surface } from "@/app/components/ui";

import { useEffect, useMemo, useState } from "react";
import { type DelegationProfile, type PersonSigningKey } from "@/db/repositories/delegation";
import { delegationSigningPayload } from "@/packages/domain/delegation.mjs";
import { canonicalUtf8 } from "@/packages/protocol/canonical-json.mjs";
import { personKeyProofChallengeSigningPayload } from "@/packages/protocol/person-key-proof.mjs";
import { createDevicePersonKey, hasDevicePersonKey, signDevicePersonPayload } from "@/app/workbench/browser-signing-key";
import { issueDelegation, issuePersonKeyProofChallenge, registerAgent, registerPersonKey, submitPersonKeyProof } from "@/app/workbench/delegation-control-api";
import { reusableAgentDelegation } from "@/app/lib/local-agent-journey";
import { useI18n } from "@/app/i18n/client";
import type { Locale } from "@/app/i18n/config";
import type { Translator } from "@/app/i18n/translate";

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
  const { t, locale } = useI18n();
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
  const inputError = !pairingId || !secret ? t("connect.error.incomplete") : null;

  useEffect(() => {
    let live = true;
    if (inputError) return () => { live = false; };
    void fetch(`/api/connect/sessions/${encodeURIComponent(pairingId)}?secret=${encodeURIComponent(secret)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(locale === "en" ? payload?.error?.message ?? "This local connection link has expired." : t("connect.error.expired"));
        return payload.pairing as PairingPreview;
      })
      .then((value) => { if (live) setPairing(value); })
      .catch((cause: unknown) => { if (live) setError(messageFor(cause, t, locale)); });
    return () => { live = false; };
  }, [inputError, locale, pairingId, secret, t]);

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
      if (!response.ok) throw new Error(locale === "en" ? result?.error?.message ?? "The local connection could not be approved." : t("connect.error.approve"));
      window.location.assign(result.redirectUrl);
    } catch (cause) {
      setError(messageFor(cause, t, locale));
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

  return <Surface as="section" className="connect-codex-card" aria-live="polite">
    <div className="connect-codex-device">
      <span className="micro-label">{t("connect.device.label")}</span>
      <strong>{pairing?.agentLabel ?? t("connect.device.reading")}</strong>
      {pairing && <><code>{pairing.agentId}</code><small>{connectionModeLabel(pairing.connectionMode, t)} · {pairingStatusLabel(pairing, t, locale)}.</small></>}
    </div>
    <div className="connect-codex-boundary">
      <div><span>{t("connect.boundary.localTitle")}</span><p>{t("connect.boundary.localBody")}</p></div>
      <div><span>{t("connect.boundary.recordedTitle")}</span><p>{t("connect.boundary.recordedBody", { scope: pairing ? delegationLabel(pairing.delegationScopes) : "scoped" })}</p></div>
    </div>
    {pairing?.status === "approved" ? <p className="connect-codex-status">{t("connect.status.approved")}</p>
      : pairing?.status === "expired" ? <p className="connect-codex-status">{t("connect.status.expired")}</p>
        : reusableDelegation ? <p className="connect-codex-status">{t("connect.status.reusable")}</p> : <>
      {keyState === "checking" && <p className="connect-codex-status">{t("connect.status.checking")}</p>}
      {keyState === "missing" && <p className="connect-codex-status">{t("connect.status.missing")}</p>}
      {keyState === "ready" && <p className="connect-codex-status">{t("connect.status.ready")}</p>}
    </>}
    {(inputError ?? error) && <p className="setup-message setup-message-error" role="alert">{inputError ?? error}</p>}
    {pairing?.status === "approved" ? <ActionLink className="button button-primary connect-codex-approve" href="/workbench">{t("connect.action.openWork")} <span aria-hidden="true">→</span></ActionLink>
      : pairing?.status === "expired" ? <ActionLink className="button button-primary connect-codex-approve" href="/integrations#codex-beta">{t("connect.action.freshLink")} <span aria-hidden="true">→</span></ActionLink>
        : <Button className="button button-primary connect-codex-approve" type="button" disabled={!pairing || busy || (!reusableDelegation && keyState === "checking")} onClick={() => void approve()}>
          {busy ? t("connect.action.creating") : reusableDelegation ? t("connect.action.reconnect") : keyState === "missing" ? t("connect.action.createKey") : t("connect.action.approve")}
          {!busy && <span aria-hidden="true">→</span>}
        </Button>}
    <p className="connect-codex-note">{t("connect.note")}</p>
  </Surface>;
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

function connectionModeLabel(mode: PairingPreview["connectionMode"], t: Translator): string {
  if (mode === "review") return t("connect.mode.review");
  if (mode === "research_and_review") return t("connect.mode.both");
  return t("connect.mode.research");
}

function delegationLabel(scopes: PairingPreview["delegationScopes"]): string {
  if (scopes.includes("review") && scopes.some((scope) => scope === "formalize" || scope === "prove")) {
    return "formalize/prove/review";
  }
  if (scopes.includes("review")) return "review";
  return "formalize/prove";
}

function formatExpiry(value: string, locale: Locale): string {
  const time = Date.parse(value);
  return Number.isFinite(time)
    ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", timeStyle: "short" }).format(time)
    : value;
}

function pairingStatusLabel(pairing: PairingPreview, t: Translator, locale: Locale): string {
  if (pairing.status === "approved") return t("connect.pairing.approved");
  if (pairing.status === "expired") return t("connect.pairing.expired", { time: formatExpiry(pairing.expiresAt, locale) });
  return t("connect.pairing.pending", { time: formatExpiry(pairing.expiresAt, locale) });
}

function messageFor(cause: unknown, t: Translator, locale: Locale): string {
  const message = cause instanceof Error ? cause.message : t("connect.error.generic");
  if (/Agent id cannot be reused with different ownership or key material/i.test(message)) {
    return t("connect.error.staleIdentity");
  }
  return locale === "en" ? message : t("connect.error.generic");
}
