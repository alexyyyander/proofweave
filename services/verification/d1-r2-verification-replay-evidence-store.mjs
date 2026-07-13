import { D1R2ArtifactStore } from "../artifacts/d1-r2-artifact-store.mjs";
import {
  canonicalVerificationReplayEvidence,
  normalizeVerificationReplayEvidence,
  verificationReplayEvidenceHash,
  verificationReplayEvidenceProtocolVersion,
} from "../../packages/protocol/verification-replay-evidence.mjs";
import { sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import { normalizeLeanRunnerResult } from "../../packages/protocol/lean-runner.mjs";

export const verificationReplayEvidenceContentType = "application/vnd.proofweave.verification-replay-evidence+json";

export class VerificationReplayEvidenceStoreConflictError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "VerificationReplayEvidenceStoreConflictError";
  }
}

export class VerificationReplayEvidenceStoreValidationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "VerificationReplayEvidenceStoreValidationError";
  }
}

/**
 * Trusted Runner-side materializer for a terminal fresh replay. The object is
 * written before D1 accepts the result so a Queue retry can safely reuse it;
 * VerificationStore later requires the matching terminal run_results row
 * before an attestation can cite the evidence hash.
 */
export class D1R2VerificationReplayEvidenceStore {
  constructor({ database, bucket }) {
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1R2VerificationReplayEvidenceStore requires a D1 database binding.");
    }
    if (!bucket || typeof bucket.head !== "function" || typeof bucket.put !== "function") {
      throw new TypeError("D1R2VerificationReplayEvidenceStore requires an R2 bucket binding.");
    }
    this.database = database;
    this.artifactStore = new D1R2ArtifactStore({ database, bucket });
  }

  async persist({ run, result, receivedAt }) {
    assertActiveRun(run);
    requireUtcInstant(receivedAt, "Verification replay evidence receivedAt");
    const replay = await this.findReplayForRun(run.id);
    if (!replay) return null;
    if (replay.artifactBundleHash !== run.artifactBundleHash) {
      throw new VerificationReplayEvidenceStoreConflictError("Verification replay Bundle does not match its active Run.");
    }
    if (replay.assignmentArtifactBundleHash !== run.artifactBundleHash || replay.assignmentStatus !== "accepted") {
      throw new VerificationReplayEvidenceStoreConflictError("Verification replay is no longer bound to an accepted matching assignment.");
    }

    let normalizedResult;
    try {
      normalizedResult = normalizeLeanRunnerResult(result);
    } catch (cause) {
      throw new VerificationReplayEvidenceStoreValidationError(
        cause instanceof Error ? `Signed Runner result is invalid: ${cause.message}` : "Signed Runner result is invalid.",
      );
    }
    if (
      normalizedResult.jobId !== run.id ||
      normalizedResult.attemptId !== run.attemptId ||
      normalizedResult.requestHash !== run.requestHash ||
      normalizedResult.artifacts.manifestHash !== run.artifactBundleHash
    ) {
      throw new VerificationReplayEvidenceStoreValidationError("Signed Runner result does not match the active verification replay Run.");
    }
    const runnerResultHash = await sha256Canonical(normalizedResult);
    const evidence = await normalizeVerificationReplayEvidence({
      protocolVersion: verificationReplayEvidenceProtocolVersion,
      id: `verification-replay-evidence:${replay.id}`,
      replayId: replay.id,
      assignmentId: replay.assignmentId,
      runId: run.id,
      artifactBundleHash: run.artifactBundleHash,
      runnerResultHash,
      runnerResult: normalizedResult,
      recordedAt: receivedAt,
    });
    const canonicalEvidence = await canonicalVerificationReplayEvidence(evidence);
    const expectedEvidenceHash = await verificationReplayEvidenceHash(evidence);
    const object = await this.artifactStore.putObject({
      bytes: canonicalEvidence,
      filename: "verification-replay-evidence.json",
      contentType: verificationReplayEvidenceContentType,
    });
    if (object.contentHash !== expectedEvidenceHash) {
      throw new VerificationReplayEvidenceStoreConflictError("Canonical verification replay evidence did not hash to its immutable artifact object.");
    }

    const existing = await this.findByReplayId(replay.id);
    if (existing) {
      assertSameEvidence(existing, { replay, run, runnerResultHash, evidenceHash: object.contentHash, canonicalEvidence, receivedAt });
      return Object.freeze({ ...existing, created: false });
    }
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO verification_replay_evidence (
          id, replay_id, assignment_id, run_id, artifact_bundle_manifest_hash,
          runner_result_hash, evidence_hash, canonical_evidence, recorded_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        evidence.id,
        replay.id,
        replay.assignmentId,
        run.id,
        run.artifactBundleHash,
        runnerResultHash,
        object.contentHash,
        canonicalEvidence,
        receivedAt,
      )
      .run();
    const stored = await this.findByReplayId(replay.id);
    if (!stored) throw new VerificationReplayEvidenceStoreConflictError("Verification replay evidence could not be recorded.");
    assertSameEvidence(stored, { replay, run, runnerResultHash, evidenceHash: object.contentHash, canonicalEvidence, receivedAt });
    return Object.freeze({ ...stored, created: true });
  }

  async findByReplayId(replayId) {
    requireIdentifier(replayId, "Verification replay id");
    const row = await this.database
      .prepare(
        `SELECT id, replay_id, assignment_id, run_id, artifact_bundle_manifest_hash,
                runner_result_hash, evidence_hash, canonical_evidence, recorded_at
         FROM verification_replay_evidence WHERE replay_id = ?`,
      )
      .bind(replayId)
      .first();
    return row ? toEvidence(row) : null;
  }

  async findReplayForRun(runId) {
    const row = await this.database
      .prepare(
        `SELECT replay.id, replay.assignment_id, replay.artifact_bundle_manifest_hash,
                assignment.artifact_bundle_manifest_hash AS assignment_artifact_bundle_manifest_hash,
                assignment.status AS assignment_status
         FROM verification_replays AS replay
         INNER JOIN verification_assignments AS assignment ON assignment.id = replay.assignment_id
         WHERE replay.run_id = ?`,
      )
      .bind(runId)
      .first();
    return row ? Object.freeze({
      id: row.id,
      assignmentId: row.assignment_id,
      artifactBundleHash: row.artifact_bundle_manifest_hash,
      assignmentArtifactBundleHash: row.assignment_artifact_bundle_manifest_hash,
      assignmentStatus: row.assignment_status,
    }) : null;
  }
}

