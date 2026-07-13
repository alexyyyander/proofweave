import {
  artifactBundleHash,
  canonicalArtifactBundle,
  artifactBundleObjectReferences,
  artifactBundleV2ProtocolVersion,
  normalizeArtifactBundle,
  verifyArtifactBundleAgentSignature,
} from "../../packages/protocol/artifact-bundle.mjs";
import { normalizeLeanRunnerRequest } from "../../packages/protocol/lean-runner.mjs";

// A canonical manifest is control-plane metadata, not an archive. Keep its
// in-Worker validation comfortably below the artifact-store object limit.
export const maxRunnerManifestBytes = 1024 * 1024;

export class RunnerBundleResolutionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RunnerBundleResolutionError";
  }
}

/**
 * Resolves the source-free Runner request back to the immutable artifact
 * evidence that the Container is permitted to receive. It intentionally does
 * not read source archives: a future transfer implementation must stream them
 * under its own archive, disk, and timeout limits.
 */
export class D1R2RunnerBundleResolver {
  constructor({ database, bucket }) {
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1R2RunnerBundleResolver requires a D1 database binding.");
    }
    if (!bucket || typeof bucket.get !== "function" || typeof bucket.head !== "function") {
      throw new TypeError("D1R2RunnerBundleResolver requires an R2 bucket binding.");
    }
    this.database = database;
    this.bucket = bucket;
  }

  /**
   * Re-derive the canonical bundle and reject any drift between a signed queue
   * request, immutable D1 provenance, and the content-addressed R2 manifest.
   */
  async resolve(request) {
    const normalizedRequest = normalizeLeanRunnerRequest(request);
    const row = await this.database
      .prepare(
        `SELECT
          bundle.id, bundle.attempt_id, bundle.problem_revision_id,
          bundle.manifest_hash, bundle.manifest_key, bundle.canonical_manifest,
          manifest.byte_length AS manifest_byte_length,
          manifest.content_type AS manifest_content_type
         FROM artifact_bundles AS bundle
         INNER JOIN artifact_objects AS manifest ON manifest.content_hash = bundle.manifest_hash
         WHERE bundle.manifest_hash = ?`,
      )
      .bind(normalizedRequest.bundle.manifestHash)
      .first();
    if (!row) {
      throw new RunnerBundleResolutionError("Runner request references no staged immutable Artifact Bundle.");
    }
    if (row.manifest_key !== normalizedRequest.bundle.objectKey) {
      throw new RunnerBundleResolutionError("Runner request bundle key does not match the immutable Artifact Bundle.");
    }
    if (row.attempt_id !== normalizedRequest.attemptId) {
      throw new RunnerBundleResolutionError("Runner request Attempt does not match the immutable Artifact Bundle.");
    }
    if (row.manifest_content_type !== "application/json") {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest has an unexpected immutable content type.");
    }
    const manifestByteLength = positiveSafeInteger(row.manifest_byte_length, "Artifact Bundle manifest byte length");
    if (manifestByteLength > maxRunnerManifestBytes) {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest exceeds the Runner validation limit.");
    }

    const manifestObject = await this.bucket.get(row.manifest_key);
    if (!manifestObject) {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest is missing from R2.");
    }
    assertR2Object(manifestObject, {
      contentHash: row.manifest_hash,
      byteLength: manifestByteLength,
      label: "Artifact Bundle manifest",
    });
    const manifestBytes = new Uint8Array(await manifestObject.arrayBuffer());
    if (manifestBytes.byteLength !== manifestByteLength) {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest bytes do not match the immutable R2 metadata.");
    }
    if (await sha256Bytes(manifestBytes) !== row.manifest_hash) {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest bytes do not match their content hash.");
    }
    const canonicalManifest = decodeUtf8(manifestBytes, "Artifact Bundle manifest");
    if (canonicalManifest !== row.canonical_manifest) {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest differs from its immutable D1 record.");
    }

    let bundle;
    try {
      bundle = normalizeArtifactBundle(JSON.parse(canonicalManifest));
    } catch (cause) {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest is not a valid canonical bundle.", { cause });
    }
    if (canonicalArtifactBundle(bundle) !== canonicalManifest || await artifactBundleHash(bundle) !== row.manifest_hash) {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest is not canonical for its content hash.");
    }
    if (
      bundle.id !== row.id || bundle.attemptId !== row.attempt_id ||
      bundle.problemRevisionId !== row.problem_revision_id
    ) {
      throw new RunnerBundleResolutionError("Artifact Bundle manifest does not match its immutable D1 provenance.");
    }
    if (!await verifyArtifactBundleAgentSignature(bundle)) {
      throw new RunnerBundleResolutionError("Artifact Bundle Agent signature is invalid at Runner resolution time.");
    }
    assertRequestMatchesBundle(normalizedRequest, bundle);

    const objectEntries = await Promise.all(artifactBundleObjectReferences(bundle).map(async (reference) => [
      reference.id,
      await this.resolveReferencedObject(reference),
    ]));
    const objects = Object.freeze(Object.fromEntries(objectEntries));

    return Object.freeze({
      request: normalizedRequest,
      bundle,
      manifest: Object.freeze({
        objectKey: row.manifest_key,
        contentHash: row.manifest_hash,
        byteLength: manifestByteLength,
      }),
      objects,
    });
  }

  async resolveReferencedObject({ label, objectKey, contentHash }) {
    const indexed = await this.database
      .prepare(
        "SELECT content_hash, object_key, byte_length, content_type FROM artifact_objects WHERE content_hash = ?",
      )
      .bind(contentHash)
      .first();
    if (!indexed || indexed.object_key !== objectKey) {
      throw new RunnerBundleResolutionError(`Artifact Bundle ${label} is absent from the immutable artifact index.`);
    }
    const byteLength = nonNegativeSafeInteger(indexed.byte_length, `Artifact Bundle ${label} byte length`);
    const object = await this.bucket.head(objectKey);
    if (!object) {
      throw new RunnerBundleResolutionError(`Artifact Bundle ${label} is missing from R2.`);
    }
    assertR2Object(object, { contentHash, byteLength, label: `Artifact Bundle ${label}` });
    return Object.freeze({
      objectKey,
      contentHash,
      byteLength,
      contentType: indexed.content_type,
    });
  }
}

