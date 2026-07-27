import { getD1 } from "@/db";
import {
  artifactBundleHash,
  artifactBundleObjectReferences,
  canonicalArtifactBundle,
  normalizeArtifactBundle,
} from "@/packages/protocol/artifact-bundle.mjs";
import {
  normalizeVerificationReplayEvidence,
  verificationReplayEvidenceHash,
} from "@/packages/protocol/verification-replay-evidence.mjs";
import { canonicalJson } from "@/packages/protocol/canonical-json.mjs";
import { normalizeLeanRunnerResult } from "@/packages/protocol/lean-runner.mjs";
import type { ReviewAttestationDecision } from "@/db/repositories/reviews";

export type EvidenceAccessRole = "attempt_owner" | "assigned_reviewer";
export type EvidenceArtifactId =
  | "bundle-manifest"
  | "sourceArchive"
  | "sourcePatch"
  | "lakeManifest"
  | `run:${string}:stdout`
  | `run:${string}:stderr`
  | `replay:${string}:evidence`;

export type EvidenceArtifact = Readonly<{
  id: EvidenceArtifactId;
  label: string;
  contentHash: string;
  byteLength: number;
  contentType: string;
}>;

export type EvidenceRun = Readonly<{
  id: string;
  state: string;
  requestHash: string;
  runnerResultHash: string | null;
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  result: Readonly<{
    resultHash: string;
    canonicalResult: string;
    receivedAt: string;
    summary: EvidenceRunnerResultSummary | null;
  }> | null;
  outputs: readonly EvidenceArtifact[];
}>;

export type EvidenceRunnerResultSummary = Readonly<{
  status: string;
  exitCode: number;
  kernelStatus: string;
  checks: Readonly<{
    network: string;
    noSorry: string;
    allowedAxioms: string;
    leanBuild: string;
  }>;
}>;

export type EvidenceBundleReview = Readonly<{
  target: Readonly<{
    declaration: string;
    statementHash: string;
  }>;
  environment: Readonly<{
    leanToolchain: string;
    mathlibRevision: string;
  }>;
  entryCommand: readonly string[];
  policy: Readonly<{
    requireNoSorry: boolean;
    allowedAxioms: readonly string[];
  }>;
}>;

export type EvidenceReplay = Readonly<{
  id: string;
  assignmentId: string;
  runId: string;
  runnerResultHash: string;
  evidenceHash: string;
  recordedAt: string;
  canonicalEvidence: string;
  artifact: EvidenceArtifact;
}>;

/**
 * Terminal review metadata that the Attempt owner can inspect. It deliberately
 * omits the reviewer identity and any private fresh-replay object.
 */
export type EvidenceReviewOutcome = Readonly<{
  assignmentId: string;
  claimType: string;
  decision: ReviewAttestationDecision;
  evidenceHash: string;
  attestedAt: string;
}>;

export type AttemptEvidenceSummary = Readonly<{
  attemptId: string;
  accessRole: EvidenceAccessRole;
  agentLabel: string;
  artifactBundleManifestHash: string;
  target: Readonly<{
    projectSlug: string;
    problemSlug: string;
    title: string;
    declaration: string;
  }>;
  latestRunState: string | null;
  updatedAt: string;
}>;

export type AttemptEvidence = Readonly<{
  summary: AttemptEvidenceSummary;
  bundle: Readonly<{
    id: string;
    protocolVersion: "pw-artifact-bundle-v1" | "pw-artifact-bundle-v2";
    manifestHash: string;
    agentEventId: string;
    agentEventPayloadHash: string;
    canonicalManifest: string;
    review: EvidenceBundleReview;
    artifacts: readonly EvidenceArtifact[];
  }>;
  runs: readonly EvidenceRun[];
  replays: readonly EvidenceReplay[];
  reviewOutcomes: readonly EvidenceReviewOutcome[];
  receipt: Readonly<{ id: string; receiptHash: string; issuedAt: string }> | null;
}>;

type BaseRow = {
  attempt_id: string;
  agent_label: string;
  updated_at: string;
  bundle_id: string;
  manifest_hash: string;
  manifest_key: string;
  canonical_manifest: string;
  agent_event_id: string;
  agent_event_payload_hash: string;
  project_slug: string;
  problem_slug: string;
  problem_title: string;
  declaration: string;
  access_role: EvidenceAccessRole;
  receipt_id: string | null;
  receipt_hash: string | null;
  receipt_issued_at: string | null;
};

