import {
  ArtifactStoreConflictError,
  ArtifactStoreValidationError,
  D1R2ArtifactStore,
} from "./d1-r2-artifact-store.mjs";

/**
 * Closed-alpha storage ceiling for a single D1 evidence row. It deliberately
 * leaves ample headroom below D1's per-row limit for SQLite bookkeeping and
 * prevents the control plane from pretending to be a large-file transport.
 */
export const maxInlineArtifactObjectBytes = 1_000_000;

/**
 * D1-only implementation of the narrow R2 object surface used by the
 * immutable artifact adapters. Keeping this surface R2-shaped means the
 * existing content-addressing, conditional-write, and provenance checks stay
 * identical while an alpha can run without an R2 subscription.
 */
export class D1InlineArtifactBucket {
  constructor(database) {
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1InlineArtifactBucket requires a D1 database binding.");
    }
    this.database = database;
  }

  async head(objectKey) {
    requireObjectKey(objectKey);
    const row = await this.database
      .prepare(
        "SELECT content_hash, byte_length, content_type FROM inline_artifact_bytes WHERE object_key = ?",
      )
      .bind(objectKey)
      .first();
    return row ? metadata(row) : null;
  }

  async get(objectKey) {
    requireObjectKey(objectKey);
    const row = await this.database
      .prepare(
        "SELECT content_hash, byte_length, content_type, bytes FROM inline_artifact_bytes WHERE object_key = ?",
      )
      .bind(objectKey)
      .first();
    if (!row) return null;
    const bytes = bytesFrom(row.bytes);
    const stored = metadata(row);
    if (bytes.byteLength !== stored.size) {
      throw new ArtifactStoreConflictError("Inline artifact bytes do not match their immutable D1 metadata.");
    }
    return Object.freeze({
      ...stored,
      body: oneChunkStream(bytes),
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    });
  }

  async put(objectKey, value, options = {}) {
    requireObjectKey(objectKey);
    const bytes = toBytes(value);
    if (bytes.byteLength > maxInlineArtifactObjectBytes) {
      throw new ArtifactStoreValidationError(
        `Inline Artifact object exceeds the ${maxInlineArtifactObjectBytes} byte closed-alpha limit. Use a signed Git commit reference and a smaller reproducible patch.`,
      );
    }
    const contentHash = options?.customMetadata?.sha256;
    const contentType = options?.httpMetadata?.contentType;
    requireSha256(contentHash, "Inline artifact content hash");
    requireContentType(contentType);

    const inserted = await this.database
      .prepare(
        `INSERT OR IGNORE INTO inline_artifact_bytes (
          object_key, content_hash, byte_length, content_type, bytes
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(objectKey, contentHash, bytes.byteLength, contentType, bytes)
      .run();
    const stored = await this.head(objectKey);
    if (!stored) {
      throw new ArtifactStoreConflictError("Inline artifact could not be read after its conditional D1 write.");
    }
    if (
      stored.customMetadata.sha256 !== contentHash ||
      stored.size !== bytes.byteLength ||
      stored.httpMetadata.contentType !== contentType
    ) {
      throw new ArtifactStoreConflictError("An inline artifact key is already bound to different immutable content.");
    }
    return inserted.meta?.changes === 1 ? stored : null;
  }
}

/**
 * Reuses the audited D1/R2 artifact semantics over D1-resident bytes. The
 * class name makes the alpha limit explicit at every deployment call site.
 */
export class D1InlineArtifactStore extends D1R2ArtifactStore {
  constructor({ database } = {}) {
    super({ database, bucket: new D1InlineArtifactBucket(database) });
  }

  async putObject(input) {
    const bytes = toBytes(input?.bytes);
    if (bytes.byteLength > maxInlineArtifactObjectBytes) {
      throw new ArtifactStoreValidationError(
        `Inline Artifact object exceeds the ${maxInlineArtifactObjectBytes} byte closed-alpha limit. Use a signed Git commit reference and a smaller reproducible patch.`,
      );
    }
    // Materialize the immutable bytes before the legacy index adapter checks
    // for a deduplicated `artifact_objects` row. This also permits a safe
    // one-way migration where D1 already contains an R2-era index row for the
    // same content hash but no longer has an R2 binding.
    const contentHash = await sha256(bytes);
    const objectKey = `bundles/sha256/${contentHash.slice("sha256:".length)}/${input?.filename ?? ""}`;
    await this.bucket.put(objectKey, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: input?.contentType },
      customMetadata: { sha256: contentHash },
    });
    return super.putObject(input);
  }
}

function metadata(row) {
  const size = Number(row.byte_length);
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new ArtifactStoreConflictError("Inline artifact has an invalid immutable byte length.");
  }
  requireSha256(row.content_hash, "Inline artifact stored hash");
  requireContentType(row.content_type);
  return Object.freeze({
    size,
    customMetadata: Object.freeze({ sha256: row.content_hash }),
    httpMetadata: Object.freeze({ contentType: row.content_type }),
  });
}

function oneChunkStream(bytes) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function bytesFrom(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return Uint8Array.from(value);
  }
  throw new ArtifactStoreConflictError("Inline artifact bytes are not a D1 BLOB.");
}

function toBytes(value) {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new ArtifactStoreValidationError("Artifact object bytes must be a string, Uint8Array, or ArrayBuffer.");
}

function requireObjectKey(value) {
  if (typeof value !== "string" || !/^(?:bundles|runner-results)\/sha256\/[a-f0-9]{64}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new ArtifactStoreValidationError("Inline artifact object key must be a safe content-addressed evidence key.");
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ArtifactStoreValidationError(`${label} must be sha256:<hex>.`);
  }
}

function requireContentType(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255 || /[\r\n]/.test(value)) {
    throw new ArtifactStoreValidationError("Inline artifact contentType must be a bounded media type.");
  }
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
