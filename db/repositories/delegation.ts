import { getD1 } from "@/db";
import {
  assertDelegationAllows,
  delegationPayloadHash,
  delegationSigningPayload,
  delegationValidityAt,
  normalizeDelegationCertificate,
  verifyDelegationSignature,
} from "@/packages/domain/delegation.mjs";
import { canonicalJson, sha256Canonical } from "@/packages/protocol/canonical-json.mjs";

export type PersonIdentity = Readonly<{
  provider: "chatgpt" | "proofweave";
  subject: string;
  displayName: string;
}>;

export type DelegationPerson = Readonly<{
  id: string;
  displayName: string;
}>;

export type PersonSigningKey = Readonly<{
  id: string;
  algorithm: "ed25519";
  publicKey: string;
  fingerprint: string;
  revokedAt: string | null;
  createdAt: string;
}>;

export type RegisteredAgent = Readonly<{
  id: string;
  label: string;
  publicKey: string;
  keyFingerprint: string;
  status: "active" | "revoked";
  revokedAt: string | null;
  createdAt: string;
}>;

export type StoredDelegation = Readonly<{
  id: string;
  agentId: string;
  agentPublicKey: string;
  personKeyId: string;
  scopes: readonly string[];
  validFrom: string;
  validUntil: string;
  beneficiaryPersonId: string;
  payloadHash: string;
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
}>;

export type DelegationProfile = Readonly<{
  person: DelegationPerson;
  signingKeys: readonly PersonSigningKey[];
  agents: readonly RegisteredAgent[];
  delegations: readonly StoredDelegation[];
}>;

export class DelegationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegationConflictError";
  }
}

export class DelegationNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegationNotFoundError";
  }
}

export class DelegationAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DelegationAuthorizationError";
  }
}

type PersonRow = { id: string; display_name: string };
type KeyRow = {
  id: string;
  person_id: string;
  algorithm: "ed25519";
  public_key: string;
  fingerprint: string;
  revoked_at: string | null;
  created_at: string;
};
type AgentRow = {
  id: string;
  owner_person_id: string;
  label: string;
  public_key: string;
  key_fingerprint: string;
  status: "active" | "revoked";
  revoked_at: string | null;
  created_at: string;
};
type DelegationRow = {
  id: string;
  owner_person_id: string;
  agent_id: string;
  person_key_id: string;
  agent_public_key: string;
  scopes_json: string;
  valid_from: string;
  valid_until: string;
  beneficiary_person_id: string;
  payload_hash: string;
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
};

export interface DelegationRepository {
  getProfile(identity: PersonIdentity): Promise<DelegationProfile>;
  registerPersonKey(identity: PersonIdentity, publicKey: string): Promise<{ key: PersonSigningKey; created: boolean }>;
  registerAgent(
    identity: PersonIdentity,
    input: { agentId: string; label: string; publicKey: string },
  ): Promise<{ agent: RegisteredAgent; created: boolean }>;
  issueDelegation(
    identity: PersonIdentity,
    input: { personKeyId: string; certificate: unknown; personSignature: string },
  ): Promise<{ delegation: StoredDelegation; created: boolean }>;
  revokeDelegation(
    identity: PersonIdentity,
    input: { delegationId: string; reason: string; revokedAt: string },
  ): Promise<StoredDelegation>;
  assertAuthorizedDelegation(
    personId: string,
    delegationId: string,
    scope: "formalize" | "prove" | "review",
    eventTime: string,
  ): Promise<StoredDelegation>;
}