type ArtifactObjectRow = {
  content_hash: string;
  object_key: string;
  byte_length: number;
  content_type: string;
};

type RunRow = {
  id: string;
  state: string;
  request_hash: string;
  runner_result_hash: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  result_hash: string | null;
  canonical_result: string | null;
  received_at: string | null;
};

type OutputRow = {
  run_id: string;
  role: "stdout" | "stderr";
  content_hash: string;
  object_key: string;
  byte_length: number;
  content_type: string;
};

type ReplayRow = {
  id: string;
  replay_id: string;
  assignment_id: string;
  run_id: string;
  artifact_bundle_manifest_hash: string;
  runner_result_hash: string;
  evidence_hash: string;
  canonical_evidence: string;
  recorded_at: string;
  replay_artifact_bundle_manifest_hash: string;
  requester_person_id: string;
  requester_agent_id: string;
  delegation_certificate_id: string;
  verifier_person_id: string;
  run_runner_result_hash: string;
  result_hash: string;
  canonical_result: string;
  content_hash: string;
  object_key: string;
  byte_length: number;
  content_type: string;
};

type ReviewOutcomeRow = {
  assignment_id: string;
  claim_type: string;
  decision: ReviewAttestationDecision;
  evidence_hash: string;
  attested_at: string;
};

type PrivateEvidenceArtifact = EvidenceArtifact & Readonly<{
  objectKey: string;
  filename: string;
}>;

export class EvidenceIntegrityError extends Error {
  constructor() {
    super("Stored evidence did not match its immutable Bundle or object index.");
    this.name = "EvidenceIntegrityError";
  }
}

export interface EvidenceRepository {
  listForPerson(personId: string): Promise<readonly AttemptEvidenceSummary[]>;
  getForPerson(personId: string, bundleManifestHash: string): Promise<AttemptEvidence | null>;
  getArtifactForPerson(personId: string, bundleManifestHash: string, artifactId: string): Promise<PrivateEvidenceArtifact | null>;
}

class D1EvidenceRepository implements EvidenceRepository {
  async listForPerson(personId: string): Promise<readonly AttemptEvidenceSummary[]> {
    requireIdentifier(personId, "evidence Person id");
    const rows = await getD1()
      .prepare(`${baseSelect}\n        WHERE ${personEvidenceAccess}\n        ORDER BY attempt.updated_at DESC, attempt.id ASC`)
      .bind(personId, personId, personId)
      .all<BaseRow>();
    const summaries = await Promise.all((rows.results ?? []).map(async (row: BaseRow) => {
      const latest = await getD1()
        .prepare("SELECT state FROM runs WHERE artifact_bundle_hash = ? ORDER BY updated_at DESC, id ASC LIMIT 1")
        .bind(row.manifest_hash)
        .first<{ state: string }>();
      return summaryFrom(row, latest?.state ?? null);
    }));
    return Object.freeze(summaries);
  }

  async getForPerson(personId: string, bundleManifestHash: string): Promise<AttemptEvidence | null> {
    const base = await this.findBase(personId, bundleManifestHash);
    if (!base) return null;
    const privateArtifacts = await this.artifactsFor(base);
    const review = await this.reviewFactsFor(base);
    const runs = await this.runsFor(base.manifest_hash);
    const replays = await this.replaysFor(personId, base);
    const reviewOutcomes = await this.reviewOutcomesFor(base);
    return Object.freeze({
      summary: summaryFrom(base, runs[0]?.state ?? null),
      bundle: Object.freeze({
        id: base.bundle_id,
        protocolVersion: protocolVersion(base),
        manifestHash: base.manifest_hash,
        agentEventId: base.agent_event_id,
        agentEventPayloadHash: base.agent_event_payload_hash,
        canonicalManifest: base.canonical_manifest,
        review,
        artifacts: Object.freeze(privateArtifacts.map(publicArtifact)),
      }),
      runs: Object.freeze(runs.map((run) => Object.freeze({
        ...run,
        outputs: Object.freeze(run.outputs.map(publicArtifact)),
      }))),
      replays: Object.freeze(replays.map((replay) => Object.freeze({
        ...replay,
        artifact: publicArtifact(replay.artifact),
      }))),
      reviewOutcomes,
      receipt: base.receipt_id && base.receipt_hash && base.receipt_issued_at
        ? Object.freeze({ id: base.receipt_id, receiptHash: base.receipt_hash, issuedAt: base.receipt_issued_at })
        : null,
    });
  }

