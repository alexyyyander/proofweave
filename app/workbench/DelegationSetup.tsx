"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DelegationProfile, PersonSigningKey, RegisteredAgent, StoredDelegation } from "@/db/repositories/delegation";
import { delegationSigningPayload } from "@/packages/domain/delegation.mjs";
import { canonicalUtf8 } from "@/packages/protocol/canonical-json.mjs";
import { personKeyProofChallengeSigningPayload } from "@/packages/protocol/person-key-proof.mjs";
import {
  createDevicePersonKey,
  hasDevicePersonKey,
  removeDevicePersonKey,
  signDevicePersonPayload,
} from "./browser-signing-key";
import {
  issueDelegation,
  issuePersonKeyProofChallenge,
  registerPersonKey,
  revokeDelegation,
  revokePersonKey,
  submitPersonKeyProof,
} from "./delegation-control-api";
import { activeLocalCodexInstallation } from "../lib/local-agent-journey";

const scopes = ["formalize", "prove", "review"] as const;
type Scope = (typeof scopes)[number];

type DelegationSetupProps = {
  profile: DelegationProfile | null;
  isAuthenticated: boolean;
  signInPath: string;
  storageAvailable: boolean;
};

export function DelegationSetup({ profile, isAuthenticated, signInPath, storageAvailable }: DelegationSetupProps) {
  if (!isAuthenticated) {
    return <section className="delegation-setup delegation-setup-callout" id="delegation-setup" aria-labelledby="delegation-setup-title">
      <div>
        <p className="eyebrow">Personal attribution</p>
        <h2 id="delegation-setup-title">Sign in before you delegate research work.</h2>
        <p>A public preview can show the workbench, but only a signed-in Person can create the key, Agent, and revocable certificate that credits a real contribution.</p>
      </div>
      <Link className="button button-primary" href={signInPath}>Sign in to set up an Agent <span aria-hidden="true">→</span></Link>
    </section>;
  }

  if (!storageAvailable || !profile) {
    return <section className="delegation-setup delegation-setup-unavailable" id="delegation-setup" aria-labelledby="delegation-setup-title">
      <p className="eyebrow">Personal attribution</p>
      <h2 id="delegation-setup-title">Delegation storage is temporarily unavailable.</h2>
      <p>Your research preview remains local. No key, Agent, or delegation was created while the control plane is unavailable.</p>
    </section>;
  }

  return <DelegationSetupFlow profile={profile} />;
}