class D1DelegationRepository implements DelegationRepository {
  async getProfile(identity: PersonIdentity): Promise<DelegationProfile> {
    const person = await this.upsertPerson(identity);
    const [keys, agents, delegations] = await Promise.all([
      getD1()
        .prepare(
          "SELECT id, person_id, algorithm, public_key, fingerprint, revoked_at, created_at FROM person_keys WHERE person_id = ? ORDER BY created_at DESC",
        )
        .bind(person.id)
        .all<KeyRow>(),
      getD1()
        .prepare(
          "SELECT id, owner_person_id, label, public_key, key_fingerprint, status, revoked_at, created_at FROM agents WHERE owner_person_id = ? ORDER BY created_at DESC",
        )
        .bind(person.id)
        .all<AgentRow>(),
      getD1()
        .prepare(
          `SELECT certificate.id, certificate.owner_person_id, certificate.agent_id,
                  certificate.person_key_id, certificate.agent_public_key,
                  certificate.scopes_json, certificate.valid_from, certificate.valid_until,
                  certificate.beneficiary_person_id, certificate.payload_hash,
                  revocation.revoked_at, revocation.reason AS revocation_reason,
                  certificate.created_at
           FROM delegation_certificates AS certificate
           LEFT JOIN delegation_revocations AS revocation
             ON revocation.delegation_certificate_id = certificate.id
           WHERE certificate.owner_person_id = ?
           ORDER BY certificate.created_at DESC`,
        )
        .bind(person.id)
        .all<DelegationRow>(),
    ]);

    return {
      person: toPerson(person),
      signingKeys: (keys.results ?? []).map(toPersonKey),
      agents: (agents.results ?? []).map(toAgent),
      delegations: (delegations.results ?? []).map(toDelegation),
    };
  }

  async registerPersonKey(
    identity: PersonIdentity,
    publicKey: string,
  ): Promise<{ key: PersonSigningKey; created: boolean }> {
    // The certificate validator performs exact base64url/Ed25519 length checks.
    normalizeDelegationCertificate(exampleCertificate({ agentPublicKey: publicKey }));
    const person = await this.upsertPerson(identity);
    const fingerprint = await keyFingerprint(publicKey);
    const inserted = await getD1()
      .prepare(
        "INSERT OR IGNORE INTO person_keys (id, person_id, public_key, fingerprint) VALUES (?, ?, ?, ?)",
      )
      .bind(newId("person-key"), person.id, publicKey, fingerprint)
      .run();
    const row = await getD1()
      .prepare(
        "SELECT id, person_id, algorithm, public_key, fingerprint, revoked_at, created_at FROM person_keys WHERE public_key = ?",
      )
      .bind(publicKey)
      .first<KeyRow>();
    if (!row) throw new Error("Person key registration did not produce a readable record.");
    if (row.person_id !== person.id) {
      throw new DelegationConflictError("This signing key is already registered to another Person.");
    }
    return { key: toPersonKey(row), created: inserted.meta.changes === 1 };
  }

