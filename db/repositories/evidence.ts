import { getD1 } from "@/db";
import {
  artifactBundleHash,
  artifactBundleObjectReferences,
  canonicalArtifactBundle,
  normalizeArtifactBundle,
} from "@/packages/protocol/artifact-bundle.mjs";

export type EvidenceAccessRole = "attempt_owner" | "assigned_reviewer";
export type EvidenceArtifactId =
  | "bundle-manifest"
  | "sourceArchive"
  | "sourcePatch"
  | "lakeManifest"
  | `run:${string}:stdout`
  | `run:${string}:stderr`;

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
  }> | null;
  outputs: readonly EvidenceArtifact[];
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
    artifacts: readonly EvidenceArtifact[];
  }>;
  runs: readonly EvidenceRun[];
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
        .prepare("SELECT state FROM runs WHERE attempt_id = ? ORDER BY updated_at DESC, id ASC LIMIT 1")
        .bind(row.attempt_id)
        .first<{ state: string }>();
      return summaryFrom(row, latest?.state ?? null);
    }));
    return Object.freeze(summaries);
  }

  async getForPerson(personId: string, bundleManifestHash: string): Promise<AttemptEvidence | null> {
    const base = await this.findBase(personId, bundleManifestHash);
    if (!base) return null;
    const privateArtifacts = await this.artifactsFor(base);
    const runs = await this.runsFor(base.attempt_id);
    return Object.freeze({
      summary: summaryFrom(base, runs[0]?.state ?? null),
      bundle: Object.freeze({
        id: base.bundle_id,
        protocolVersion: protocolVersion(base),
        manifestHash: base.manifest_hash,
        agentEventId: base.agent_event_id,
        agentEventPayloadHash: base.agent_event_payload_hash,
        canonicalManifest: base.canonical_manifest,
        artifacts: Object.freeze(privateArtifacts.map(publicArtifact)),
      }),
      runs: Object.freeze(runs.map((run) => Object.freeze({
        ...run,
        outputs: Object.freeze(run.outputs.map(publicArtifact)),
      }))),
    });
  }

  async getArtifactForPerson(personId: string, bundleManifestHash: string, artifactId: string): Promise<PrivateEvidenceArtifact | null> {
    const base = await this.findBase(personId, bundleManifestHash);
    if (!base) return null;
    const artifacts = await this.artifactsFor(base);
    const runs = await this.runsFor(base.attempt_id);
    return artifacts.concat(runs.flatMap((run) => run.outputs)).find((artifact) => artifact.id === artifactId) ?? null;
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

  private async runsFor(attemptId: string): Promise<readonly (EvidenceRun & { outputs: readonly PrivateEvidenceArtifact[] })[]> {
    const rows = await getD1()
      .prepare(
        `SELECT run.id, run.state, run.request_hash, run.runner_result_hash,
                run.queued_at, run.started_at, run.finished_at,
                result.result_hash, result.canonical_result, result.received_at
         FROM runs AS run
         LEFT JOIN run_results AS result ON result.run_id = run.id
         WHERE run.attempt_id = ?
         ORDER BY run.updated_at DESC, run.id ASC`,
      )
      .bind(attemptId)
      .all<RunRow>();
    const outputRows = await getD1()
      .prepare(
        `SELECT output.run_id, output.role, output.content_hash, output.object_key,
                output.byte_length, output.content_type
         FROM runner_output_artifacts AS output
         INNER JOIN runs AS run ON run.id = output.run_id
         WHERE run.attempt_id = ?
         ORDER BY output.run_id ASC, output.role ASC`,
      )
      .bind(attemptId)
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
        ? Object.freeze({ resultHash: run.result_hash, canonicalResult: run.canonical_result, receivedAt: run.received_at })
        : null,
      outputs: Object.freeze(outputsByRun.get(run.id) ?? []),
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
