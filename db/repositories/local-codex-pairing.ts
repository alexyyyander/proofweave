import { getD1 } from "@/db";
import type { PersonIdentity } from "./delegation";
import { D1ProofweaveOAuthStore } from "@/services/proofweave-identity/d1-oauth-store.mjs";

const localCallbackUrl = "http://127.0.0.1:44765/callback";
const localConnectorName = "Proofweave local Codex Connector";
const requestedScopes = ["catalog:read", "attempt:create", "attempt:read", "progress:write"] as const;
const pairingLifetimeMs = 10 * 60 * 1_000;

type PairingRow = {
  id: string;
  browser_secret_hash: string;
  agent_id: string;
  agent_label: string;
  agent_public_key: string;
  redirect_uri: string;
  oauth_client_id: string;
  oauth_state: string;
  code_challenge: string;
  requested_scopes_json: string;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
  person_id: string | null;
  delegation_certificate_id: string | null;
  agent_installation_id: string | null;
};

export type LocalCodexPairingPreview = {
  id: string;
  agentId: string;
  agentLabel: string;
  agentPublicKey: string;
  expiresAt: string;
};

export class LocalCodexPairingError extends Error {}

export async function createLocalCodexPairing(input: {
  agentId: string;
  agentLabel: string;
  agentPublicKey: string;
  oauthState: string;
  codeChallenge: string;
}): Promise<{ id: string; browserSecret: string; clientId: string; expiresAt: string }> {
  validateLocalAgent(input);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + pairingLifetimeMs).toISOString();
  const browserSecret = randomBase64Url(32);
  const store = new D1ProofweaveOAuthStore(getD1());
  const client = await store.registerClient({
    clientName: localConnectorName,
    redirectUris: [localCallbackUrl],
    tokenEndpointAuthMethod: "none",
  });
  const id = `pw:codex-pairing:${crypto.randomUUID()}`;
  await getD1()
    .prepare(
      `INSERT INTO local_codex_pairing_sessions (
        id, browser_secret_hash, agent_id, agent_label, agent_public_key,
        redirect_uri, oauth_client_id, oauth_state, code_challenge,
        requested_scopes_json, created_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      await sha256(browserSecret),
      input.agentId.trim(),
      input.agentLabel.trim(),
      input.agentPublicKey,
      localCallbackUrl,
      client.client_id,
      input.oauthState,
      input.codeChallenge,
      JSON.stringify(requestedScopes),
      issuedAt.toISOString(),
      expiresAt,
    )
    .run();
  return { id, browserSecret, clientId: client.client_id, expiresAt };
}

export async function inspectLocalCodexPairing(input: {
  pairingId: string;
  browserSecret: string;
}): Promise<LocalCodexPairingPreview> {
  const row = await requireLivePairing(input);
  return {
    id: row.id,
    agentId: row.agent_id,
    agentLabel: row.agent_label,
    agentPublicKey: row.agent_public_key,
    expiresAt: row.expires_at,
  };
}

export async function approveLocalCodexPairing(input: {
  pairingId: string;
  browserSecret: string;
  identity: PersonIdentity;
  delegationCertificateId: string;
  resource: string;
}): Promise<{ redirectUrl: string; installationId: string }> {
  boundedString(input.delegationCertificateId, "delegationCertificateId", 240);
  const row = await requireLivePairing({ pairingId: input.pairingId, browserSecret: input.browserSecret });
  const store = new D1ProofweaveOAuthStore(getD1());
  const person = await getD1()
    .prepare("SELECT id FROM persons WHERE identity_provider = ? AND provider_subject = ?")
    .bind(input.identity.provider, input.identity.subject.trim().toLowerCase())
    .first<{ id: string }>();
  if (!person) throw new LocalCodexPairingError("Open Proofweave settings before approving a local Codex connection.");

  const eligible = await store.listEligibleAgents(person.id, requestedScopes);
  const agent = eligible.find(
    (candidate: { agentId: string; delegationCertificateId: string }) =>
      candidate.agentId === row.agent_id && candidate.delegationCertificateId === input.delegationCertificateId,
  );
  if (!agent) {
    throw new LocalCodexPairingError("This Agent needs an active formalize or prove delegation before it can connect.");
  }
  const installation = await store.ensureAgentInstallation({
    personId: person.id,
    clientId: row.oauth_client_id,
    agentId: row.agent_id,
    delegationCertificateId: input.delegationCertificateId,
  });
  if (!installation) throw new LocalCodexPairingError("The approved Agent installation is no longer available.");

  const approvedAt = new Date().toISOString();
  const changed = await getD1()
    .prepare(
      `UPDATE local_codex_pairing_sessions
       SET approved_at = ?, person_id = ?, delegation_certificate_id = ?, agent_installation_id = ?
       WHERE id = ? AND browser_secret_hash = ? AND approved_at IS NULL AND expires_at > ?`,
    )
    .bind(
      approvedAt,
      person.id,
      input.delegationCertificateId,
      installation.id,
      row.id,
      await sha256(input.browserSecret),
      approvedAt,
    )
    .run();
  if (changed.meta.changes !== 1) {
    throw new LocalCodexPairingError("This local connection was already approved or expired. Return to Codex and start it again.");
  }

  const code = randomBase64Url(32);
  await store.issueAuthorizationCode({
    codeHash: await sha256(code),
    clientId: row.oauth_client_id,
    redirectUri: row.redirect_uri,
    resource: input.resource,
    personId: person.id,
    agentInstallationId: installation.id,
    scopes: requestedScopes,
    codeChallenge: row.code_challenge,
    issuedAt: approvedAt,
    expiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
  });
  const redirect = new URL(row.redirect_uri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("state", row.oauth_state);
  return { redirectUrl: redirect.toString(), installationId: installation.id };
}

async function requireLivePairing(input: { pairingId: string; browserSecret: string }): Promise<PairingRow> {
  boundedString(input.pairingId, "pairingId", 240);
  boundedString(input.browserSecret, "browserSecret", 256);
  const now = new Date().toISOString();
  const row = await getD1()
    .prepare(
      `SELECT id, browser_secret_hash, agent_id, agent_label, agent_public_key,
              redirect_uri, oauth_client_id, oauth_state, code_challenge,
              requested_scopes_json, created_at, expires_at, approved_at,
              person_id, delegation_certificate_id, agent_installation_id
       FROM local_codex_pairing_sessions
       WHERE id = ? AND browser_secret_hash = ? AND expires_at > ?`,
    )
    .bind(input.pairingId, await sha256(input.browserSecret), now)
    .first<PairingRow>();
  if (!row) throw new LocalCodexPairingError("This local connection link is invalid or has expired. Return to Codex and try again.");
  if (row.approved_at) throw new LocalCodexPairingError("This local connection was already approved. Return to Codex to continue.");
  return row;
}

function validateLocalAgent(input: {
  agentId: string;
  agentLabel: string;
  agentPublicKey: string;
  oauthState: string;
  codeChallenge: string;
}) {
  boundedString(input.agentId, "agentId", 240);
  boundedString(input.agentLabel, "agentLabel", 120);
  boundedString(input.oauthState, "oauthState", 256);
  boundedString(input.codeChallenge, "codeChallenge", 128);
  if (!input.agentId.startsWith("urn:pw:agent:")) {
    throw new LocalCodexPairingError("agentId must be a stable Proofweave Agent URN.");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.agentPublicKey)) {
    throw new LocalCodexPairingError("agentPublicKey must be a base64url-encoded Ed25519 public key.");
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) {
    throw new LocalCodexPairingError("codeChallenge must be an S256 PKCE challenge.");
  }
}

function boundedString(value: unknown, name: string, max: number): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new LocalCodexPairingError(`${name} is required and must be at most ${max} characters.`);
  }
}

function randomBase64Url(bytes: number): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