  async registerAgent(
    identity: PersonIdentity,
    input: { agentId: string; label: string; publicKey: string },
  ): Promise<{ agent: RegisteredAgent; created: boolean }> {
    requireInputString(input.agentId, "agentId", 240);
    requireInputString(input.label, "label", 120);
    normalizeDelegationCertificate(
      exampleCertificate({ id: "delegation:agent-key-validation", agentId: input.agentId, agentPublicKey: input.publicKey }),
    );
    const person = await this.upsertPerson(identity);
    const fingerprint = await keyFingerprint(input.publicKey);
    const inserted = await getD1()
      .prepare(
        "INSERT OR IGNORE INTO agents (id, owner_person_id, label, public_key, key_fingerprint) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(input.agentId, person.id, input.label.trim(), input.publicKey, fingerprint)
      .run();
    const row = await getD1()
      .prepare(
        "SELECT id, owner_person_id, label, public_key, key_fingerprint, status, revoked_at, created_at FROM agents WHERE id = ?",
      )
      .bind(input.agentId)
      .first<AgentRow>();
    if (!row) throw new Error("Agent registration did not produce a readable record.");
    if (
      row.owner_person_id !== person.id ||
      row.label !== input.label.trim() ||
      row.public_key !== input.publicKey
    ) {
      throw new DelegationConflictError("An Agent id cannot be reused with different ownership or key material.");
    }
    return { agent: toAgent(row), created: inserted.meta.changes === 1 };
  }

  async issueDelegation(
    identity: PersonIdentity,
    input: { personKeyId: string; certificate: unknown; personSignature: string },
  ): Promise<{ delegation: StoredDelegation; created: boolean }> {
    requireInputString(input.personKeyId, "personKeyId", 240);
    const person = await this.upsertPerson(identity);
    const certificate = normalizeDelegationCertificate(input.certificate);
    if (
      certificate.ownerPersonId !== person.id ||
      certificate.attributionPolicy.beneficiaryPersonId !== person.id
    ) {
      throw new DelegationAuthorizationError("A Person can issue a delegation only for their own attribution identity.");
    }

    const [personKey, agent] = await Promise.all([
      getD1()
        .prepare(
          "SELECT id, person_id, algorithm, public_key, fingerprint, revoked_at, created_at FROM person_keys WHERE id = ?",
        )
        .bind(input.personKeyId)
        .first<KeyRow>(),
      getD1()
        .prepare(
          "SELECT id, owner_person_id, label, public_key, key_fingerprint, status, revoked_at, created_at FROM agents WHERE id = ?",
        )
        .bind(certificate.agentId)
        .first<AgentRow>(),
    ]);
    if (!personKey || personKey.person_id !== person.id || personKey.revoked_at) {
      throw new DelegationAuthorizationError("The selected Person signing key is unavailable.");
    }
    if (!agent || agent.owner_person_id !== person.id || agent.status !== "active" || agent.revoked_at) {
      throw new DelegationAuthorizationError("The selected Agent is unavailable.");
    }
    if (agent.public_key !== certificate.agentPublicKey) {
      throw new DelegationConflictError("Delegation Agent public key does not match the registered Agent.");
    }
    if (
      !(await verifyDelegationSignature({
        certificate,
        personPublicKey: personKey.public_key,
        personSignature: input.personSignature,
      }))
    ) {
      throw new DelegationAuthorizationError("The Person signature does not verify this delegation certificate.");
    }

    const payloadHash = await delegationPayloadHash(certificate);
    const canonicalPayload = canonicalJson(delegationSigningPayload(certificate));
    const inserted = await getD1()
      .prepare(
        `INSERT OR IGNORE INTO delegation_certificates (
          id, owner_person_id, agent_id, person_key_id, agent_public_key,
          scopes_json, valid_from, valid_until, beneficiary_person_id,
          protocol_version, payload_hash, canonical_payload, person_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        certificate.id,
        person.id,
        certificate.agentId,
        personKey.id,
        certificate.agentPublicKey,
        JSON.stringify(certificate.scopes),
        certificate.validFrom,
        certificate.validUntil,
        person.id,
        "pw-delegation-v1",
        payloadHash,
        canonicalPayload,
        input.personSignature,
      )
      .run();
    const row = await this.findDelegation(certificate.id);
    if (!row) throw new Error("Delegation insert did not produce a readable record.");
    if (row.payload_hash !== payloadHash || row.owner_person_id !== person.id) {
      throw new DelegationConflictError("A delegation id cannot be reused for different signed evidence.");
    }
    return { delegation: toDelegation(row), created: inserted.meta.changes === 1 };
  }

  async revokeDelegation(
    identity: PersonIdentity,
    input: { delegationId: string; reason: string; revokedAt: string },
  ): Promise<StoredDelegation> {
    requireInputString(input.delegationId, "delegationId", 240);
    requireInputString(input.reason, "reason", 1_000);
    const person = await this.upsertPerson(identity);
    const certificate = await this.findDelegation(input.delegationId);
    if (!certificate || certificate.owner_person_id !== person.id) {
      throw new DelegationNotFoundError("Delegation certificate not found.");
    }
    // Parse the timestamp through the protocol's UTC-instant validation. A
    // revocation may be future-dated for a scheduled cutover.
    delegationValidityAt(toCertificate(certificate), input.revokedAt);
    if (certificate.revoked_at) {
      if (
        certificate.revoked_at !== input.revokedAt ||
        certificate.revocation_reason !== input.reason.trim()
      ) {
        throw new DelegationConflictError("A delegation certificate already has a different revocation event.");
      }
      return toDelegation(certificate);
    }
    await getD1()
      .prepare(
        "INSERT OR IGNORE INTO delegation_revocations (id, delegation_certificate_id, owner_person_id, revoked_at, reason) VALUES (?, ?, ?, ?, ?)",
      )
      .bind(newId("delegation-revocation"), certificate.id, person.id, input.revokedAt, input.reason.trim())
      .run();
    const revoked = await this.findDelegation(input.delegationId);
    if (!revoked) throw new Error("Delegation revocation could not be read.");
    return toDelegation(revoked);
  }

  async assertAuthorizedDelegation(
    personId: string,
    delegationId: string,
    scope: "formalize" | "prove" | "review",
    eventTime: string,
  ): Promise<StoredDelegation> {
    const row = await this.findDelegation(delegationId);
    if (!row || row.owner_person_id !== personId) {
      throw new DelegationNotFoundError("Delegation certificate not found.");
    }
    assertDelegationAllows(toCertificate(row), scope, eventTime, row.revoked_at);
    return toDelegation(row);
  }

  private async upsertPerson(identity: PersonIdentity): Promise<PersonRow> {
    requireInputString(identity.subject, "identity subject", 320);
    requireInputString(identity.displayName, "display name", 160);
    const subject = identity.subject.trim().toLowerCase();
    const now = new Date().toISOString();
    await getD1()
      .prepare(
        `INSERT INTO persons (id, identity_provider, provider_subject, display_name, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(identity_provider, provider_subject)
         DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`,
      )
      .bind(newId("person"), identity.provider, subject, identity.displayName.trim(), now)
      .run();
    const person = await getD1()
      .prepare(
        "SELECT id, display_name FROM persons WHERE identity_provider = ? AND provider_subject = ?",
      )
      .bind(identity.provider, subject)
      .first<PersonRow>();
    if (!person) throw new Error("Person identity mapping did not produce a readable record.");
    return person;
  }

  private async findDelegation(id: string): Promise<DelegationRow | null> {
    return getD1()
      .prepare(
        `SELECT certificate.id, certificate.owner_person_id, certificate.agent_id,
                certificate.person_key_id, certificate.agent_public_key,
                certificate.scopes_json, certificate.valid_from, certificate.valid_until,
                certificate.beneficiary_person_id, certificate.payload_hash,
                revocation.revoked_at, revocation.reason AS revocation_reason,
                certificate.created_at
         FROM delegation_certificates AS certificate
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         WHERE certificate.id = ?`,
      )
      .bind(id)
      .first<DelegationRow>();
  }
}

export function getDelegationRepository(): DelegationRepository {
  return new D1DelegationRepository();
}

function toPerson(row: PersonRow): DelegationPerson {
  return { id: row.id, displayName: row.display_name };
}

function toPersonKey(row: KeyRow): PersonSigningKey {
  return {
    id: row.id,
    algorithm: row.algorithm,
    publicKey: row.public_key,
    fingerprint: row.fingerprint,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

function toAgent(row: AgentRow): RegisteredAgent {
  return {
    id: row.id,
    label: row.label,
    publicKey: row.public_key,
    keyFingerprint: row.key_fingerprint,
    status: row.status,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

function toDelegation(row: DelegationRow): StoredDelegation {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentPublicKey: row.agent_public_key,
    personKeyId: row.person_key_id,
    scopes: parseScopes(row.scopes_json),
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    beneficiaryPersonId: row.beneficiary_person_id,
    payloadHash: row.payload_hash,
    revokedAt: row.revoked_at,
    revocationReason: row.revocation_reason,
    createdAt: row.created_at,
  };
}

function toCertificate(row: DelegationRow) {
  return {
    id: row.id,
    ownerPersonId: row.owner_person_id,
    agentId: row.agent_id,
    agentPublicKey: row.agent_public_key,
    scopes: parseScopes(row.scopes_json),
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    attributionPolicy: {
      beneficiaryPersonId: row.beneficiary_person_id,
      mode: "agent_delegated",
    },
  };
}

function parseScopes(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((scope) => typeof scope === "string")) {
      return parsed;
    }
  } catch {
    // A corrupted scopes record is rejected by normalization at its use point.
  }
  throw new Error("Delegation certificate contains malformed scope data.");
}

function exampleCertificate(overrides: Record<string, string> = {}) {
  return {
    id: "delegation:key-validation",
    ownerPersonId: "person:key-validation",
    agentId: "agent:key-validation",
    agentPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    scopes: ["formalize"],
    validFrom: "2026-01-01T00:00:00Z",
    validUntil: "2027-01-01T00:00:00Z",
    attributionPolicy: { beneficiaryPersonId: "person:key-validation", mode: "agent_delegated" },
    ...overrides,
  };
}

async function keyFingerprint(publicKey: string): Promise<string> {
  return sha256Canonical({ algorithm: "ed25519", public_key: publicKey });
}

function requireInputString(value: string, label: string, maxLength: number) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
}

function newId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}
