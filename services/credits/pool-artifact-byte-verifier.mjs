import { D1InlineArtifactBucket } from "../artifacts/d1-inline-artifact-store.mjs";
import { maxArtifactObjectBytes } from "../artifacts/d1-r2-artifact-store.mjs";
import { artifactBundleHash, artifactBundleObjectReferences, normalizeArtifactBundle } from "../../packages/protocol/artifact-bundle.mjs";

export const maxPoolEvidenceObjects = 512;
export const maxPoolEvidenceBytes = 64 * 1024 * 1024;

export class PoolArtifactByteError extends Error {
  constructor(message) { super(message); this.name = "PoolArtifactByteError"; }
}

/** Resolve the exact immutable object descriptors underlying the frozen
 * Receipt closure, finality reviews and counted market reviews. */
export async function collectPoolEvidenceObjects({ database, receipts, plan, finality }) {
  if (!database || !receipts || !plan || !finality) throw new PoolArtifactByteError("Evidence closure is unavailable.");
  const objects = [], reviewIds = new Set(plan.reviews.map((review) => review.attestationId));
  reviewIds.add(finality.payload.reviewAttestationId);
  reviewIds.add(finality.payload.noveltyAttestationId);
  const bundles = new Set();
  const receiptIds = [plan.finalReceipt, ...plan.dependencies].map((entry) => entry.receiptId);
  for (const receiptId of receiptIds) {
    const receipt = await receipts.loadVerifiedReceipt(receiptId);
    for (const claim of receipt.claims) reviewIds.add(claim.verificationAttestationId);
    await addRunnerOutputs(database, objects, receipt.run.id);
    if (bundles.has(receipt.artifactBundleHash)) continue;
    bundles.add(receipt.artifactBundleHash);
    const row = await database.prepare("SELECT canonical_manifest, manifest_key FROM artifact_bundles WHERE manifest_hash = ?").bind(receipt.artifactBundleHash).first();
    let bundle;
    try { bundle = normalizeArtifactBundle(JSON.parse(row?.canonical_manifest)); } catch { throw new PoolArtifactByteError("A Receipt Bundle manifest is missing or malformed."); }
    if (await artifactBundleHash(bundle) !== receipt.artifactBundleHash) throw new PoolArtifactByteError("A Receipt Bundle manifest hash is invalid.");
    await addIndexedObject(database, objects, receipt.artifactBundleHash, row.manifest_key);
    for (const reference of artifactBundleObjectReferences(bundle)) await addIndexedObject(database, objects, reference.contentHash, reference.objectKey);
  }
  for (const bundleHash of bundles) {
    const reviews = await receipts.loadReviewEvidence(bundleHash, { includeOptionalClaims: true });
    for (const review of reviews) {
      if (!reviewIds.has(review.id)) continue;
      reviewIds.delete(review.id);
      await addIndexedObject(database, objects, review.evidenceHash);
      if (["bundle_reproducible", "kernel_accepted"].includes(review.claimType) && review.decision === "attested") {
        const replay = await database.prepare("SELECT run_id FROM verification_replay_evidence WHERE assignment_id = ? AND evidence_hash = ?").bind(review.assignmentId, review.evidenceHash).first();
        if (!replay) throw new PoolArtifactByteError("A required independent replay is missing.");
        await addRunnerOutputs(database, objects, replay.run_id);
      }
    }
  }
  if (reviewIds.size !== 0) throw new PoolArtifactByteError("A required signed review is missing from the Receipt closure.");
  return Object.freeze(objects);
}

async function addIndexedObject(database, objects, hash, expectedKey = null) {
  const row = await database.prepare("SELECT content_hash, object_key, byte_length FROM artifact_objects WHERE content_hash = ?").bind(hash).first();
  if (!row || row.content_hash !== hash || (expectedKey !== null && row.object_key !== expectedKey)) throw new PoolArtifactByteError("A required evidence object is absent from its immutable index.");
  objects.push(Object.freeze({ objectKey: row.object_key, contentHash: hash, byteLength: Number(row.byte_length) }));
}