  async getArtifactForPerson(personId: string, bundleManifestHash: string, artifactId: string): Promise<PrivateEvidenceArtifact | null> {
    const base = await this.findBase(personId, bundleManifestHash);
    if (!base) return null;
    const artifacts = await this.artifactsFor(base);
    const runs = await this.runsFor(base.manifest_hash);
    const replays = await this.replaysFor(personId, base);
    return artifacts
      .concat(runs.flatMap((run) => run.outputs), replays.map((replay) => replay.artifact))
      .find((artifact) => artifact.id === artifactId) ?? null;
  }

  private async findBase(personId: string, bundleManifestHash: string): Promise<BaseRow | null> {
    requireIdentifier(personId, "evidence Person id");
    requireSha256(bundleManifestHash, "Artifact Bundle manifest hash");
    return getD1()
      .prepare(`${baseSelect}\n        WHERE bundle.manifest_hash = ? AND ${personEvidenceAccess}`)
      .bind(personId, bundleManifestHash, personId, personId)
      .first<BaseRow>();
  }

  private async artifactsFor(base: BaseRow): Promise<readonly PrivateEvidenceArtifact[]> {
    let manifest: unknown;
    try {
      manifest = JSON.parse(base.canonical_manifest);
    } catch {
      throw new EvidenceIntegrityError();
    }
    try {
      const normalized = normalizeArtifactBundle(manifest);
      if (
        normalized.id !== base.bundle_id ||
        normalized.attemptId !== base.attempt_id ||
        canonicalArtifactBundle(normalized) !== base.canonical_manifest ||
        await artifactBundleHash(normalized) !== base.manifest_hash
      ) {
        throw new Error("Bundle projection mismatch");
      }
      const manifestObject = await this.objectFor(base.manifest_hash, base.manifest_key);
      const referenced = await Promise.all(artifactBundleObjectReferences(normalized).map(async (reference) => {
        const object = await this.objectFor(reference.contentHash, reference.objectKey);
        return privateArtifact({ id: reference.id as EvidenceArtifactId, label: reference.label, filename: filenameFor(reference.id), object });
      }));
      return Object.freeze([
        privateArtifact({ id: "bundle-manifest", label: "Signed Bundle manifest", filename: "bundle.json", object: manifestObject }),
        ...referenced,
      ]);
    } catch (error) {
      if (error instanceof EvidenceIntegrityError) throw error;
      throw new EvidenceIntegrityError();
    }
  }

  /** Stable Bundle facts that a reviewer needs before reading raw manifests. */
  private async reviewFactsFor(base: BaseRow): Promise<EvidenceBundleReview> {
    try {
      const normalized = normalizeArtifactBundle(JSON.parse(base.canonical_manifest));
      if (
        normalized.id !== base.bundle_id ||
        normalized.attemptId !== base.attempt_id ||
        canonicalArtifactBundle(normalized) !== base.canonical_manifest ||
        await artifactBundleHash(normalized) !== base.manifest_hash
      ) {
        throw new Error("Bundle review projection mismatch");
      }
      return Object.freeze({
        target: Object.freeze({
          declaration: normalized.target.declaration,
          statementHash: normalized.target.statementHash,
        }),
        environment: Object.freeze({
          leanToolchain: normalized.environment.leanToolchain,
          mathlibRevision: normalized.environment.mathlibRevision,
        }),
        entryCommand: Object.freeze([...normalized.entryCommand]),
        policy: Object.freeze({
          requireNoSorry: normalized.policy.requireNoSorry,
          allowedAxioms: Object.freeze([...normalized.policy.allowedAxioms]),
        }),
      });
    } catch (error) {
      if (error instanceof EvidenceIntegrityError) throw error;
      throw new EvidenceIntegrityError();
    }
  }

