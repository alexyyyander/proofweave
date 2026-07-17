const issuerKeyStatuses = Object.freeze(["active", "retired", "revoked"]);

export class ContributionReceiptIssuerKeyStoreConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptIssuerKeyStoreConflictError";
  }
}

export class ContributionReceiptIssuerKeyStoreValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContributionReceiptIssuerKeyStoreValidationError";
  }
}

/**
 * Operator-only trust registry for Contribution Receipt signing keys.
 *
 * The receipt payload keeps the key that signed it. This registry controls
 * whether that key was authorized at the historical issuance time and which
 * single key may sign new evidence. No browser, participant, or receipt-read
 * route is allowed to mutate it.
 */
export class D1ContributionReceiptIssuerKeyStore {
  constructor(database) {
    if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
      throw new TypeError("Contribution Receipt issuer key store requires a D1 database.");
    }
    this.database = database;
  }

  async registerInitial({ id, publicKey, activatedAt }) {
    const draft = normalizeKeyDraft({ id, publicKey, activatedAt });
    const existing = await this.find(draft.id);
    if (existing) {
      if (
        existing.publicKey === draft.publicKey &&
        existing.status === "active" &&
        existing.validFrom === draft.activatedAt
      ) {
        return Object.freeze({ key: existing, created: false });
      }
      throw new ContributionReceiptIssuerKeyStoreConflictError("Contribution Receipt issuer key id already has different immutable registration evidence.");
    }
    const active = await this.findActive();
    if (active) {
      throw new ContributionReceiptIssuerKeyStoreConflictError("A Contribution Receipt issuer key is already active; register a successor through rotation.");
    }
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO contribution_receipt_issuer_keys (
            id, public_key, status, valid_from, retired_at, revoked_at
          ) VALUES (?, ?, 'active', ?, NULL, NULL)`,
        )
        .bind(draft.id, draft.publicKey, draft.activatedAt),
      this.database
        .prepare(
          `INSERT INTO contribution_receipt_issuer_key_events (
            id, key_id, event_type, related_key_id, occurred_at
          ) VALUES (?, ?, 'activated', NULL, ?)`,
        )
        .bind(eventId("activated", draft.id), draft.id, draft.activatedAt),
    ]);
    return Object.freeze({
      key: freezeKey({
        id: draft.id,
        publicKey: draft.publicKey,
        status: "active",
        validFrom: draft.activatedAt,
        retiredAt: null,
        revokedAt: null,
      }),
      created: true,
    });
  }

  /** Retire the sole active key and install its successor as one D1 batch. */
  async rotate({ previousKeyId, id, publicKey, rotatedAt }) {
    requireKeyId(previousKeyId, "previousKeyId");
    const successor = normalizeKeyDraft({ id, publicKey, activatedAt: rotatedAt });
    if (successor.id === previousKeyId) {
      throw new ContributionReceiptIssuerKeyStoreValidationError("A Contribution Receipt issuer key cannot rotate to itself.");
    }
    const existingSuccessor = await this.find(successor.id);
    const predecessor = await this.find(previousKeyId);
    if (!predecessor) {
      throw new ContributionReceiptIssuerKeyStoreValidationError("The predecessor Contribution Receipt issuer key was not found.");
    }
    if (existingSuccessor) {
      if (
        existingSuccessor.publicKey === successor.publicKey &&
        existingSuccessor.status === "active" &&
        existingSuccessor.validFrom === successor.activatedAt &&
        predecessor.status === "retired" &&
        predecessor.retiredAt === successor.activatedAt
      ) {
        return Object.freeze({ previousKey: predecessor, key: existingSuccessor, created: false });
      }
      throw new ContributionReceiptIssuerKeyStoreConflictError("A successor Contribution Receipt issuer key already has different rotation evidence.");
    }
    if (predecessor.status !== "active" || predecessor.publicKey === successor.publicKey) {
      throw new ContributionReceiptIssuerKeyStoreValidationError("Only the current active Contribution Receipt issuer key may be rotated to a distinct successor.");
    }
    if (Date.parse(successor.activatedAt) < Date.parse(predecessor.validFrom)) {
      throw new ContributionReceiptIssuerKeyStoreValidationError("A Contribution Receipt issuer key rotation cannot predate the active key.");
    }
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE contribution_receipt_issuer_keys
           SET status = 'retired', retired_at = ?
           WHERE id = ? AND status = 'active' AND retired_at IS NULL AND revoked_at IS NULL`,
        )
        .bind(successor.activatedAt, predecessor.id),
      this.database
        .prepare(
          `INSERT INTO contribution_receipt_issuer_keys (
            id, public_key, status, valid_from, retired_at, revoked_at
          ) VALUES (?, ?, 'active', ?, NULL, NULL)`,
        )
        .bind(successor.id, successor.publicKey, successor.activatedAt),
      this.database
        .prepare(
          `INSERT INTO contribution_receipt_issuer_key_events (
            id, key_id, event_type, related_key_id, occurred_at
          ) VALUES (?, ?, 'retired', ?, ?)`,
        )
        .bind(eventId("retired", predecessor.id), predecessor.id, successor.id, successor.activatedAt),
      this.database
        .prepare(
          `INSERT INTO contribution_receipt_issuer_key_events (
            id, key_id, event_type, related_key_id, occurred_at
          ) VALUES (?, ?, 'activated', ?, ?)`,
        )
        .bind(eventId("activated", successor.id), successor.id, predecessor.id, successor.activatedAt),
    ]);
    return Object.freeze({
      previousKey: freezeKey({ ...predecessor, status: "retired", retiredAt: successor.activatedAt }),
      key: freezeKey({
        id: successor.id,
        publicKey: successor.publicKey,
        status: "active",
        validFrom: successor.activatedAt,
        retiredAt: null,
        revokedAt: null,
      }),
      created: true,
    });
  }

  /** Emergency revocation stops new issuance and invalidates trust in the key. */
  async revoke({ id, revokedAt }) {
    requireKeyId(id, "id");
    requireUtcInstant(revokedAt, "revokedAt");
    const key = await this.find(id);
    if (!key) throw new ContributionReceiptIssuerKeyStoreValidationError("The Contribution Receipt issuer key was not found.");
    if (key.status === "revoked") {
      if (key.revokedAt === revokedAt) return Object.freeze({ key, created: false });
      throw new ContributionReceiptIssuerKeyStoreConflictError("A Contribution Receipt issuer key already has different revocation evidence.");
    }
    if (Date.parse(revokedAt) < Date.parse(key.validFrom)) {
      throw new ContributionReceiptIssuerKeyStoreValidationError("A Contribution Receipt issuer key cannot be revoked before activation.");
    }
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE contribution_receipt_issuer_keys
           SET status = 'revoked', revoked_at = ?
           WHERE id = ? AND status IN ('active', 'retired') AND revoked_at IS NULL`,
        )
        .bind(revokedAt, key.id),
      this.database
        .prepare(
          `INSERT INTO contribution_receipt_issuer_key_events (
            id, key_id, event_type, related_key_id, occurred_at
          ) VALUES (?, ?, 'revoked', NULL, ?)`,
        )
        .bind(eventId("revoked", key.id), key.id, revokedAt),
    ]);
    return Object.freeze({
      key: freezeKey({ ...key, status: "revoked", revokedAt }),
      created: true,
    });
  }

  async assertCanIssue({ issuerKeyId, issuerPublicKey, issuedAt }) {
    const key = await this.requireMatchingKey({ issuerKeyId, issuerPublicKey });
    if (key.status !== "active" || Date.parse(issuedAt) < Date.parse(key.validFrom)) {
      throw new ContributionReceiptIssuerKeyStoreValidationError("New Contribution Receipt evidence requires the current active issuer key.");
    }
    return key;
  }

  /** Verify historical evidence without allowing an archived key to issue new work. */
  async assertHistoricallyTrusted({ issuerKeyId, issuerPublicKey, occurredAt }) {
    const key = await this.requireMatchingKey({ issuerKeyId, issuerPublicKey });
    if (
      key.status === "revoked" ||
      Date.parse(occurredAt) < Date.parse(key.validFrom) ||
      (key.retiredAt && Date.parse(occurredAt) > Date.parse(key.retiredAt))
    ) {
      throw new ContributionReceiptIssuerKeyStoreValidationError("Contribution Receipt issuer key was not trusted at the evidence time.");
    }
    return key;
  }

  async find(id) {
    requireKeyId(id, "id");
    const row = await this.database
      .prepare(
        `SELECT id, public_key, status, valid_from, retired_at, revoked_at
         FROM contribution_receipt_issuer_keys WHERE id = ?`,
      )
      .bind(id)
      .first();
    return row ? toKey(row) : null;
  }

  async findActive() {
    const row = await this.database
      .prepare(
        `SELECT id, public_key, status, valid_from, retired_at, revoked_at
         FROM contribution_receipt_issuer_keys WHERE status = 'active'`,
      )
      .first();
    return row ? toKey(row) : null;
  }

  async list() {
    const rows = await this.database
      .prepare(
        `SELECT id, public_key, status, valid_from, retired_at, revoked_at
         FROM contribution_receipt_issuer_keys ORDER BY valid_from ASC, id ASC`,
      )
      .all();
    return Object.freeze((rows.results ?? []).map(toKey));
  }

  async requireMatchingKey({ issuerKeyId, issuerPublicKey }) {
    requireKeyId(issuerKeyId, "issuerKeyId");
    requirePublicKey(issuerPublicKey, "issuerPublicKey");
    const key = await this.find(issuerKeyId);
    if (!key || key.publicKey !== issuerPublicKey) {
      throw new ContributionReceiptIssuerKeyStoreValidationError("Contribution Receipt issuer key is not registered with its embedded public key.");
    }
    return key;
  }
}

function toKey(row) {
  return freezeKey({
    id: row.id,
    publicKey: row.public_key,
    status: row.status,
    validFrom: row.valid_from,
    retiredAt: row.retired_at,
    revokedAt: row.revoked_at,
  });
}

function freezeKey(value) {
  if (!issuerKeyStatuses.includes(value.status)) {
    throw new ContributionReceiptIssuerKeyStoreValidationError("Contribution Receipt issuer key status is invalid.");
  }
  requireKeyId(value.id, "issuer key id");
  requirePublicKey(value.publicKey, "issuer key publicKey");
  requireUtcInstant(value.validFrom, "issuer key validFrom");
  if (value.retiredAt !== null) requireUtcInstant(value.retiredAt, "issuer key retiredAt");
  if (value.revokedAt !== null) requireUtcInstant(value.revokedAt, "issuer key revokedAt");
  return Object.freeze({ ...value });
}

function normalizeKeyDraft({ id, publicKey, activatedAt }) {
  requireKeyId(id, "id");
  requirePublicKey(publicKey, "publicKey");
  requireUtcInstant(activatedAt, "activatedAt");
  return Object.freeze({ id, publicKey, activatedAt });
}

function eventId(eventType, keyId) {
  return `issuer-key-event:${eventType}:${keyId}`;
}

function requireKeyId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,180}$/.test(value)) {
    throw new ContributionReceiptIssuerKeyStoreValidationError(`${label} must be a bounded identifier.`);
  }
}

function requirePublicKey(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new ContributionReceiptIssuerKeyStoreValidationError(`${label} must be a raw Ed25519 base64url public key.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ContributionReceiptIssuerKeyStoreValidationError(`${label} must be a UTC ISO-8601 instant.`);
  }
}