function toEvidence(row) {
  return Object.freeze({
    id: row.id,
    replayId: row.replay_id,
    assignmentId: row.assignment_id,
    runId: row.run_id,
    artifactBundleHash: row.artifact_bundle_manifest_hash,
    runnerResultHash: row.runner_result_hash,
    evidenceHash: row.evidence_hash,
    canonicalEvidence: row.canonical_evidence,
    recordedAt: row.recorded_at,
  });
}

function assertSameEvidence(existing, { replay, run, runnerResultHash, evidenceHash, canonicalEvidence, receivedAt }) {
  if (
    existing.id !== `verification-replay-evidence:${replay.id}` ||
    existing.replayId !== replay.id ||
    existing.assignmentId !== replay.assignmentId ||
    existing.runId !== run.id ||
    existing.artifactBundleHash !== run.artifactBundleHash ||
    existing.runnerResultHash !== runnerResultHash ||
    existing.evidenceHash !== evidenceHash ||
    existing.canonicalEvidence !== canonicalEvidence ||
    existing.recordedAt !== receivedAt
  ) {
    throw new VerificationReplayEvidenceStoreConflictError("Verification replay evidence is already bound to different immutable Runner evidence.");
  }
}

function assertActiveRun(run) {
  if (!run || typeof run !== "object" || !["running", "cancel_requested"].includes(run.state)) {
    throw new VerificationReplayEvidenceStoreValidationError("Verification replay evidence can only be persisted for an active Run.");
  }
  requireIdentifier(run.id, "Run id");
  requireIdentifier(run.attemptId, "Run attempt id");
  requireSha256(run.requestHash, "Run request hash");
  requireSha256(run.artifactBundleHash, "Run Artifact Bundle hash");
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || !value.trim() || value.length > 240) {
    throw new VerificationReplayEvidenceStoreValidationError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new VerificationReplayEvidenceStoreValidationError(`${label} must be sha256:<hex>.`);
  }
}

function requireUtcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new VerificationReplayEvidenceStoreValidationError(`${label} must be an ISO-8601 UTC instant.`);
  }
}
