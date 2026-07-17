import { getD1 } from "@/db";
import { getAccountAuthRepository } from "@/db/repositories/account-auth";
import {
  assertDelegationAllows,
  delegationPayloadHash,
  delegationProtocolVersion,
  delegationSigningPayload,
  delegationValidityAt,
  normalizeDelegationCertificate,
  verifyDelegationSignature,
} from "@/packages/domain/delegation.mjs";
import { canonicalJson, sha256Canonical } from "@/packages/protocol/canonical-json.mjs";
import {
  personKeyProofChallengePayloadHash,
  personKeyProofChallengeProtocolVersion,
  personKeyProofChallengeSigningPayload,
  normalizePersonKeyProofChallenge,
  verifyPersonKeyProofChallengeSignature,
} from "@/packages/protocol/person-key-proof.mjs";

export type PersonIdentity = Readonly<{
  provider: "chatgpt" | "google" | "proofweave";
  subject: string;
  displayName: string;
  email?: string | null;
  emailVerified?: boolean;
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
  revocationReason: string | null;
  possessionVerifiedAt: string | null;
  createdAt: string;
}>;

export type PersonKeyRevocation = Readonly<{
  id: string;
  personKeyId: string;
  revokedAt: string;
  reason: string;
}>;

export type PersonKeyProofChallenge = Readonly<{
  protocolVersion: string;
  id: string;
  personId: string;
  personKeyId: string;
  personPublicKey: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}>;

export type PersonKeyProof = Readonly<{
  id: string;
  challengeId: string;
  personKeyId: string;
  payloadHash: string;
  verifiedAt: string;
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
  signerKeyRevokedAt: string | null;
  signerKeyRevocationReason: string | null;
  createdAt: string;
}>;

export type AgentInstallation = Readonly<{
  id: string;
  agentId: string;
  agentLabel: string;
  delegationCertificateId: string;
  delegationScopes: readonly string[];
  clientId: string;
  clientName: string;
  label: string;
  status: "active" | "revoked";
  revokedAt: string | null;
  revocationReason: string | null;
  createdAt: string;
}>;

export type DelegationProfile = Readonly<{
  person: DelegationPerson;
  signingKeys: readonly PersonSigningKey[];
  agents: readonly RegisteredAgent[];
  delegations: readonly StoredDelegation[];
  agentInstallations: readonly AgentInstallation[];
}>;

/**
 * The deliberately minimal public view of a delegation. It contains the
 * signed authority, the public verification key, and any append-only
 * revocation event. Provider subjects, display names, and all private key
 * material stay outside this record.
 */
export type PublicDelegationRecord = Readonly<{
  protocolVersion: string;
  certificate: Readonly<{
    id: string;
    ownerPersonId: string;
    agentId: string;
    agentPublicKey: string;
    scopes: readonly string[];
    validFrom: string;
    validUntil: string;
    attributionPolicy: Readonly<{
      beneficiaryPersonId: string;
      mode: "agent_delegated";
    }>;
  }>;
  signer: Readonly<{
    keyId: string;
    algorithm: "ed25519";
    publicKey: string;
    fingerprint: string;
    keyRevocation: Readonly<{
      revokedAt: string;
      reason: string | null;
    }> | null;
  }>;
  evidence: Readonly<{
    payloadHash: string;
    canonicalPayload: string;
    personSignature: string;
  }>;
  revocation: Readonly<{
    revokedAt: string;
    reason: string;
  }> | null;
  recordedAt: string;
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
  revocation_reason: string | null;
  possession_verified_at: string | null;
  created_at: string;
};
type ChallengeRow = {
  id: string;
  person_id: string;
  person_key_id: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
  canonical_payload: string;
  payload_hash: string;
  public_key: string;
  revoked_at: string | null;
};
type ProofRow = {
  id: string;
  challenge_id: string;
  person_id: string;
  person_key_id: string;
  protocol_version: string;
  canonical_payload: string;
  payload_hash: string;
  person_signature: string;
  verified_at: string;
};
type KeyRevocationRow = {
  id: string;
  person_key_id: string;
  owner_person_id: string;
  revoked_at: string;
  reason: string;
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
  signer_key_revoked_at: string | null;
  signer_key_revocation_reason: string | null;
  created_at: string;
};
type AgentInstallationRow = {
  id: string;
  agent_id: string;
  agent_label: string;
  delegation_certificate_id: string;
  scopes_json: string;
  client_id: string;
  client_name: string;
  label: string;
  status: "active" | "revoked";
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
};
type PublicDelegationRow = DelegationRow & {
  protocol_version: string;
  canonical_payload: string;
  person_signature: string;
  signer_algorithm: "ed25519";
  signer_public_key: string;
  signer_fingerprint: string;
};

