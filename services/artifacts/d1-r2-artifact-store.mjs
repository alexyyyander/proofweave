import {
  artifactBundleHash,
  canonicalArtifactBundle,
  artifactBundleObjectReferences,
  normalizeArtifactBundle,
  verifyArtifactBundleAgentSignature,
} from "../../packages/protocol/artifact-bundle.mjs";

export const maxArtifactObjectBytes = 32 * 1024 * 1024;

export class ArtifactStoreConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactStoreConflictError";
  }
}

export class ArtifactStoreValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArtifactStoreValidationError";
  }
}

/**
 * Internal control-plane adapter for R2 bytes and their immutable D1 index.
 * It stages evidence only; it never executes source or grants a verification
 * claim. Large or resumable uploads need a separate, authenticated ingress.
 */
export class D1R2ArtifactStore {
  constructor({ database, bucket }) {
    this.database = database;
    this.bucket = bucket;
  }

  async putObject({ bytes, filename, contentType }) {
    const content = toBytes(bytes);
    if (content.byteLength > maxArtifactObjectBytes) {
      throw new ArtifactStoreValidationError(`Artifact object exceeds the ${maxArtifactObjectBytes} byte control-plane limit.`);
    }
    requireFilename(filename);
    requireContentType(contentType);

    const contentHash = await sha256Bytes(content);
    const objectKey = keyFor(contentHash, filename);
    const indexed = await this.database
      .prepare("SELECT content_hash, object_key, byte_length, content_type FROM artifact_objects WHERE content_hash = ?")
      .bind(contentHash)
      .first();
    if (indexed) {
      assertIndexedObject(indexed, { contentHash, objectKey, byteLength: content.byteLength, contentType });
      await this.assertObjectPresent({ contentHash, objectKey });
      return { contentHash, objectKey, byteLength: content.byteLength, contentType, created: false };
    }

    const existing = await this.bucket.head(objectKey);
    if (existing) {
      assertR2Object(existing, { contentHash, byteLength: content.byteLength });
    } else {
      const written = await this.bucket.put(objectKey, content, {
        onlyIf: { etagDoesNotMatch: "*" },
        httpMetadata: { contentType },
        customMetadata: { sha256: contentHash },
      });
      if (written === null) {
        const concurrent = await this.bucket.head(objectKey);
        if (!concurrent) throw new ArtifactStoreConflictError("Artifact object was not written or found after a conditional write.");
        assertR2Object(concurrent, { contentHash, byteLength: content.byteLength });
      }
    }

    try {
      await this.database
        .prepare(
          "INSERT INTO artifact_objects (content_hash, object_key, byte_length, content_type) VALUES (?, ?, ?, ?)",
        )
        .bind(contentHash, objectKey, content.byteLength, contentType)
        .run();
    } catch (error) {
      const concurrent = await this.database
        .prepare("SELECT content_hash, object_key, byte_length, content_type FROM artifact_objects WHERE content_hash = ?")
        .bind(contentHash)
        .first();
      if (!concurrent) throw error;
      assertIndexedObject(concurrent, { contentHash, objectKey, byteLength: content.byteLength, contentType });
    }

    return { contentHash, objectKey, byteLength: content.byteLength, contentType, created: true };
  }

