"use client";

import { SectionTitle, CardTitle, ActionLink, Button, Input, SectionHeading, Select, Surface } from "@/app/components/ui";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { type DelegationProfile, type PersonSigningKey, type RegisteredAgent, type StoredDelegation } from "@/db/repositories/delegation";
import { delegationSigningPayload } from "@/packages/domain/delegation.mjs";
import { canonicalUtf8 } from "@/packages/protocol/canonical-json.mjs";
import { personKeyProofChallengeSigningPayload } from "@/packages/protocol/person-key-proof.mjs";
import { createDevicePersonKey, hasDevicePersonKey, removeDevicePersonKey, signDevicePersonPayload } from "./browser-signing-key";
import { issueDelegation, issuePersonKeyProofChallenge, registerPersonKey, revokeDelegation, revokePersonKey, submitPersonKeyProof } from "./delegation-control-api";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";
import { useI18n } from "@/app/i18n/client";
import type { Locale } from "@/app/i18n/config";
import type { Translator } from "@/app/i18n/translate";

const scopes = ["formalize", "prove", "review"] as const;
type Scope = (typeof scopes)[number];

type DelegationSetupProps = {
  profile: DelegationProfile | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
};

export function DelegationSetup({ profile, isAuthenticated, signInPath, storageAvailable }: DelegationSetupProps) {
  const { t } = useI18n();
  if (!isAuthenticated) {
    return <section className="delegation-setup delegation-setup-callout" id="delegation-setup" aria-labelledby="delegation-setup-title">
      <div>
        <p className="eyebrow">{t("delegationSetup.callout.eyebrow")}</p>
        <SectionTitle id="delegation-setup-title">{t("delegationSetup.callout.title")}</SectionTitle>
        <p>{t("delegationSetup.callout.body")}</p>
      </div>
      <ActionLink className="button button-primary" href={signInPath}>{t("delegationSetup.callout.action")} <span aria-hidden="true">→</span></ActionLink>
    </section>;
  }

  if (!storageAvailable || !profile) {
    return <section className="delegation-setup delegation-setup-unavailable" id="delegation-setup" aria-labelledby="delegation-setup-title">
      <p className="eyebrow">{t("delegationSetup.unavailable.eyebrow")}</p>
      <SectionTitle id="delegation-setup-title">{t("delegationSetup.unavailable.title")}</SectionTitle>
      <p>{t("delegationSetup.unavailable.body")}</p>
    </section>;
  }

  return <DelegationSetupFlow profile={profile} />;
}