  private async runsFor(bundleManifestHash: string): Promise<readonly (EvidenceRun & { outputs: readonly PrivateEvidenceArtifact[] })[]> {
    const rows = await getD1()
      .prepare(
        `SELECT run.id, run.state, run.request_hash, run.runner_result_hash,
                run.queued_at, run.started_at, run.finished_at,
                result.result_hash, result.canonical_result, result.received_at
         FROM runs AS run
         LEFT JOIN run_results AS result ON result.run_id = run.id
         WHERE run.artifact_bundle_hash = ?
         ORDER BY run.updated_at DESC, run.id ASC`,
      )
      .bind(bundleManifestHash)
      .all<RunRow>();
    const outputRows = await getD1()
      .prepare(
        `SELECT output.run_id, output.role, output.content_hash, output.object_key,
                output.byte_length, output.content_type
         FROM runner_output_artifacts AS output
         INNER JOIN runs AS run ON run.id = output.run_id
         WHERE run.artifact_bundle_hash = ?
         ORDER BY output.run_id ASC, output.role ASC`,
      )
      .bind(bundleManifestHash)
      .all<OutputRow>();
    const outputsByRun = new Map<string, PrivateEvidenceArtifact[]>();
    for (const output of outputRows.results ?? []) {
      const artifact = privateArtifact({
        id: `run:${output.run_id}:${output.role}` as EvidenceArtifactId,
        label: `Runner ${output.role}`,
        filename: output.role === "stdout" ? "runner-stdout.log" : "runner-stderr.log",
        object: output,
      });
      const current = outputsByRun.get(output.run_id) ?? [];
      current.push(artifact);
      outputsByRun.set(output.run_id, current);
    }
    return Object.freeze((rows.results ?? []).map((run: RunRow) => Object.freeze({
      id: run.id,
      state: run.state,
      requestHash: run.request_hash,
      runnerResultHash: run.runner_result_hash,
      queuedAt: run.queued_at,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      result: run.result_hash && run.canonical_result && run.received_at
        ? Object.freeze({
          resultHash: run.result_hash,
          canonicalResult: run.canonical_result,
          receivedAt: run.received_at,
          summary: runnerResultSummary(run.canonical_result),
        })
        : null,
      outputs: Object.freeze(outputsByRun.get(run.id) ?? []),
    })));
  }

  /**
   * A replay artifact remains visible only to the Person whose review Agent
   * created it. Attempt owners and other assignees can inspect the shared
   * Bundle/Run record but cannot browse a reviewer Agent's reproducibility
   * evidence before that reviewer makes its separately signed claim.
   */
  private async replaysFor(personId: string, base: BaseRow): Promise<readonly (EvidenceReplay & { artifact: PrivateEvidenceArtifact })[]> {
    const rows = await getD1()
      .prepare(
        `SELECT
          evidence.id, evidence.replay_id, evidence.assignment_id, evidence.run_id,
          evidence.artifact_bundle_manifest_hash, evidence.runner_result_hash,
          evidence.evidence_hash, evidence.canonical_evidence, evidence.recorded_at,
          replay.artifact_bundle_manifest_hash AS replay_artifact_bundle_manifest_hash,
          replay.requester_person_id, replay.requester_agent_id, replay.delegation_certificate_id,
          assignment.verifier_person_id,
          run.runner_result_hash AS run_runner_result_hash,
          result.result_hash, result.canonical_result,
          object.content_hash, object.object_key, object.byte_length, object.content_type
         FROM verification_replay_evidence AS evidence
         INNER JOIN verification_replays AS replay ON replay.id = evidence.replay_id
         INNER JOIN verification_assignments AS assignment ON assignment.id = evidence.assignment_id
         INNER JOIN runs AS run ON run.id = evidence.run_id
         INNER JOIN run_results AS result ON result.run_id = evidence.run_id
         INNER JOIN artifact_objects AS object ON object.content_hash = evidence.evidence_hash
         WHERE evidence.artifact_bundle_manifest_hash = ?
           AND replay.requester_person_id = ?
           AND assignment.verifier_person_id = ?
           AND replay.artifact_bundle_manifest_hash = evidence.artifact_bundle_manifest_hash
           AND assignment.artifact_bundle_manifest_hash = evidence.artifact_bundle_manifest_hash
           AND run.artifact_bundle_hash = evidence.artifact_bundle_manifest_hash
         ORDER BY evidence.recorded_at DESC, evidence.id ASC`,
      )
      .bind(base.manifest_hash, personId, personId)
      .all<ReplayRow>();
    return Object.freeze(await Promise.all((rows.results ?? []).map(async (row: ReplayRow) => {
      try {
        const evidence = await normalizeVerificationReplayEvidence(JSON.parse(row.canonical_evidence));
        const result = normalizeLeanRunnerResult(JSON.parse(row.canonical_result));
        if (
          canonicalJson(evidence) !== row.canonical_evidence ||
          await verificationReplayEvidenceHash(evidence) !== row.evidence_hash ||
          canonicalJson(evidence.runnerResult) !== row.canonical_result ||
          row.id !== `verification-replay-evidence:${row.replay_id}` ||
          evidence.id !== row.id ||
          evidence.replayId !== row.replay_id ||
          evidence.assignmentId !== row.assignment_id ||
          evidence.runId !== row.run_id ||
          evidence.artifactBundleHash !== base.manifest_hash ||
          evidence.runnerResultHash !== row.runner_result_hash ||
          evidence.recordedAt !== row.recorded_at ||
          row.replay_artifact_bundle_manifest_hash !== base.manifest_hash ||
          row.artifact_bundle_manifest_hash !== base.manifest_hash ||
          row.run_runner_result_hash !== row.runner_result_hash ||
          row.result_hash !== row.runner_result_hash ||
          canonicalJson(result) !== row.canonical_result
        ) {
          throw new Error("Replay projection mismatch");
        }
        const object = await this.objectFor(row.evidence_hash, row.object_key);
        const artifact = privateArtifact({
          id: `replay:${row.replay_id}:evidence` as EvidenceArtifactId,
          label: "Fresh replay evidence",
          filename: "verification-replay-evidence.json",
          object,
        });
        return Object.freeze({
          id: row.replay_id,
          assignmentId: row.assignment_id,
          runId: row.run_id,
          runnerResultHash: row.runner_result_hash,
          evidenceHash: row.evidence_hash,
          recordedAt: row.recorded_at,
          canonicalEvidence: row.canonical_evidence,
          artifact,
        });
      } catch (error) {
        if (error instanceof EvidenceIntegrityError) throw error;
        throw new EvidenceIntegrityError();
      }
    })));
  }