function DelegationSetupFlow({ profile }: { profile: DelegationProfile }) {
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
      refresh("A Person signing key was created on this device and proof of possession was recorded.");
    } catch (cause) {
      setError(messageFor(cause));
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
          refresh("Proofweave recorded a signed proof that this device holds the selected Person key.");
        } catch (cause) {
          setError(messageFor(cause));
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
          refresh(emergency
            ? "The Person signing key was emergency-revoked. Existing Agent authority signed by it is now blocked."
            : "The replaced Person signing key was revoked and removed from this device.");
          return true;
        } catch (cause) {
          setError(messageFor(cause));
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
          refresh("The active delegation was signed on this device and recorded as immutable evidence.");
        } catch (cause) {
          setError(messageFor(cause));
        } finally {
          setBusy(null);
        }
      }}
    />
  </div>;

  return <section className="delegation-setup" id="delegation-setup" aria-labelledby="delegation-setup-title">
    <div className="delegation-setup-heading">
      <div>
        <p className="eyebrow">Personal attribution · closed alpha</p>
        <h2 id="delegation-setup-title">{connection ? "Manage your connected research Agent" : "Connect an accountable research Agent"}</h2>
        <p>Proofweave records the Person, the Agent key, and a signed certificate separately. Creating more Agents never creates more independent reviewers.</p>
      </div>
      <span className={connection ? "setup-status is-ready" : "setup-status"}>{connection ? "Website approval active" : "Connection required"}</span>
    </div>

    {notice && <p className="setup-message setup-message-success" role="status">{notice}</p>}
    {error && <p className="setup-message setup-message-error" role="alert">{error}</p>}

    {!connection && <div className="connection-first-callout">
      <div>
        <span className="micro-label">Recommended setup</span>
        <strong>Let the local Connector create the right authority.</strong>
        <p>Install Proofweave Research in Codex, then choose Connect Proofweave. One browser approval creates the device-held Person key when needed, registers the local Agent public key, and signs a 30-day formalize/prove delegation.</p>
      </div>
      <Link className="button button-primary" href="/integrations#codex-beta">Install or connect Codex <span aria-hidden="true">→</span></Link>
    </div>}

    {connection ? manualControls : <details className="advanced-agent-controls"><summary>Advanced: manage an existing key or Agent manually</summary><p>Use this only for an Agent that already generated its own key outside the normal local Codex connection. Manual setup records authority; it does not create a live connection.</p>{manualControls}</details>}

    {active && <RevocationStep active={active} busy={busy === "revoke"} onRevoke={async (reason) => {
      setBusy("revoke");
      setError(null);
      try {
        await revokeDelegation(active.id, reason);
        refresh("The delegation was revoked. Earlier signed history remains visible, but new Agent progress is blocked.");
      } catch (cause) {
        setError(messageFor(cause));
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
  return <article className="delegation-step">
    <span className="step-number">01</span>
    <div>
      <span className="micro-label">Person signing key</span>
      <h3>{hasVerifiedDeviceKey ? "A possession-verified signing key is ready." : hasDeviceKey ? "Verify that this device holds its signing key." : "Create a signing key on this device."}</h3>
      <p>{hasDeviceKey
        ? "Only its public fingerprint is in Proofweave. The private signing key remains in this browser’s protected key store; a one-time challenge records that this device can sign with it."
        : keys.length > 0
          ? "Your account has a registered key, but this device cannot use it. Create a new device key to sign a new certificate."
          : "The browser will keep the private key locally and send only the 32-byte public key to Proofweave."}</p>
      {activeKeys.length > 0 && <div className="device-key-statuses">{activeKeys.map((key) => {
        const deviceHeld = devicePublicKeys.has(key.publicKey);
        const revoking = revokeKeyId === key.id;
        return <div key={key.id} className="device-key-status">
          <code className="device-key-label">{deviceHeld ? "Device key" : "Registered key"} · {key.fingerprint}</code>
          <small>{key.possessionVerifiedAt
            ? `Possession verified ${formatDate(key.possessionVerifiedAt)}`
            : deviceHeld
              ? "Possession proof required before delegation"
              : "Held on another device; this browser cannot prove or use it"}</small>
          {deviceHeld && !key.possessionVerifiedAt && <button className="button button-secondary setup-action" type="button" disabled={busy} onClick={() => void onProve(key)}>{busy ? "Verifying device key…" : "Verify device key"}</button>}
          {!revoking && <button className="key-revoke-trigger" type="button" disabled={busy} onClick={() => setRevokeKeyId(key.id)}>Replace or revoke key</button>}
          {revoking && <form className="key-revocation-form" onSubmit={(event) => {
            event.preventDefault();
            void onRevoke({ key, reason, emergency, deviceHeld }).then((revoked) => {
              if (revoked) resetRevocation();
            });
          }}>
            <label>Revocation reason<input required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: device lost" /></label>
            <label className="emergency-key-option"><input type="checkbox" checked={emergency} onChange={(event) => setEmergency(event.target.checked)} />Emergency: revoke even though no other verified device key is ready</label>
            <small>{emergency
              ? "This blocks authority signed by this key immediately and removes this device key after success."
              : "For a safe replacement, prove another device key first; this preserves a usable signing path."}</small>
            <div><button className="button button-danger" type="submit" disabled={busy}>{busy ? "Revoking key…" : emergency ? "Emergency revoke key" : "Revoke replaced key"}</button><button className="key-revoke-cancel" type="button" disabled={busy} onClick={resetRevocation}>Cancel</button></div>
          </form>}
        </div>;
      })}</div>}
      {!hasDeviceKey && <button className="button button-secondary setup-action" type="button" disabled={loading || busy} onClick={() => void onCreate()}>{busy ? "Creating device key…" : loading ? "Checking device key…" : "Create device signing key"}</button>}
    </div>
  </article>;
}

function AgentStep({ agents }: { agents: readonly RegisteredAgent[] }) {
  const activeAgents = agents.filter((agent) => agent.status === "active" && agent.revokedAt === null);

  return <article className="delegation-step">
    <span className="step-number">02</span>
    <div>
      <span className="micro-label">Local Agent</span>
      <h3>{activeAgents.length > 0 ? `${activeAgents.length} Agent${activeAgents.length === 1 ? "" : "s"} identity${activeAgents.length === 1 ? " is" : " identities are"} recorded.` : "Connect Codex with one browser approval."}</h3>
      <p>{activeAgents.length > 0
        ? "Each public identity belongs to a local Agent key. Proofweave still cannot start Codex or inspect project files; only the local Connector can request bounded network actions."
        : "Install the Proofweave Research plugin in Codex, then run Connect Proofweave. The Connector creates its own key on your computer and opens a single approval page—nothing to paste."}</p>
      {activeAgents.length > 0 && <ul className="registered-agent-list">{activeAgents.map((agent) => <li key={agent.id}><strong>{agent.label}</strong><code>{agent.id}</code><small>{agent.keyFingerprint}</small></li>)}</ul>}
      <div className="local-agent-connection-card">
        <div>
          <span className="connection-card-status"><i aria-hidden="true" />Private Beta · local-first</span>
          <strong>{activeAgents.length > 0 ? "Add another local Codex only when you need it." : "No public key or API key is required."}</strong>
          <p>Proofweave never asks for your ChatGPT password, API key, private key, or workspace. You can later revoke the connection independently from its delegation.</p>
        </div>
        <Link className="button button-primary setup-action" href="/integrations#codex-beta">Install or connect Codex <span aria-hidden="true">→</span></Link>
      </div>
    </div>
  </article>;
}

function CertificateStep({ profile, active, deviceKeys, busy, onIssue }: {
  profile: DelegationProfile;
  active: StoredDelegation | null;
  deviceKeys: readonly PersonSigningKey[];
  busy: boolean;
  onIssue: (input: { signingKey: PersonSigningKey; agent: RegisteredAgent; selectedScopes: readonly Scope[]; days: number }) => Promise<void>;
}) {
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

  return <article className="delegation-step">
    <span className="step-number">03</span>
    <div>
      <span className="micro-label">Revocable delegation</span>
      <h3>{active
        ? "An active certificate already governs this Agent."
        : needsAgentIdentity
          ? "Connect a local Codex before granting authority."
          : "Sign the scope and expiry you are granting."}</h3>
      <p>{active
        ? "Creating another certificate is intentionally paused while one is active. Revoke it first if the Agent or authority needs to change."
        : needsAgentIdentity
          ? "The local Codex approval creates its Agent identity and a short, scoped delegation together."
          : "The certificate is signed by your device key, then stored as immutable evidence. Its revocation is a separate append-only event."}</p>
      {needsAgentIdentity ? <div className="certificate-prerequisite">
        <strong>Connect Codex first.</strong>
        <p>Open the Proofweave Research plugin in Codex and select Connect Proofweave. Its browser approval creates a device-bound Person key when needed, records the Agent public key, and signs a 30-day formalize/prove delegation.</p>
        <Link className="text-link" href="/integrations#codex-beta">See the three-step connection <span aria-hidden="true">→</span></Link>
      </div> : !active && <form className="delegation-form certificate-form" onSubmit={(event) => {
        event.preventDefault();
        if (signingKey && agent) void onIssue({ signingKey, agent, selectedScopes, days: Number(days) });
      }}>
        <label>Person signing key<select value={signingKey?.id ?? ""} onChange={(event) => setSigningKeyId(event.target.value)} disabled={verifiedDeviceKeys.length === 0}>{verifiedDeviceKeys.length === 0 ? <option>No possession-verified device key</option> : verifiedDeviceKeys.map((key) => <option value={key.id} key={key.id}>{key.fingerprint}</option>)}</select></label>
        <label>Delegated Agent<select value={agent?.id ?? ""} onChange={(event) => setAgentId(event.target.value)} disabled={availableAgents.length === 0}>{availableAgents.length === 0 ? <option>No registered Agent available</option> : availableAgents.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.label}</option>)}</select></label>
        <fieldset><legend>Allowed work</legend><div className="scope-checks">{scopes.map((scope) => <label key={scope}><input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} />{scope}</label>)}</div></fieldset>
        <label>Validity<select value={days} onChange={(event) => setDays(event.target.value)}><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></label>
        <button className="button button-primary setup-action" type="submit" disabled={!canIssue || busy}>{busy ? "Signing certificate…" : "Sign and activate delegation"}</button>
        {!canIssue && <small className="form-hint">A possession-verified device key, registered Agent, and at least one scope are required.</small>}
      </form>}
    </div>
  </article>;
}

function RevocationStep({ active, busy, onRevoke }: {
  active: StoredDelegation;
  busy: boolean;
  onRevoke: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  return <div className="revocation-panel">
    <div><span className="micro-label">Authority control</span><strong>Revoke {active.id}</strong><p>Revocation blocks new Agent-reported progress at the recorded time. It does not delete earlier signed history; the reason becomes part of its public audit record.</p></div>
    <form onSubmit={(event) => { event.preventDefault(); void onRevoke(reason); }}>
      <label>Public reason<input required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="For example: Agent key rotated" /></label>
      <button className="button button-danger" type="submit" disabled={busy}>{busy ? "Revoking…" : "Revoke active delegation"}</button>
    </form>
  </div>;
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

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(timestamp)
    : value;
}

function messageFor(cause: unknown): string {
  return cause instanceof Error ? cause.message : "The delegation action could not be completed.";
}