function DelegationSetupFlow({ profile }: { profile: DelegationProfile }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  const active = activeDelegation(profile);
  const connection = activeLocalCodexInstallation(profile);
  const [deviceKeyPublicKeys, setDeviceKeyPublicKeys] = useState<ReadonlySet<string> | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"key" | "proof" | "key-revoke" | "delegation" | "revoke" | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all(profile.signingKeys.map(async (key) => [key.publicKey, await hasDevicePersonKey(key.publicKey)] as const))
      .then((results) => {
        if (!live) return;
        setDeviceKeyPublicKeys(new Set(results.filter(([, available]) => available).map(([publicKey]) => publicKey)));
      })
      .catch(() => {
        if (live) setDeviceKeyPublicKeys(new Set());
      });
    return () => { live = false; };
  }, [profile.signingKeys]);

  const deviceKeys = useMemo(
    () => profile.signingKeys.filter((key) => deviceKeyPublicKeys?.has(key.publicKey)),
    [deviceKeyPublicKeys, profile.signingKeys],
  );

  const refresh = (message: string) => {
    setNotice(message);
    setError(null);
    router.refresh();
  };

  const createKey = async () => {
    setBusy("key");
    setError(null);
    try {
      const key = await createDevicePersonKey();
      const registered = await registerPersonKey(key.publicKey);
      setDeviceKeyPublicKeys((current) => new Set([...(current ?? []), key.publicKey]));
      await provePersonKey(registered);
      refresh(t("delegationSetup.notice.keyCreated"));
    } catch (cause) {
      setError(messageFor(cause, t, locale));
    } finally {
      setBusy(null);
    }
  };

  const provePersonKey = async (key: PersonSigningKey) => {
    const challenge = await issuePersonKeyProofChallenge(key.id);
    const personSignature = await signDevicePersonPayload(
      key.publicKey,
      canonicalUtf8(personKeyProofChallengeSigningPayload(challenge)),
    );
    await submitPersonKeyProof({ keyId: key.id, challengeId: challenge.id, personSignature });
  };

  const manualControls = <div className="delegation-steps">
    <PersonKeyStep
      keys={profile.signingKeys}
      deviceKeys={deviceKeys}
      loading={deviceKeyPublicKeys === null}
      busy={busy === "key" || busy === "proof" || busy === "key-revoke"}
      onCreate={createKey}
      onProve={async (key) => {
        setBusy("proof");
        setError(null);
        try {
          await provePersonKey(key);
          refresh(t("delegationSetup.notice.proof"));
        } catch (cause) {
          setError(messageFor(cause, t, locale));
        } finally {
          setBusy(null);
        }
      }}
      onRevoke={async ({ key, reason, emergency, deviceHeld }) => {
        setBusy("key-revoke");
        setError(null);
        try {
          await revokePersonKey({ keyId: key.id, reason, emergency });
          if (deviceHeld) {
            await removeDevicePersonKey(key.publicKey);
            setDeviceKeyPublicKeys((current) => {
              const next = new Set(current ?? []);
              next.delete(key.publicKey);
              return next;
            });
          }
          refresh(emergency ? t("delegationSetup.notice.emergencyRevoked") : t("delegationSetup.notice.keyRevoked"));
          return true;
        } catch (cause) {
          setError(messageFor(cause, t, locale));
          return false;
        } finally {
          setBusy(null);
        }
      }}
    />
    <AgentStep agents={profile.agents} />
    <CertificateStep
      profile={profile}
      active={active}
      deviceKeys={deviceKeys}
      busy={busy === "delegation"}
      onIssue={async ({ signingKey, agent, selectedScopes, days }) => {
        setBusy("delegation");
        setError(null);
        try {
          const certificate = certificateFor(profile, agent, selectedScopes, days);
          const personSignature = await signDevicePersonPayload(
            signingKey.publicKey,
            canonicalUtf8(delegationSigningPayload(certificate)),
          );
          await issueDelegation({ personKeyId: signingKey.id, certificate, personSignature });
          refresh(t("delegationSetup.notice.delegationIssued"));
        } catch (cause) {
          setError(messageFor(cause, t, locale));
        } finally {
          setBusy(null);
        }
      }}
    />
  </div>;

  return <section className="delegation-setup" id="delegation-setup" aria-labelledby="delegation-setup-title">
    <SectionHeading as="div" className="delegation-setup-heading">
      <div>
        <p className="eyebrow">{t("delegationSetup.eyebrow")}</p>
        <SectionTitle id="delegation-setup-title">{connection ? t("delegationSetup.titleConnected") : t("delegationSetup.titleDisconnected")}</SectionTitle>
        <p>{t("delegationSetup.body")}</p>
      </div>
      <span className={connection ? "setup-status is-ready" : "setup-status"}>{connection ? t("delegationSetup.status.active") : t("delegationSetup.status.required")}</span>
    </SectionHeading>

    {notice && <p className="setup-message setup-message-success" role="status">{notice}</p>}
    {error && <p className="setup-message setup-message-error" role="alert">{error}</p>}

    {!connection && <div className="connection-first-callout">
      <div>
        <span className="micro-label">{t("delegationSetup.recommended.label")}</span>
        <strong>{t("delegationSetup.recommended.title")}</strong>
        <p>{t("delegationSetup.recommended.body")}</p>
      </div>
      <ActionLink className="button button-primary" href="/integrations#codex-beta">{t("delegationSetup.recommended.action")} <span aria-hidden="true">→</span></ActionLink>
    </div>}

    {connection ? manualControls : <details className="advanced-agent-controls"><summary>{t("delegationSetup.advanced.summary")}</summary><p>{t("delegationSetup.advanced.body")}</p>{manualControls}</details>}

    {active && <RevocationStep active={active} busy={busy === "revoke"} onRevoke={async (reason) => {
      setBusy("revoke");
      setError(null);
      try {
        await revokeDelegation(active.id, reason);
        refresh(t("delegationSetup.notice.delegationRevoked"));
      } catch (cause) {
        setError(messageFor(cause, t, locale));
      } finally {
        setBusy(null);
      }
    }} />}
  </section>;
}