  /**
   * The submitter may learn a completed signed decision, including a conflict
   * or integrity flag, so they are not left unaware of a blocked receipt path.
   * Other reviewers do not receive this cross-review metadata; replay bytes
   * remain private even for the Attempt owner.
   */
  private async reviewOutcomesFor(base: BaseRow): Promise<readonly EvidenceReviewOutcome[]> {
    if (base.access_role !== "attempt_owner") return Object.freeze([]);
    const rows = await getD1()
      .prepare(
        `SELECT assignment.id AS assignment_id, assignment.claim_type,
                attestation.decision, attestation.evidence_hash, attestation.attested_at
         FROM verification_assignments AS assignment
         INNER JOIN verification_attestations AS attestation
           ON attestation.assignment_id = assignment.id
         INNER JOIN artifact_bundles AS bundle
           ON bundle.manifest_hash = assignment.artifact_bundle_manifest_hash
         INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
         WHERE assignment.artifact_bundle_manifest_hash = ?
           AND assignment.status = 'completed'
           AND assignment.attempt_owner_person_id = attempt.person_id
           AND attestation.artifact_bundle_manifest_hash = assignment.artifact_bundle_manifest_hash
         ORDER BY attestation.attested_at DESC, attestation.id ASC`,
      )
      .bind(base.manifest_hash)
      .all<ReviewOutcomeRow>();
    return Object.freeze((rows.results ?? []).map((row: ReviewOutcomeRow) => Object.freeze({
      assignmentId: row.assignment_id,
      claimType: row.claim_type,
      decision: row.decision,
      evidenceHash: row.evidence_hash,
      attestedAt: row.attested_at,
    })));
  }

  private async objectFor(contentHash: string, objectKey: string): Promise<ArtifactObjectRow> {
    const object = await getD1()
      .prepare("SELECT content_hash, object_key, byte_length, content_type FROM artifact_objects WHERE content_hash = ?")
      .bind(contentHash)
      .first<ArtifactObjectRow>();
    if (!object || object.object_key !== objectKey || !Number.isSafeInteger(Number(object.byte_length)) || Number(object.byte_length) < 0) {
      throw new EvidenceIntegrityError();
    }
    return object;
  }
}