  async stageBundle(bundle) {
    const normalized = normalizeArtifactBundle(bundle);
    if (!await verifyArtifactBundleAgentSignature(normalized)) {
      throw new ArtifactStoreValidationError("Artifact Bundle Agent signature or payload hash is invalid.");
    }
    await this.assertAttemptAuthority(normalized);
    await Promise.all(artifactBundleObjectReferences(normalized).map((reference) =>
      this.assertObjectPresent({ contentHash: reference.contentHash, objectKey: reference.objectKey }),
    ));

    const canonicalManifest = canonicalArtifactBundle(normalized);
    const manifestHash = await artifactBundleHash(normalized);
    const manifestObject = await this.putObject({
      bytes: canonicalManifest,
      filename: "bundle.json",
      contentType: "application/json",
    });
    if (manifestObject.contentHash !== manifestHash) {
      throw new ArtifactStoreConflictError("Canonical artifact manifest did not hash to its content-addressed object key.");
    }

    const existing = await this.database
      .prepare("SELECT * FROM artifact_bundles WHERE manifest_hash = ?")
      .bind(manifestHash)
      .first();
    if (existing) {
      assertSameBundle(existing, { normalized, manifestHash, manifestKey: manifestObject.objectKey, canonicalManifest });
      await this.recordBundleStagedEvent(normalized, manifestHash);
      return { bundle: toStoredBundle(existing), created: false };
    }

    const eventCollision = await this.database
      .prepare("SELECT manifest_hash FROM artifact_bundles WHERE agent_event_id = ?")
      .bind(normalized.agentEvent.eventId)
      .first();
    if (eventCollision) {
      throw new ArtifactStoreConflictError("An Agent event id cannot be replayed for a different Artifact Bundle.");
    }

    await this.database
      .prepare(
        `INSERT INTO artifact_bundles (
          id, attempt_id, problem_revision_id, manifest_hash, manifest_key,
          canonical_manifest, agent_event_id, agent_event_payload_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        normalized.id,
        normalized.attemptId,
        normalized.problemRevisionId,
        manifestHash,
        manifestObject.objectKey,
        canonicalManifest,
        normalized.agentEvent.eventId,
        normalized.agentEvent.payloadHash,
      )
      .run();
    await this.recordBundleStagedEvent(normalized, manifestHash);
    return {
      bundle: {
        id: normalized.id,
        attemptId: normalized.attemptId,
        problemRevisionId: normalized.problemRevisionId,
        manifestHash,
        manifestKey: manifestObject.objectKey,
        agentEventId: normalized.agentEvent.eventId,
        createdAt: null,
      },
      created: true,
    };
  }

  async findBundle(manifestHash) {
    const row = await this.database
      .prepare("SELECT * FROM artifact_bundles WHERE manifest_hash = ?")
      .bind(manifestHash)
      .first();
    return row ? toStoredBundle(row) : null;
  }

  /**
   * Rebuild a staged Bundle from immutable D1/R2 evidence before trusted
   * runner dispatch. The canonical manifest is re-hashed and its Agent
   * signature is rechecked; a staged row is not trusted merely because it has
   * an index entry.
   */
  async loadBundleForDispatch(manifestHash) {
    const row = await this.database
      .prepare("SELECT * FROM artifact_bundles WHERE manifest_hash = ?")
      .bind(manifestHash)
      .first();
    if (!row) return null;
    await this.assertObjectPresent({ contentHash: row.manifest_hash, objectKey: row.manifest_key });

    let manifest;
    try {
      manifest = JSON.parse(row.canonical_manifest);
    } catch {
      throw new ArtifactStoreValidationError("Stored Artifact Bundle manifest is not valid JSON.");
    }
    let bundle;
    try {
      bundle = normalizeArtifactBundle(manifest);
    } catch (error) {
      throw new ArtifactStoreValidationError(
        error instanceof Error ? `Stored Artifact Bundle manifest is invalid: ${error.message}` : "Stored Artifact Bundle manifest is invalid.",
      );
    }
    await Promise.all(artifactBundleObjectReferences(bundle).map((reference) =>
      this.assertObjectPresent({ contentHash: reference.contentHash, objectKey: reference.objectKey }),
    ));
    await this.assertAttemptAuthority(bundle);
    const [computedHash, signatureValid] = await Promise.all([
      artifactBundleHash(bundle),
      verifyArtifactBundleAgentSignature(bundle),
    ]);
    if (computedHash !== row.manifest_hash || canonicalArtifactBundle(bundle) !== row.canonical_manifest) {
      throw new ArtifactStoreConflictError("Stored Artifact Bundle manifest does not match its immutable D1 hash evidence.");
    }
    if (!signatureValid) {
      throw new ArtifactStoreValidationError("Stored Artifact Bundle Agent signature is invalid.");
    }
    return Object.freeze({ bundle, stored: toStoredBundle(row) });
  }

  async assertObjectPresent({ contentHash, objectKey }) {
    const indexed = await this.database
      .prepare("SELECT content_hash, object_key, byte_length, content_type FROM artifact_objects WHERE content_hash = ?")
      .bind(contentHash)
      .first();
    if (!indexed || indexed.object_key !== objectKey) {
      throw new ArtifactStoreValidationError("Artifact Bundle references an object not registered in the immutable artifact index.");
    }
    const object = await this.bucket.head(objectKey);
    if (!object) throw new ArtifactStoreValidationError("Artifact Bundle references an R2 object that is missing.");
    assertR2Object(object, { contentHash, byteLength: Number(indexed.byte_length) });
  }

  async assertAttemptAuthority(bundle) {
    const row = await this.database
      .prepare(
        `SELECT
          attempt.problem_revision_id, attempt.person_id, attempt.agent_id,
          attempt.delegation_certificate_id, attempt.delegation_scope,
          agent.public_key AS agent_public_key,
          certificate.owner_person_id AS certificate_owner_person_id,
          certificate.agent_id AS certificate_agent_id,
          certificate.agent_public_key AS certificate_agent_public_key,
          certificate.scopes_json, certificate.valid_from, certificate.valid_until,
          revocation.revoked_at,
          COALESCE(key_revocation.revoked_at, signer.revoked_at) AS signer_key_revoked_at
         FROM agent_attempts AS attempt
         LEFT JOIN agents AS agent ON agent.id = attempt.agent_id
         LEFT JOIN delegation_certificates AS certificate
           ON certificate.id = attempt.delegation_certificate_id
         LEFT JOIN delegation_revocations AS revocation
           ON revocation.delegation_certificate_id = certificate.id
         LEFT JOIN person_keys AS signer ON signer.id = certificate.person_key_id
         LEFT JOIN person_key_revocations AS key_revocation ON key_revocation.person_key_id = signer.id
         WHERE attempt.id = ?`,
      )
      .bind(bundle.attemptId)
      .first();
    if (!row) throw new ArtifactStoreValidationError("Artifact Bundle references an unknown Attempt.");
    if (row.problem_revision_id !== bundle.problemRevisionId) {
      throw new ArtifactStoreValidationError("Artifact Bundle problem revision does not match its Attempt.");
    }
    if (
      !row.agent_id || !row.delegation_certificate_id || !row.delegation_scope ||
      row.certificate_owner_person_id !== row.person_id || row.certificate_agent_id !== row.agent_id ||
      row.agent_public_key !== bundle.agentEvent.agentPublicKey ||
      row.certificate_agent_public_key !== bundle.agentEvent.agentPublicKey
    ) {
      throw new ArtifactStoreValidationError("Artifact Bundle does not match the Attempt's delegated Agent authority.");
    }
    let scopes;
    try {
      scopes = JSON.parse(row.scopes_json);
    } catch {
      throw new ArtifactStoreValidationError("Stored delegation scopes are not valid JSON.");
    }
    if (!Array.isArray(scopes) || !scopes.includes(row.delegation_scope)) {
      throw new ArtifactStoreValidationError("Attempt delegation does not grant its stored scope.");
    }
    const eventTime = Date.parse(bundle.agentEvent.occurredAt);
    if (
      eventTime < Date.parse(row.valid_from) || eventTime >= Date.parse(row.valid_until) ||
      (row.revoked_at && eventTime >= Date.parse(row.revoked_at)) ||
      (row.signer_key_revoked_at && eventTime >= Date.parse(row.signer_key_revoked_at))
    ) {
      throw new ArtifactStoreValidationError("Artifact Bundle Agent event occurred outside its valid delegation period.");
    }
  }

  async recordBundleStagedEvent(bundle, manifestHash) {
    const now = new Date().toISOString();
    const idempotencyKey = `bundle-staged:${manifestHash}`;
    const inserted = await this.database
      .prepare(
        `INSERT OR IGNORE INTO agent_attempt_events (
          id, attempt_id, sequence, event_type, message, idempotency_key, occurred_at
        )
        SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, 'bundle_staged', ?, ?, ?
        FROM agent_attempt_events
        WHERE attempt_id = ?`,
      )
      .bind(
        idempotencyKey,
        bundle.attemptId,
        `Agent staged signed Artifact Bundle ${manifestHash}. It awaits a separate isolated runner and review.`,
        idempotencyKey,
        now,
        bundle.attemptId,
      )
      .run();
    if (inserted.meta.changes === 1) {
      await this.database
        .prepare("UPDATE agent_attempts SET updated_at = ? WHERE id = ?")
        .bind(now, bundle.attemptId)
        .run();
    }
  }
}

function assertSameBundle(row, { normalized, manifestHash, manifestKey, canonicalManifest }) {
  if (
    row.id !== normalized.id || row.attempt_id !== normalized.attemptId ||
    row.problem_revision_id !== normalized.problemRevisionId || row.manifest_hash !== manifestHash ||
    row.manifest_key !== manifestKey || row.canonical_manifest !== canonicalManifest ||
    row.agent_event_id !== normalized.agentEvent.eventId ||
    row.agent_event_payload_hash !== normalized.agentEvent.payloadHash
  ) {
    throw new ArtifactStoreConflictError("A manifest hash cannot be reused with different bundle metadata.");
  }
}

function assertIndexedObject(row, expected) {
  if (
    row.content_hash !== expected.contentHash || row.object_key !== expected.objectKey ||
    Number(row.byte_length) !== expected.byteLength || row.content_type !== expected.contentType
  ) {
    throw new ArtifactStoreConflictError("An artifact content hash is already indexed with different immutable metadata.");
  }
}

function assertR2Object(object, { contentHash, byteLength }) {
  if (
    object.customMetadata?.sha256 !== contentHash ||
    Number(object.size) !== byteLength
  ) {
    throw new ArtifactStoreConflictError("R2 object metadata does not match its immutable artifact index.");
  }
}

function toStoredBundle(row) {
  return Object.freeze({
    id: row.id,
    attemptId: row.attempt_id,
    problemRevisionId: row.problem_revision_id,
    manifestHash: row.manifest_hash,
    manifestKey: row.manifest_key,
    agentEventId: row.agent_event_id,
    createdAt: row.created_at,
  });
}

function toBytes(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new ArtifactStoreValidationError("Artifact object bytes must be a string, Uint8Array, or ArrayBuffer.");
}

function requireFilename(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new ArtifactStoreValidationError("Artifact filename must be a safe single path segment.");
  }
}

function requireContentType(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || /[\r\n]/.test(value)) {
    throw new ArtifactStoreValidationError("Artifact contentType must be a bounded media type.");
  }
}

function keyFor(contentHash, filename) {
  return `bundles/sha256/${contentHash.slice("sha256:".length)}/${filename}`;
}

async function sha256Bytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