export interface DelegationRepository {
  getProfile(identity: PersonIdentity): Promise<DelegationProfile>;
  getPublicDelegation(id: string): Promise<PublicDelegationRecord | null>;
  registerPersonKey(identity: PersonIdentity, publicKey: string): Promise<{ key: PersonSigningKey; created: boolean }>;
  revokePersonKey(
    identity: PersonIdentity,
    input: { keyId: string; reason: string; emergency: boolean },
  ): Promise<{ revocation: PersonKeyRevocation; created: boolean }>;
  issuePersonKeyProofChallenge(identity: PersonIdentity, keyId: string): Promise<PersonKeyProofChallenge>;
  verifyPersonKeyProof(
    identity: PersonIdentity,
    input: { keyId: string; challengeId: string; personSignature: string },
  ): Promise<{ proof: PersonKeyProof; created: boolean }>;
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
  revokeAgentInstallation(
    identity: PersonIdentity,
    input: { installationId: string; reason: string; revokedAt: string },
  ): Promise<AgentInstallation>;
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
    const [keys, agents, delegations, agentInstallations] = await Promise.all([
      getD1()
        .prepare(
          `SELECT key.id, key.person_id, key.algorithm, key.public_key, key.fingerprint,
                  COALESCE(key_revocation.revoked_at, key.revoked_at) AS revoked_at,
                  key_revocation.reason AS revocation_reason, key.created_at,
                  (SELECT MAX(proof.verified_at) FROM person_key_proof_events AS proof WHERE proof.person_key_id = key.id) AS possession_verified_at
           FROM person_keys AS key
           LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = key.id
           WHERE key.person_id = ?
           ORDER BY key.created_at DESC`,
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
                  COALESCE(key_revocation.revoked_at, signer.revoked_at) AS signer_key_revoked_at,
                  key_revocation.reason AS signer_key_revocation_reason,
                  certificate.created_at
           FROM delegation_certificates AS certificate
           INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
           LEFT JOIN delegation_revocations AS revocation
             ON revocation.delegation_certificate_id = certificate.id
           LEFT JOIN person_key_revocations AS key_revocation
             ON key_revocation.person_key_id = certificate.person_key_id
           WHERE certificate.owner_person_id = ?
           ORDER BY certificate.created_at DESC`,
        )
        .bind(person.id)
        .all<DelegationRow>(),
      getD1()
        .prepare(
          `SELECT installation.id, installation.agent_id, agent.label AS agent_label,
                  installation.delegation_certificate_id, certificate.scopes_json,
                  installation.client_id, client.client_name, installation.label,
                  installation.status, installation.revoked_at,
                  revocation.reason AS revocation_reason, installation.created_at
           FROM agent_installations AS installation
           INNER JOIN agents AS agent ON agent.id = installation.agent_id
           INNER JOIN delegation_certificates AS certificate
             ON certificate.id = installation.delegation_certificate_id
           INNER JOIN oauth_clients AS client ON client.id = installation.client_id
           LEFT JOIN agent_installation_revocations AS revocation
             ON revocation.agent_installation_id = installation.id
           WHERE installation.person_id = ?
           ORDER BY installation.created_at DESC`,
        )
        .bind(person.id)
        .all<AgentInstallationRow>(),
    ]);

    return {
      person: toPerson(person),
      signingKeys: (keys.results ?? []).map(toPersonKey),
      agents: (agents.results ?? []).map(toAgent),
      delegations: (delegations.results ?? []).map(toDelegation),
      agentInstallations: (agentInstallations.results ?? []).map(toAgentInstallation),
    };
  }

  async getPublicDelegation(id: string): Promise<PublicDelegationRecord | null> {
    if (typeof id !== "string" || id.trim().length === 0 || id.length > 240) return null;
    const row = await getD1()
      .prepare(
        `SELECT certificate.id, certificate.owner_person_id, certificate.agent_id,
                certificate.person_key_id, certificate.agent_public_key,
                certificate.scopes_json, certificate.valid_from, certificate.valid_until,
                certificate.beneficiary_person_id, certificate.protocol_version,
                certificate.payload_hash, certificate.canonical_payload,
                certificate.person_signature, revocation.revoked_at,
                revocation.reason AS revocation_reason, certificate.created_at,
                signer.algorithm AS signer_algorithm, signer.public_key AS signer_public_key,
                signer.fingerprint AS signer_fingerprint,
                COALESCE(key_revocation.revoked_at, signer.revoked_at) AS signer_key_revoked_at,
                key_revocation.reason AS signer_key_revocation_reason
         FROM delegation_certificates AS certificate
         INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         LEFT JOIN person_key_revocations AS key_revocation
           ON key_revocation.person_key_id = signer.id
         WHERE certificate.id = ?`,
      )
      .bind(id)
      .first<PublicDelegationRow>();
    if (!row) return null;

    const certificate = toCertificate(row);
    const canonicalPayload = canonicalJson(delegationSigningPayload(certificate));
    const payloadHash = await delegationPayloadHash(certificate);
    const signatureValid = await verifyDelegationSignature({
      certificate,
      personPublicKey: row.signer_public_key,
      personSignature: row.person_signature,
    });
    if (
      row.protocol_version !== delegationProtocolVersion ||
      row.canonical_payload !== canonicalPayload ||
      row.payload_hash !== payloadHash ||
      !signatureValid
    ) {
      throw new Error("Stored delegation evidence did not pass its integrity check.");
    }
    return toPublicDelegation(row, canonicalPayload);
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
        `SELECT key.id, key.person_id, key.algorithm, key.public_key, key.fingerprint,
                COALESCE(key_revocation.revoked_at, key.revoked_at) AS revoked_at,
                key_revocation.reason AS revocation_reason, key.created_at,
                (SELECT MAX(proof.verified_at) FROM person_key_proof_events AS proof WHERE proof.person_key_id = key.id) AS possession_verified_at
         FROM person_keys AS key
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = key.id
         WHERE key.public_key = ?`,
      )
      .bind(publicKey)
      .first<KeyRow>();
    if (!row) throw new Error("Person key registration did not produce a readable record.");
    if (row.person_id !== person.id) {
      throw new DelegationConflictError("This signing key is already registered to another Person.");
    }
    return { key: toPersonKey(row), created: inserted.meta.changes === 1 };
  }

  async revokePersonKey(
    identity: PersonIdentity,
    input: { keyId: string; reason: string; emergency: boolean },
  ): Promise<{ revocation: PersonKeyRevocation; created: boolean }> {
    requireInputString(input.keyId, "personKeyId", 240);
    requireInputString(input.reason, "reason", 1_000);
    if (typeof input.emergency !== "boolean") {
      throw new Error("emergency must be a boolean.");
    }
    const person = await this.upsertPerson(identity);
    const key = await this.findPersonKey(input.keyId);
    if (!key || key.person_id !== person.id) {
      throw new DelegationNotFoundError("Person signing key not found.");
    }
    const existing = await this.findPersonKeyRevocation(key.id);
    if (existing) {
      if (existing.owner_person_id !== person.id || existing.reason !== input.reason.trim()) {
        throw new DelegationConflictError("This Person signing key already has a different revocation record.");
      }
      return { revocation: toPersonKeyRevocation(existing), created: false };
    }
    if (!input.emergency && !await this.hasAlternativeVerifiedPersonKey(person.id, key.id)) {
      throw new DelegationConflictError(
        "Verify another device signing key before revoking your last usable key, or make an emergency revocation.",
      );
    }

    const revokedAt = new Date().toISOString();
    const inserted = await getD1()
      .prepare(
        `INSERT OR IGNORE INTO person_key_revocations (
          id, person_key_id, owner_person_id, revoked_at, reason
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(newId("person-key-revocation"), key.id, person.id, revokedAt, input.reason.trim())
      .run();
    const revocation = await this.findPersonKeyRevocation(key.id);
    if (!revocation) throw new Error("Person key revocation did not produce a readable record.");
    if (revocation.owner_person_id !== person.id || revocation.reason !== input.reason.trim()) {
      throw new DelegationConflictError("This Person signing key was concurrently revoked with different evidence.");
    }
    return { revocation: toPersonKeyRevocation(revocation), created: inserted.meta.changes === 1 };
  }

  async issuePersonKeyProofChallenge(
    identity: PersonIdentity,
    keyId: string,
  ): Promise<PersonKeyProofChallenge> {
    requireInputString(keyId, "personKeyId", 240);
    const person = await this.upsertPerson(identity);
    const key = await this.findPersonKey(keyId);
    if (!key || key.person_id !== person.id || key.revoked_at) {
      throw new DelegationNotFoundError("Person signing key not found.");
    }

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1_000);
    const challenge = normalizePersonKeyProofChallenge({
      protocolVersion: personKeyProofChallengeProtocolVersion,
      id: newId("person-key-proof-challenge"),
      personId: person.id,
      personKeyId: key.id,
      personPublicKey: key.public_key,
      nonce: randomBase64Url(32),
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const canonicalPayload = canonicalJson(personKeyProofChallengeSigningPayload(challenge));
    const payloadHash = await personKeyProofChallengePayloadHash(challenge);
    await getD1()
      .prepare(
        `INSERT INTO person_key_proof_challenges (
          id, person_id, person_key_id, nonce, issued_at, expires_at, canonical_payload, payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        challenge.id,
        challenge.personId,
        challenge.personKeyId,
        challenge.nonce,
        challenge.issuedAt,
        challenge.expiresAt,
        canonicalPayload,
        payloadHash,
      )
      .run();
    return challenge;
  }

  async verifyPersonKeyProof(
    identity: PersonIdentity,
    input: { keyId: string; challengeId: string; personSignature: string },
  ): Promise<{ proof: PersonKeyProof; created: boolean }> {
    requireInputString(input.keyId, "personKeyId", 240);
    requireInputString(input.challengeId, "challengeId", 240);
    requireInputString(input.personSignature, "personSignature", 240);
    const person = await this.upsertPerson(identity);
    const challengeRow = await getD1()
      .prepare(
        `SELECT challenge.id, challenge.person_id, challenge.person_key_id, challenge.nonce,
                challenge.issued_at, challenge.expires_at, challenge.canonical_payload, challenge.payload_hash,
                key.public_key, COALESCE(key_revocation.revoked_at, key.revoked_at) AS revoked_at
         FROM person_key_proof_challenges AS challenge
         INNER JOIN person_keys AS key ON key.id = challenge.person_key_id
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = key.id
         WHERE challenge.id = ? AND challenge.person_id = ? AND challenge.person_key_id = ?`,
      )
      .bind(input.challengeId, person.id, input.keyId)
      .first<ChallengeRow>();
    if (!challengeRow) throw new DelegationNotFoundError("Person key proof challenge not found.");
    if (challengeRow.revoked_at) {
      throw new DelegationAuthorizationError("The Person signing key is unavailable.");
    }

    const challenge = await this.assertStoredProofChallengeIntegrity(challengeRow);
    const existing = await this.findProofByChallenge(challenge.id);
    if (existing) {
      await this.assertStoredProofIntegrity(existing, challenge, challengeRow.public_key);
      if (existing.person_signature !== input.personSignature) {
        throw new DelegationConflictError("Person key proof challenge was already consumed with a different signature.");
      }
      return { proof: toPersonKeyProof(existing), created: false };
    }
    if (Date.now() > Date.parse(challenge.expiresAt)) {
      throw new DelegationConflictError("Person key proof challenge has expired. Request a new one.");
    }

    if (!await verifyPersonKeyProofChallengeSignature({
      challenge,
      personPublicKey: challengeRow.public_key,
      personSignature: input.personSignature,
    })) {
      throw new DelegationAuthorizationError("The Person signature does not prove possession of this signing key.");
    }

    const verifiedAt = new Date().toISOString();
    if (Date.parse(verifiedAt) > Date.parse(challenge.expiresAt)) {
      throw new DelegationConflictError("Person key proof challenge expired before it could be verified. Request a new one.");
    }
    const inserted = await getD1()
      .prepare(
        `INSERT OR IGNORE INTO person_key_proof_events (
          id, challenge_id, person_id, person_key_id, protocol_version,
          canonical_payload, payload_hash, person_signature, verified_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        newId("person-key-proof"),
        challenge.id,
        person.id,
        challenge.personKeyId,
        personKeyProofChallengeProtocolVersion,
        canonicalJson(personKeyProofChallengeSigningPayload(challenge)),
        await personKeyProofChallengePayloadHash(challenge),
        input.personSignature,
        verifiedAt,
      )
      .run();
    const proof = await this.findProofByChallenge(challenge.id);
    if (!proof) throw new Error("Person key proof did not produce a readable event.");
    await this.assertStoredProofIntegrity(proof, challenge, challengeRow.public_key);
    if (proof.person_signature !== input.personSignature) {
      throw new DelegationConflictError("Person key proof challenge was concurrently consumed with a different signature.");
    }
    return { proof: toPersonKeyProof(proof), created: inserted.meta.changes === 1 };
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
          `SELECT key.id, key.person_id, key.algorithm, key.public_key, key.fingerprint,
                  COALESCE(key_revocation.revoked_at, key.revoked_at) AS revoked_at,
                  key_revocation.reason AS revocation_reason, key.created_at,
                  (SELECT MAX(proof.verified_at) FROM person_key_proof_events AS proof WHERE proof.person_key_id = key.id) AS possession_verified_at
           FROM person_keys AS key
           LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = key.id
           WHERE key.id = ?`,
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
    if (!personKey.possession_verified_at || !await this.hasValidPersonKeyProof(personKey, person.id)) {
      throw new DelegationAuthorizationError("Verify possession of this Person signing key before issuing a delegation.");
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

  async revokeAgentInstallation(
    identity: PersonIdentity,
    input: { installationId: string; reason: string; revokedAt: string },
  ): Promise<AgentInstallation> {
    requireInputString(input.installationId, "installationId", 240);
    requireInputString(input.reason, "reason", 1_000);
    if (!isUtcInstant(input.revokedAt)) throw new Error("revokedAt must be a UTC instant.");
    const person = await this.upsertPerson(identity);
    const installation = await this.findAgentInstallation(input.installationId);
    if (!installation || installation.person_id !== person.id) {
      throw new DelegationNotFoundError("Agent connection not found.");
    }
    if (installation.revoked_at) {
      const existing = await this.findAgentInstallationRevocation(installation.id);
      if (
        !existing ||
        existing.owner_person_id !== person.id ||
        existing.reason !== input.reason.trim() ||
        existing.revoked_at !== input.revokedAt
      ) {
        throw new DelegationConflictError("This Agent connection already has a different revocation record.");
      }
      return toAgentInstallation(await this.requireAgentInstallation(installation.id));
    }

    await getD1().batch([
      getD1()
        .prepare(
          `INSERT OR IGNORE INTO agent_installation_revocations (
            id, agent_installation_id, owner_person_id, revoked_at, reason
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(newId("agent-installation-revocation"), installation.id, person.id, input.revokedAt, input.reason.trim()),
      getD1()
        .prepare(
          `UPDATE agent_installations
           SET status = 'revoked', revoked_at = ?
           WHERE id = ? AND person_id = ? AND status = 'active' AND revoked_at IS NULL`,
        )
        .bind(input.revokedAt, installation.id, person.id),
    ]);
    const recorded = await this.findAgentInstallationRevocation(installation.id);
    if (
      !recorded ||
      recorded.owner_person_id !== person.id ||
      recorded.reason !== input.reason.trim() ||
      recorded.revoked_at !== input.revokedAt
    ) {
      throw new DelegationConflictError("This Agent connection already has a different revocation record.");
    }
    return toAgentInstallation(await this.requireAgentInstallation(installation.id));
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
    assertDelegationAllows(
      toCertificate(row),
      scope,
      eventTime,
      earliestRevocation(row.revoked_at, row.signer_key_revoked_at),
    );
    return toDelegation(row);
  }

  private async upsertPerson(identity: PersonIdentity): Promise<PersonRow> {
    requireInputString(identity.subject, "identity subject", 320);
    requireInputString(identity.displayName, "display name", 160);
    const account = await getAccountAuthRepository().resolveIdentity({
      ...identity,
      email: identity.email ?? (identity.provider === "chatgpt" ? identity.subject : null),
      emailVerified: identity.emailVerified ?? identity.provider === "chatgpt",
    });
    return { id: account.personId, display_name: account.displayName };
  }

  private async findDelegation(id: string): Promise<DelegationRow | null> {
    return getD1()
      .prepare(
        `SELECT certificate.id, certificate.owner_person_id, certificate.agent_id,
                certificate.person_key_id, certificate.agent_public_key,
                certificate.scopes_json, certificate.valid_from, certificate.valid_until,
                certificate.beneficiary_person_id, certificate.payload_hash,
                revocation.revoked_at, revocation.reason AS revocation_reason,
                COALESCE(key_revocation.revoked_at, signer.revoked_at) AS signer_key_revoked_at,
                key_revocation.reason AS signer_key_revocation_reason,
                certificate.created_at
         FROM delegation_certificates AS certificate
         INNER JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         LEFT JOIN person_key_revocations AS key_revocation
           ON key_revocation.person_key_id = certificate.person_key_id
         WHERE certificate.id = ?`,
      )
      .bind(id)
      .first<DelegationRow>();
  }

  private async findAgentInstallation(id: string): Promise<{ id: string; person_id: string; revoked_at: string | null } | null> {
    return getD1()
      .prepare("SELECT id, person_id, revoked_at FROM agent_installations WHERE id = ?")
      .bind(id)
      .first<{ id: string; person_id: string; revoked_at: string | null }>();
  }

  private async findAgentInstallationRevocation(installationId: string): Promise<{ owner_person_id: string; revoked_at: string; reason: string } | null> {
    return getD1()
      .prepare("SELECT owner_person_id, revoked_at, reason FROM agent_installation_revocations WHERE agent_installation_id = ?")
      .bind(installationId)
      .first<{ owner_person_id: string; revoked_at: string; reason: string }>();
  }

  private async requireAgentInstallation(id: string): Promise<AgentInstallationRow> {
    const row = await getD1()
      .prepare(
        `SELECT installation.id, installation.agent_id, agent.label AS agent_label,
                installation.delegation_certificate_id, certificate.scopes_json,
                installation.client_id, client.client_name, installation.label,
                installation.status, installation.revoked_at,
                revocation.reason AS revocation_reason, installation.created_at
         FROM agent_installations AS installation
         INNER JOIN agents AS agent ON agent.id = installation.agent_id
         INNER JOIN delegation_certificates AS certificate ON certificate.id = installation.delegation_certificate_id
         INNER JOIN oauth_clients AS client ON client.id = installation.client_id
         LEFT JOIN agent_installation_revocations AS revocation ON revocation.agent_installation_id = installation.id
         WHERE installation.id = ?`,
      )
      .bind(id)
      .first<AgentInstallationRow>();
    if (!row) throw new Error("Agent connection became unavailable.");
    return row;
  }

  private async findPersonKey(id: string): Promise<KeyRow | null> {
    return getD1()
      .prepare(
        `SELECT key.id, key.person_id, key.algorithm, key.public_key, key.fingerprint,
                COALESCE(key_revocation.revoked_at, key.revoked_at) AS revoked_at,
                key_revocation.reason AS revocation_reason, key.created_at,
                (SELECT MAX(proof.verified_at) FROM person_key_proof_events AS proof WHERE proof.person_key_id = key.id) AS possession_verified_at
         FROM person_keys AS key
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = key.id
         WHERE key.id = ?`,
      )
      .bind(id)
      .first<KeyRow>();
  }

  private async findPersonKeyRevocation(keyId: string): Promise<KeyRevocationRow | null> {
    return getD1()
      .prepare(
        `SELECT id, person_key_id, owner_person_id, revoked_at, reason
         FROM person_key_revocations WHERE person_key_id = ?`,
      )
      .bind(keyId)
      .first<KeyRevocationRow>();
  }

  private async hasAlternativeVerifiedPersonKey(personId: string, excludedKeyId: string): Promise<boolean> {
    const keys = await getD1()
      .prepare(
        `SELECT key.id, key.person_id, key.algorithm, key.public_key, key.fingerprint,
                COALESCE(key_revocation.revoked_at, key.revoked_at) AS revoked_at,
                key_revocation.reason AS revocation_reason, key.created_at,
                (SELECT MAX(proof.verified_at) FROM person_key_proof_events AS proof WHERE proof.person_key_id = key.id) AS possession_verified_at
         FROM person_keys AS key
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = key.id
         WHERE key.person_id = ? AND key.id <> ? AND COALESCE(key_revocation.revoked_at, key.revoked_at) IS NULL
         ORDER BY key.created_at DESC`,
      )
      .bind(personId, excludedKeyId)
      .all<KeyRow>();
    for (const key of keys.results ?? []) {
      if (key.possession_verified_at && await this.hasValidPersonKeyProof(key, personId)) return true;
    }
    return false;
  }

  private async findProofByChallenge(challengeId: string): Promise<ProofRow | null> {
    return getD1()
      .prepare(
        `SELECT id, challenge_id, person_id, person_key_id, protocol_version,
                canonical_payload, payload_hash, person_signature, verified_at
         FROM person_key_proof_events WHERE challenge_id = ?`,
      )
      .bind(challengeId)
      .first<ProofRow>();
  }

  private async hasValidPersonKeyProof(key: KeyRow, personId: string): Promise<boolean> {
    const row = await getD1()
      .prepare(
        `SELECT proof.id, proof.challenge_id, proof.person_id, proof.person_key_id, proof.protocol_version,
                proof.canonical_payload, proof.payload_hash, proof.person_signature, proof.verified_at,
                challenge.person_id AS challenge_person_id,
                challenge.person_key_id AS challenge_person_key_id, challenge.nonce,
                challenge.issued_at, challenge.expires_at, challenge.canonical_payload AS challenge_canonical_payload,
                challenge.payload_hash AS challenge_payload_hash
         FROM person_key_proof_events AS proof
         INNER JOIN person_key_proof_challenges AS challenge ON challenge.id = proof.challenge_id
         WHERE proof.person_id = ? AND proof.person_key_id = ?
         ORDER BY proof.verified_at DESC LIMIT 1`,
      )
      .bind(personId, key.id)
      .first<ProofRow & {
        challenge_person_id: string;
        challenge_person_key_id: string;
        nonce: string;
        issued_at: string;
        expires_at: string;
        challenge_canonical_payload: string;
        challenge_payload_hash: string;
      }>();
    if (!row) return false;
    const challengeRow: ChallengeRow = {
      id: row.challenge_id,
      person_id: row.challenge_person_id,
      person_key_id: row.challenge_person_key_id,
      nonce: row.nonce,
      issued_at: row.issued_at,
      expires_at: row.expires_at,
      canonical_payload: row.challenge_canonical_payload,
      payload_hash: row.challenge_payload_hash,
      public_key: key.public_key,
      revoked_at: key.revoked_at,
    };
    const challenge = await this.assertStoredProofChallengeIntegrity(challengeRow);
    await this.assertStoredProofIntegrity(row, challenge, key.public_key);
    return true;
  }

  private async assertStoredProofChallengeIntegrity(row: ChallengeRow): Promise<PersonKeyProofChallenge> {
    const challenge = normalizePersonKeyProofChallenge({
      protocolVersion: personKeyProofChallengeProtocolVersion,
      id: row.id,
      personId: row.person_id,
      personKeyId: row.person_key_id,
      personPublicKey: row.public_key,
      nonce: row.nonce,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at,
    });
    if (
      row.canonical_payload !== canonicalJson(personKeyProofChallengeSigningPayload(challenge)) ||
      row.payload_hash !== await personKeyProofChallengePayloadHash(challenge)
    ) {
      throw new Error("Stored Person key proof challenge did not pass its integrity check.");
    }
    return challenge;
  }

  private async assertStoredProofIntegrity(
    proof: ProofRow,
    challenge: PersonKeyProofChallenge,
    personPublicKey: string,
  ): Promise<void> {
    if (
      proof.protocol_version !== personKeyProofChallengeProtocolVersion ||
      proof.person_id !== challenge.personId ||
      proof.person_key_id !== challenge.personKeyId ||
      proof.canonical_payload !== canonicalJson(personKeyProofChallengeSigningPayload(challenge)) ||
      proof.payload_hash !== await personKeyProofChallengePayloadHash(challenge) ||
      !isUtcInstant(proof.verified_at) ||
      Date.parse(proof.verified_at) > Date.parse(challenge.expiresAt) ||
      !await verifyPersonKeyProofChallengeSignature({
        challenge,
        personPublicKey,
        personSignature: proof.person_signature,
      })
    ) {
      throw new Error("Stored Person key proof did not pass its integrity check.");
    }
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
    revocationReason: row.revocation_reason,
    possessionVerifiedAt: row.possession_verified_at,
    createdAt: row.created_at,
  };
}

function toPersonKeyProof(row: ProofRow): PersonKeyProof {
  return {
    id: row.id,
    challengeId: row.challenge_id,
    personKeyId: row.person_key_id,
    payloadHash: row.payload_hash,
    verifiedAt: row.verified_at,
  };
}

function toPersonKeyRevocation(row: KeyRevocationRow): PersonKeyRevocation {
  return {
    id: row.id,
    personKeyId: row.person_key_id,
    revokedAt: row.revoked_at,
    reason: row.reason,
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
    signerKeyRevokedAt: row.signer_key_revoked_at,
    signerKeyRevocationReason: row.signer_key_revocation_reason,
    createdAt: row.created_at,
  };
}

function toAgentInstallation(row: AgentInstallationRow): AgentInstallation {
  return {
    id: row.id,
    agentId: row.agent_id,
    agentLabel: row.agent_label,
    delegationCertificateId: row.delegation_certificate_id,
    delegationScopes: parseScopes(row.scopes_json),
    clientId: row.client_id,
    clientName: row.client_name,
    label: row.label,
    status: row.status,
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

function toPublicDelegation(
  row: PublicDelegationRow,
  canonicalPayload: string,
): PublicDelegationRecord {
  const revocation = row.revoked_at === null
    ? null
    : row.revocation_reason === null
      ? undefined
      : { revokedAt: row.revoked_at, reason: row.revocation_reason };
  if (revocation === undefined) {
    throw new Error("Stored delegation revocation evidence is malformed.");
  }
  const keyRevocation = row.signer_key_revoked_at === null
    ? null
    : { revokedAt: row.signer_key_revoked_at, reason: row.signer_key_revocation_reason };
  return {
    protocolVersion: row.protocol_version,
    certificate: {
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
    },
    signer: {
      keyId: row.person_key_id,
      algorithm: row.signer_algorithm,
      publicKey: row.signer_public_key,
      fingerprint: row.signer_fingerprint,
      keyRevocation,
    },
    evidence: {
      payloadHash: row.payload_hash,
      canonicalPayload,
      personSignature: row.person_signature,
    },
    revocation,
    recordedAt: row.created_at,
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

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function isUtcInstant(value: string): boolean {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

function earliestRevocation(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) <= Date.parse(right) ? left : right;
}