function assertRequestMatchesBundle(request, bundle) {
  if (bundle.attemptId !== request.attemptId) {
    throw new RunnerBundleResolutionError("Runner request Attempt does not match its Artifact Bundle manifest.");
  }
  if (!sameArray(bundle.entryCommand, request.bundle.entryCommand)) {
    throw new RunnerBundleResolutionError("Runner request entry command does not match its Artifact Bundle manifest.");
  }
  if (
    bundle.environment.leanToolchain !== request.environment.leanToolchain ||
    bundle.environment.mathlibRevision !== request.environment.mathlibRevision
  ) {
    throw new RunnerBundleResolutionError("Runner request Lean environment does not match its Artifact Bundle manifest.");
  }
  if (
    bundle.policy.requireNoSorry !== request.policy.requireNoSorry ||
    !sameArray(bundle.policy.allowedAxioms, request.policy.allowedAxioms)
  ) {
    throw new RunnerBundleResolutionError("Runner request policy does not match its Artifact Bundle manifest.");
  }
  if (
    bundle.protocolVersion === artifactBundleV2ProtocolVersion &&
    bundle.workspace.archive.maxExpandedBytes > request.limits.diskMiB * 1024 * 1024
  ) {
    throw new RunnerBundleResolutionError("Runner request disk limit is lower than the Artifact Bundle v2 workspace expansion limit.");
  }
}

function assertR2Object(object, { contentHash, byteLength, label }) {
  if (
    object.customMetadata?.sha256 !== contentHash ||
    Number(object.size) !== byteLength
  ) {
    throw new RunnerBundleResolutionError(`${label} R2 metadata does not match its immutable artifact index.`);
  }
}

function positiveSafeInteger(value, label) {
  const normalized = nonNegativeSafeInteger(value, label);
  if (normalized < 1) {
    throw new RunnerBundleResolutionError(`${label} must be greater than zero.`);
  }
  return normalized;
}

function nonNegativeSafeInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new RunnerBundleResolutionError(`${label} is not a non-negative safe integer.`);
  }
  return normalized;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function decodeUtf8(bytes, label) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RunnerBundleResolutionError(`${label} is not valid UTF-8.`);
  }
}

async function sha256Bytes(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