async function addRunnerOutputs(database, objects, runId) {
  const rows = await database.prepare("SELECT role, content_hash, object_key, byte_length FROM runner_output_artifacts WHERE run_id = ?").bind(runId).all();
  if ((rows.results ?? []).length !== 2 || new Set((rows.results ?? []).map((row) => row.role)).size !== 2
      || !(rows.results ?? []).every((row) => ["stdout", "stderr"].includes(row.role))) throw new PoolArtifactByteError("A required Runner output index is missing.");
  for (const row of rows.results) objects.push(Object.freeze({ objectKey: row.object_key, contentHash: row.content_hash, byteLength: Number(row.byte_length) }));
}

/** Read real bytes from D1 first and an optional trusted R2 binding second.
 * Remote objects are verified, but are not safe for a D1 atomic lock until a
 * separately reviewed immutable-version protocol is available. */
export async function verifyPoolArtifactBytes({ database, objects, remoteBucket = null }) {
  if (!database || typeof database.prepare !== "function" || !Array.isArray(objects) || objects.length === 0 || objects.length > maxPoolEvidenceObjects
      || (remoteBucket !== null && typeof remoteBucket.get !== "function")) throw new PoolArtifactByteError("Evidence object set or storage is invalid.");
  const inline = new D1InlineArtifactBucket(database), unique = new Map();
  for (const object of objects) {
    if (!object || typeof object.objectKey !== "string" || object.objectKey.length < 1 || object.objectKey.length > 1024
        || typeof object.contentHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(object.contentHash)
        || !Number.isSafeInteger(object.byteLength) || object.byteLength < 0 || object.byteLength > maxArtifactObjectBytes) throw new PoolArtifactByteError("Evidence object descriptor is invalid or exceeds the size limit.");
    if (!new RegExp(`^(?:bundles|runner-results)/sha256/${object.contentHash.slice(7)}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`).test(object.objectKey)) throw new PoolArtifactByteError("Evidence object key is not bound to its content hash.");
    const existing = unique.get(object.objectKey);
    if (existing && (existing.contentHash !== object.contentHash || existing.byteLength !== object.byteLength)) throw new PoolArtifactByteError("Evidence object has conflicting immutable descriptors.");
    unique.set(object.objectKey, object);
  }
  const verified = [];
  const total = [...unique.values()].reduce((sum, object) => sum + object.byteLength, 0);
  if (total > maxPoolEvidenceBytes) throw new PoolArtifactByteError("Evidence object set exceeds the total size limit.");
  for (const descriptor of unique.values()) {
    let object = await inline.get(descriptor.objectKey);
    const storage = object ? "inline" : "remote";
    if (!object && remoteBucket) object = await remoteBucket.get(descriptor.objectKey);
    if (!object) throw new PoolArtifactByteError("A required evidence object is missing from trusted storage.");
    if (object.size !== descriptor.byteLength || !object.body || typeof object.body.getReader !== "function") throw new PoolArtifactByteError("Evidence object size or readable body is invalid.");
    const reader = object.body.getReader(), chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new PoolArtifactByteError("Evidence object stream is invalid.");
        length += value.byteLength;
        if (length > descriptor.byteLength || length > maxArtifactObjectBytes) throw new PoolArtifactByteError("Evidence object stream exceeds its declared size.");
        chunks.push(value);
      }
    } catch (error) {
      try { await reader.cancel(); } catch { /* Preserve the validation error. */ }
      throw error;
    } finally { reader.releaseLock(); }
    if (length !== descriptor.byteLength) throw new PoolArtifactByteError("Evidence object stream is shorter than its declared size.");
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actual = `sha256:${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    if (actual !== descriptor.contentHash) throw new PoolArtifactByteError("Evidence object bytes do not match their expected SHA-256 hash.");
    verified.push(Object.freeze({ objectKey: descriptor.objectKey, contentHash: descriptor.contentHash, byteLength: descriptor.byteLength, storage }));
  }
  return Object.freeze({ objects: Object.freeze(verified), totalBytes: total, allInline: verified.every((object) => object.storage === "inline") });
}