function PersonKeyStep({ keys, deviceKeys, loading, busy, onCreate, onProve, onRevoke }: {
  keys: readonly PersonSigningKey[];
  deviceKeys: readonly PersonSigningKey[];
  loading: boolean;
  busy: boolean;
  onCreate: () => Promise<void>;
  onProve: (key: PersonSigningKey) => Promise<void>;
  onRevoke: (input: { key: PersonSigningKey; reason: string; emergency: boolean; deviceHeld: boolean }) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const [revokeKeyId, setRevokeKeyId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [emergency, setEmergency] = useState(false);
  const activeKeys = keys.filter((key) => key.revokedAt === null);
  const activeDeviceKeys = deviceKeys.filter((key) => key.revokedAt === null);
  const verifiedDeviceKeys = activeDeviceKeys.filter((key) => key.possessionVerifiedAt !== null);
  const hasDeviceKey = activeDeviceKeys.length > 0;
  const hasVerifiedDeviceKey = verifiedDeviceKeys.length > 0;
  const devicePublicKeys = new Set(activeDeviceKeys.map((key) => key.publicKey));
  const resetRevocation = () => {
    setRevokeKeyId(null);
    setReason("");
    setEmergency(false);
  };
  return <Surface as="article" className="delegation-step">
    <span className="step-number">01</span>
    <div>
      <span className="micro-label">{t("delegationSetup.key.label")}</span>
      <CardTitle>{hasVerifiedDeviceKey ? t("delegationSetup.key.titleVerified") : hasDeviceKey ? t("delegationSetup.key.titleUnverified") : t("delegationSetup.key.titleCreate")}</CardTitle>
      <p>{hasDeviceKey
        ? t("delegationSetup.key.bodyHasDevice")
        : keys.length > 0
          ? t("delegationSetup.key.bodyOtherDevice")
          : t("delegationSetup.key.bodyNone")}</p>
      {activeKeys.length > 0 && <div className="device-key-statuses">{activeKeys.map((key) => {
        const deviceHeld = devicePublicKeys.has(key.publicKey);
        const revoking = revokeKeyId === key.id;
        return <div key={key.id} className="device-key-status">
          <code className="device-key-label">{deviceHeld ? t("delegationSetup.key.deviceKey") : t("delegationSetup.key.registeredKey")} · {key.fingerprint}</code>
          <small>{key.possessionVerifiedAt
            ? t("delegationSetup.key.possessionVerified", { date: formatDate(key.possessionVerifiedAt, locale) })
            : deviceHeld
              ? t("delegationSetup.key.proofRequired")
              : t("delegationSetup.key.otherDevice")}</small>
          {deviceHeld && !key.possessionVerifiedAt && <Button className="button button-secondary setup-action" type="button" disabled={busy} onClick={() => void onProve(key)}>{busy ? t("delegationSetup.key.verifying") : t("delegationSetup.key.verify")}</Button>}
          {!revoking && <Button className="key-revoke-trigger" type="button" disabled={busy} onClick={() => setRevokeKeyId(key.id)}>{t("delegationSetup.key.replace")}</Button>}
          {revoking && <form className="key-revocation-form" onSubmit={(event) => {
            event.preventDefault();
            void onRevoke({ key, reason, emergency, deviceHeld }).then((revoked) => {
              if (revoked) resetRevocation();
            });
          }}>
            <label>{t("delegationSetup.key.reason")}<Input required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("delegationSetup.key.reasonPlaceholder")} /></label>
            <label className="emergency-key-option"><Input type="checkbox" checked={emergency} onChange={(event) => setEmergency(event.target.checked)} />{t("delegationSetup.key.emergency")}</label>
            <small>{emergency ? t("delegationSetup.key.emergencyBody") : t("delegationSetup.key.safeBody")}</small>
            <div><Button className="button button-danger" type="submit" disabled={busy}>{busy ? t("delegationSetup.key.revoking") : emergency ? t("delegationSetup.key.emergencyRevoke") : t("delegationSetup.key.revoke")}</Button><Button className="key-revoke-cancel" type="button" disabled={busy} onClick={resetRevocation}>{t("delegationSetup.key.cancel")}</Button></div>
          </form>}
        </div>;
      })}</div>}
      {!hasDeviceKey && <Button className="button button-secondary setup-action" type="button" disabled={loading || busy} onClick={() => void onCreate()}>{busy ? t("delegationSetup.key.creating") : loading ? t("delegationSetup.key.checking") : t("delegationSetup.key.create")}</Button>}
    </div>
  </Surface>;
}

function AgentStep({ agents }: { agents: readonly RegisteredAgent[] }) {
  const { t } = useI18n();
  const activeAgents = agents.filter((agent) => agent.status === "active" && agent.revokedAt === null);

  return <Surface as="article" className="delegation-step">
    <span className="step-number">02</span>
    <div>
      <span className="micro-label">{t("delegationSetup.agent.label")}</span>
      <CardTitle>{activeAgents.length > 0 ? t("delegationSetup.agent.titleCount", { count: activeAgents.length }) : t("delegationSetup.agent.titleConnect")}</CardTitle>
      <p>{activeAgents.length > 0 ? t("delegationSetup.agent.bodyCount") : t("delegationSetup.agent.bodyConnect")}</p>
      {activeAgents.length > 0 && <ul className="registered-agent-list">{activeAgents.map((agent) => <li key={agent.id}><strong>{agent.label}</strong><code>{agent.id}</code><small>{agent.keyFingerprint}</small></li>)}</ul>}
      <Surface as="div" className="local-agent-connection-card">
        <div>
          <span className="connection-card-status"><i aria-hidden="true" />{t("delegationSetup.agent.beta")}</span>
          <strong>{activeAgents.length > 0 ? t("delegationSetup.agent.addAnother") : t("delegationSetup.agent.noKey")}</strong>
          <p>{t("delegationSetup.agent.body")}</p>
        </div>
        <ActionLink className="button button-primary setup-action" href="/integrations#codex-beta">{t("delegationSetup.agent.action")} <span aria-hidden="true">→</span></ActionLink>
      </Surface>
    </div>
  </Surface>;
}

function CertificateStep({ profile, active, deviceKeys, busy, onIssue }: {
  profile: DelegationProfile;
  active: StoredDelegation | null;
  deviceKeys: readonly PersonSigningKey[];
  busy: boolean;
  onIssue: (input: { signingKey: PersonSigningKey; agent: RegisteredAgent; selectedScopes: readonly Scope[]; days: number }) => Promise<void>;
}) {
  const { t } = useI18n();
  const availableAgents = profile.agents.filter((agent) => agent.status === "active" && agent.revokedAt === null);
  const [signingKeyId, setSigningKeyId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<readonly Scope[]>(["formalize", "prove"]);
  const [days, setDays] = useState("30");
  const verifiedDeviceKeys = deviceKeys.filter((key) => key.revokedAt === null && key.possessionVerifiedAt !== null);
  const signingKey = verifiedDeviceKeys.find((key) => key.id === signingKeyId) ?? verifiedDeviceKeys[0];
  const agent = availableAgents.find((candidate) => candidate.id === agentId) ?? availableAgents[0];
  const needsAgentIdentity = !active && availableAgents.length === 0;
  const canIssue = !active && Boolean(signingKey && agent && selectedScopes.length > 0);

  const toggleScope = (scope: Scope) => setSelectedScopes((current) => current.includes(scope)
    ? current.filter((value) => value !== scope)
    : [...current, scope]);

  return <Surface as="article" className="delegation-step">
    <span className="step-number">03</span>
    <div>
      <span className="micro-label">{t("delegationSetup.cert.label")}</span>
      <CardTitle>{active
        ? t("delegationSetup.cert.titleActive")
        : needsAgentIdentity
          ? t("delegationSetup.cert.titleNeedsAgent")
          : t("delegationSetup.cert.titleSign")}</CardTitle>
      <p>{active
        ? t("delegationSetup.cert.bodyActive")
        : needsAgentIdentity
          ? t("delegationSetup.cert.bodyNeedsAgent")
          : t("delegationSetup.cert.bodySign")}</p>
      {needsAgentIdentity ? <div className="certificate-prerequisite">
        <strong>{t("delegationSetup.cert.prereqTitle")}</strong>
        <p>{t("delegationSetup.cert.prereqBody")}</p>
        <Link className="text-link" href="/integrations#codex-beta">{t("delegationSetup.cert.prereqLink")} <span aria-hidden="true">→</span></Link>
      </div> : !active && <form className="delegation-form certificate-form" onSubmit={(event) => {
        event.preventDefault();
        if (signingKey && agent) void onIssue({ signingKey, agent, selectedScopes, days: Number(days) });
      }}>
        <label>{t("delegationSetup.cert.signingKey")}<Select value={signingKey?.id ?? ""} onChange={(event) => setSigningKeyId(event.target.value)} disabled={verifiedDeviceKeys.length === 0}>{verifiedDeviceKeys.length === 0 ? <option>{t("delegationSetup.cert.noVerifiedKey")}</option> : verifiedDeviceKeys.map((key) => <option value={key.id} key={key.id}>{key.fingerprint}</option>)}</Select></label>
        <label>{t("delegationSetup.cert.agent")}<Select value={agent?.id ?? ""} onChange={(event) => setAgentId(event.target.value)} disabled={availableAgents.length === 0}>{availableAgents.length === 0 ? <option>{t("delegationSetup.cert.noAgent")}</option> : availableAgents.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</Select></label>
        <fieldset><legend>{t("delegationSetup.cert.allowedWork")}</legend><div className="scope-checks">{scopes.map((scope) => <label key={scope}><Input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} />{scope}</label>)}</div></fieldset>
        <label>{t("delegationSetup.cert.validity")}<Select value={days} onChange={(event) => setDays(event.target.value)}><option value="30">{t("delegationSetup.cert.days30")}</option><option value="90">{t("delegationSetup.cert.days90")}</option><option value="365">{t("delegationSetup.cert.year1")}</option></Select></label>
        <Button className="button button-primary setup-action" type="submit" disabled={!canIssue || busy}>{busy ? t("delegationSetup.cert.signing") : t("delegationSetup.cert.sign")}</Button>
        {!canIssue && <small className="form-hint">{t("delegationSetup.cert.hint")}</small>}
      </form>}
    </div>
  </Surface>;
}

function RevocationStep({ active, busy, onRevoke }: {
  active: StoredDelegation;
  busy: boolean;
  onRevoke: (reason: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  return <Surface as="div" className="revocation-panel">
    <div><span className="micro-label">{t("delegationSetup.revoke.label")}</span><strong>{t("delegationSetup.revoke.title", { id: active.id })}</strong><p>{t("delegationSetup.revoke.body")}</p></div>
    <form onSubmit={(event) => { event.preventDefault(); void onRevoke(reason); }}>
      <label>{t("delegationSetup.revoke.reason")}<Input required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("delegationSetup.revoke.placeholder")} /></label>
      <Button className="button button-danger" type="submit" disabled={busy}>{busy ? t("delegationSetup.revoke.revoking") : t("delegationSetup.revoke.action")}</Button>
    </form>
  </Surface>;
}

function certificateFor(
  profile: DelegationProfile,
  agent: RegisteredAgent,
  selectedScopes: readonly Scope[],
  days: number,
) {
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("Certificate validity must be between 1 and 365 days.");
  const validFrom = new Date();
  const validUntil = new Date(validFrom.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    id: `pw:delegation:${crypto.randomUUID()}`,
    ownerPersonId: profile.person.id,
    agentId: agent.id,
    agentPublicKey: agent.publicKey,
    scopes: [...selectedScopes],
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    attributionPolicy: {
      beneficiaryPersonId: profile.person.id,
      mode: "agent_delegated" as const,
    },
  };
}

function activeDelegation(profile: DelegationProfile): StoredDelegation | null {
  const now = Date.now();
  return profile.delegations.find((candidate) =>
    (candidate.revokedAt === null || now < Date.parse(candidate.revokedAt)) &&
    (candidate.signerKeyRevokedAt === null || now < Date.parse(candidate.signerKeyRevokedAt)) &&
    Date.parse(candidate.validFrom) <= now &&
    now < Date.parse(candidate.validUntil),
  ) ?? null;
}

function formatDate(value: string, locale: Locale): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(timestamp)
    : value;
}

function messageFor(cause: unknown, t: Translator, locale: Locale): string {
  if (cause instanceof Error && locale === "en") return cause.message;
  return t("delegationSetup.error.generic");
}