const baseSelect = `SELECT
  attempt.id AS attempt_id, attempt.agent_label, attempt.updated_at,
  bundle.id AS bundle_id, bundle.manifest_hash, bundle.manifest_key,
  bundle.canonical_manifest, bundle.agent_event_id, bundle.agent_event_payload_hash,
  project.slug AS project_slug, revision.slug AS problem_slug,
  revision.title AS problem_title, revision.target_key AS declaration,
  (SELECT receipt.id FROM contribution_receipts AS receipt
   WHERE receipt.artifact_bundle_manifest_hash = bundle.manifest_hash
     AND receipt.kind <> 'verification'
   ORDER BY receipt.issued_at ASC, receipt.id ASC LIMIT 1) AS receipt_id,
  (SELECT receipt.receipt_hash FROM contribution_receipts AS receipt
   WHERE receipt.artifact_bundle_manifest_hash = bundle.manifest_hash
     AND receipt.kind <> 'verification'
   ORDER BY receipt.issued_at ASC, receipt.id ASC LIMIT 1) AS receipt_hash,
  (SELECT receipt.issued_at FROM contribution_receipts AS receipt
   WHERE receipt.artifact_bundle_manifest_hash = bundle.manifest_hash
     AND receipt.kind <> 'verification'
   ORDER BY receipt.issued_at ASC, receipt.id ASC LIMIT 1) AS receipt_issued_at,
  CASE WHEN attempt.person_id = ? THEN 'attempt_owner' ELSE 'assigned_reviewer' END AS access_role
 FROM artifact_bundles AS bundle
 INNER JOIN agent_attempts AS attempt ON attempt.id = bundle.attempt_id
 INNER JOIN problem_revisions AS revision ON revision.id = bundle.problem_revision_id
 INNER JOIN projects AS project ON project.id = revision.project_id`;

const personEvidenceAccess = `(attempt.person_id = ? OR EXISTS (
  SELECT 1 FROM verification_assignments AS assignment
  WHERE assignment.artifact_bundle_manifest_hash = bundle.manifest_hash
    AND assignment.verifier_person_id = ?
))`;

export function getEvidenceRepository(): EvidenceRepository {
  return new D1EvidenceRepository();
}

function summaryFrom(row: BaseRow, latestRunState: string | null): AttemptEvidenceSummary {
  return Object.freeze({
    attemptId: row.attempt_id,
    accessRole: row.access_role,
    agentLabel: row.agent_label,
    artifactBundleManifestHash: row.manifest_hash,
    target: Object.freeze({ projectSlug: row.project_slug, problemSlug: row.problem_slug, title: row.problem_title, declaration: row.declaration }),
    latestRunState,
    updatedAt: row.updated_at,
  });
}

function privateArtifact({ id, label, filename, object }: {
  id: EvidenceArtifactId;
  label: string;
  filename: string;
  object: ArtifactObjectRow | OutputRow;
}): PrivateEvidenceArtifact {
  return Object.freeze({
    id,
    label,
    filename,
    contentHash: object.content_hash,
    objectKey: object.object_key,
    byteLength: Number(object.byte_length),
    contentType: object.content_type,
  });
}

function publicArtifact(artifact: PrivateEvidenceArtifact): EvidenceArtifact {
  return Object.freeze({
    id: artifact.id,
    label: artifact.label,
    contentHash: artifact.contentHash,
    byteLength: artifact.byteLength,
    contentType: artifact.contentType,
  });
}

function protocolVersion(row: BaseRow): "pw-artifact-bundle-v1" | "pw-artifact-bundle-v2" {
  try {
    const parsed = JSON.parse(row.canonical_manifest);
    if (parsed?.protocolVersion === "pw-artifact-bundle-v1" || parsed?.protocolVersion === "pw-artifact-bundle-v2") return parsed.protocolVersion;
  } catch {
    // The detailed lookup performs the full integrity-error path.
  }
  throw new EvidenceIntegrityError();
}

function runnerResultSummary(canonicalResult: string): EvidenceRunnerResultSummary | null {
  try {
    const result = normalizeLeanRunnerResult(JSON.parse(canonicalResult));
    return Object.freeze({
      status: result.status,
      exitCode: result.exitCode,
      kernelStatus: result.kernelStatus,
      checks: Object.freeze({ ...result.checks }),
    });
  } catch {
    // Historical or fixture-only result rows remain downloadable as canonical
    // evidence, but never receive a fabricated structured build verdict.
    return null;
  }
}

function filenameFor(referenceId: string): string {
  return { sourceArchive: "source.tar.zst", sourcePatch: "normalized.patch", lakeManifest: "lake-manifest.json" }[referenceId] ?? "artifact.bin";
}

function requireIdentifier(value: string, label: string) {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || /[\0\r\n]/.test(value)) {
    throw new TypeError(`${label} must be a bounded identifier.`);
  }
}

function requireSha256(value: string, label: string) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${label} must be sha256:<hex>.`);
  }
}
