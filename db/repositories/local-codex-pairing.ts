import { getD1 } from "@/db";
import type { PersonIdentity } from "./delegation";
import { getAccountAuthRepository } from "./account-auth";
import { D1ProofweaveOAuthStore } from "@/services/proofweave-identity/d1-oauth-store.mjs";

const localCallbackUrl = "http://127.0.0.1:44765/callback";
const localConnectorName = "Proofweave local Codex Connector";
const connectionPolicies = {
  research: {
    oauthScopes: ["catalog:read", "attempt:create", "attempt:read", "progress:write", "artifact:write", "run:request", "run:read", "run:cancel"],
    delegationScopes: ["formalize", "prove"],
  },
  review: {
    oauthScopes: ["catalog:read", "verification:replay", "verification:write"],
    delegationScopes: ["review"],
  },
  research_and_review: {
    oauthScopes: ["catalog:read", "attempt:create", "attempt:read", "progress:write", "artifact:write", "run:request", "run:read", "run:cancel", "verification:replay", "verification:write"],
    delegationScopes: ["formalize", "prove", "review"],
  },
} as const;
export type LocalCodexConnectionMode = keyof typeof connectionPolicies;
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
  connectionMode: LocalCodexConnectionMode;
  delegationScopes: readonly ("formalize" | "prove" | "review")[];
  expiresAt: string;
};

export class LocalCodexPairingError extends Error {}

export async function createLocalCodexPairing(input: {
  agentId: string;
  agentLabel: string;
  agentPublicKey: string;
  oauthState: string;
  codeChallenge: string;
  connectionMode?: string;
}): Promise<{ id: string; browserSecret: string; clientId: string; expiresAt: string }> {
  validateLocalAgent(input);
  const connectionMode = normalizeConnectionMode(input.connectionMode);
  const requestedScopes = connectionPolicies[connectionMode].oauthScopes;
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
  const connectionMode = connectionModeForStoredScopes(row.requested_scopes_json);
  return {
    id: row.id,
    agentId: row.agent_id,
    agentLabel: row.agent_label,
    agentPublicKey: row.agent_public_key,
    connectionMode,
    delegationScopes: connectionPolicies[connectionMode].delegationScopes,
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
  const connectionMode = connectionModeForStoredScopes(row.requested_scopes_json);
  const requestedScopes = connectionPolicies[connectionMode].oauthScopes;
  const store = new D1ProofweaveOAuthStore(getD1());
  const account = await getAccountAuthRepository().resolveIdentity(input.identity);
  const person = { id: account.personId };

  const eligible = await store.listEligibleAgents(person.id, requestedScopes);
  const agent = eligible.find(
    (candidate: { agentId: string; delegationCertificateId: string }) =>
      candidate.agentId === row.agent_id && candidate.delegationCertificateId === input.delegationCertificateId,
  );
  if (!agent) {
    const requirement = connectionMode === "research"
      ? "an active formalize or prove delegation"
      : connectionMode === "review"
        ? "an active review delegation"
        : "active formalize or prove and review authority";
    throw new LocalCodexPairingError(`This Agent needs ${requirement} before it can connect.`);
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
  connectionMode?: string;
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

function normalizeConnectionMode(value: unknown): LocalCodexConnectionMode {
  const mode = value === undefined ? "research" : value;
  if (typeof mode !== "string" || !(mode in connectionPolicies)) {
    throw new LocalCodexPairingError("connectionMode must be research, review, or research_and_review.");
  }
  return mode as LocalCodexConnectionMode;
}

function connectionModeForStoredScopes(value: string): LocalCodexConnectionMode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new LocalCodexPairingError("This local connection contains invalid requested scopes. Return to Codex and start it again.");
  }
  if (!Array.isArray(parsed) || !parsed.every((scope) => typeof scope === "string")) {
    throw new LocalCodexPairingError("This local connection contains invalid requested scopes. Return to Codex and start it again.");
  }
  const canonical = [...new Set(parsed)].sort().join(" ");
  const match = (Object.entries(connectionPolicies) as Array<[LocalCodexConnectionMode, typeof connectionPolicies[LocalCodexConnectionMode]]>)
    .find(([, policy]) => [...policy.oauthScopes].sort().join(" ") === canonical);
  if (!match) {
    throw new LocalCodexPairingError("This local connection requests an unsupported permission set. Return to Codex and start it again.");
  }
  return match[0];
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
