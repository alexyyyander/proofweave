"use client";

import type {
  PersonKeyProof,
  PersonKeyProofChallenge,
  PersonKeyRevocation,
  PersonSigningKey,
  RegisteredAgent,
  StoredDelegation,
} from "@/db/repositories/delegation";

type ApiError = { error?: { message?: string } };

export async function registerPersonKey(publicKey: string): Promise<PersonSigningKey> {
  const result = await post<{ key: PersonSigningKey }>("/api/me/keys", { publicKey });
  return result.key;
}

export async function issuePersonKeyProofChallenge(keyId: string): Promise<PersonKeyProofChallenge> {
  const result = await post<{ challenge: PersonKeyProofChallenge }>(
    `/api/me/keys/${encodeURIComponent(keyId)}/proof-challenge`,
    {},
  );
  return result.challenge;
}

export async function submitPersonKeyProof(input: {
  keyId: string;
  challengeId: string;
  personSignature: string;
}): Promise<PersonKeyProof> {
  const result = await post<{ proof: PersonKeyProof }>(
    `/api/me/keys/${encodeURIComponent(input.keyId)}/proof`,
    { challengeId: input.challengeId, personSignature: input.personSignature },
  );
  return result.proof;
}

export async function revokePersonKey(input: {
  keyId: string;
  reason: string;
  emergency: boolean;
}): Promise<PersonKeyRevocation> {
  const result = await post<{ revocation: PersonKeyRevocation }>(
    `/api/me/keys/${encodeURIComponent(input.keyId)}/revoke`,
    { reason: input.reason, emergency: input.emergency },
  );
  return result.revocation;
}

export async function registerAgent(input: {
  agentId: string;
  label: string;
  publicKey: string;
}): Promise<RegisteredAgent> {
  const result = await post<{ agent: RegisteredAgent }>("/api/me/agents", input);
  return result.agent;
}

export async function issueDelegation(input: {
  personKeyId: string;
  certificate: unknown;
  personSignature: string;
}): Promise<StoredDelegation> {
  const result = await post<{ delegation: StoredDelegation }>("/api/me/delegations", input);
  return result.delegation;
}

export async function revokeDelegation(delegationId: string, reason: string): Promise<void> {
  await post(`/api/me/delegations/${encodeURIComponent(delegationId)}/revoke`, {
    reason,
    revokedAt: new Date().toISOString(),
  });
}

async function post<T = undefined>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({} as ApiError));
  if (!response.ok) {
    const message = (payload as ApiError).error?.message ?? "The delegation request could not be completed.";
    throw new Error(message);
  }
  return payload as T;
}
