import {
  normalizeResearchCheckpoint,
  researchCheckpointHash,
  verifyResearchCheckpointSignature,
} from "../../packages/protocol/research-checkpoint.mjs";
import { canonicalJson, sha256Canonical } from "../../packages/protocol/canonical-json.mjs";
import { loadResearchNodeEvidence } from "./research-node-evidence.mjs";

export class ResearchGraphValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResearchGraphValidationError";
  }
}

export class ResearchGraphConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResearchGraphConflictError";
  }
}

export class ResearchGraphNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "ResearchGraphNotFoundError";
  }
}

/**
 * Append-only research graph boundary. Derivation edges are accepted only as
 * part of a new child node and may target existing nodes from the same pinned
 * problem revision, which makes the derivation projection acyclic by
 * construction. Semantic cross-links belong to a separate future layer.
 */
export class D1ResearchGraphStore {
  constructor(database) {
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1ResearchGraphStore requires a D1 database binding.");
    }
    this.database = database;
  }

  async publishCheckpoint({ principal, installation, attempt, checkpoint }) {
    let normalized;
    try {
      normalized = normalizeResearchCheckpoint(checkpoint);
    } catch (error) {
      throw new ResearchGraphValidationError(error instanceof Error ? error.message : "Research checkpoint is invalid.");
    }
    if (
      normalized.attemptId !== attempt.id ||
      normalized.problemRevisionId !== attempt.problemRevisionId ||
      normalized.agentEvent.agentId !== installation.agentId ||
      normalized.agentEvent.agentPublicKey !== installation.agentPublicKey ||
      attempt.agentId !== installation.agentId ||
      attempt.delegationCertificateId !== installation.delegationCertificateId
    ) {
      throw new ResearchGraphValidationError("Research checkpoint does not match the authorized Agent, Attempt, or pinned target.");
    }
    if (attempt.status !== "active") {
      throw new ResearchGraphConflictError("Research checkpoints can only be published while an Attempt is active.");
    }
    if (!await verifyResearchCheckpointSignature(normalized)) {
      throw new ResearchGraphValidationError("Research checkpoint signature or payload hash is invalid.");
    }

    const canonicalCheckpoint = canonicalJson(normalized);
    const checkpointHash = await researchCheckpointHash(normalized);
    const existing = await this.findStoredCheckpoint(normalized.id, normalized.agentEvent.id, normalized.payloadHash);
    if (existing) {
      if (existing.canonical_checkpoint !== canonicalCheckpoint || existing.checkpoint_hash !== checkpointHash) {
        throw new ResearchGraphConflictError("A research checkpoint identifier, event, or payload hash was already used for different content.");
      }
      return Object.freeze({
        node: await this.requirePublicNode(existing.id),
        created: false,
        graphState: "shared_unverified",
      });
    }

    await this.assertParents(normalized.problemRevisionId, normalized.parentNodeIds);
    await this.assertCitations(normalized.problemRevisionId, normalized.citations);
    await this.assertArtifactBundle(normalized.attemptId, normalized.artifactBundleHash);

    const relation = normalized.kind === "synthesis" ? "merges" : "derives_from";
    const statements = [
      this.database.prepare(
        `INSERT INTO research_nodes (
          id, problem_revision_id, attempt_id, beneficiary_person_id,
          beneficiary_agent_id, delegation_certificate_id, kind, summary,
          proof_state_hash, artifact_bundle_manifest_hash, initial_state,
          payload_hash, checkpoint_hash, canonical_checkpoint, agent_event_id,
          agent_event_occurred_at, agent_public_key, agent_signature
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'shared_unverified', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        normalized.id,
        normalized.problemRevisionId,
        normalized.attemptId,
        principal.personId,
        installation.agentId,
        installation.delegationCertificateId,
        normalized.kind,
        normalized.summary,
        normalized.proofStateHash,
        normalized.artifactBundleHash,
        normalized.payloadHash,
        checkpointHash,
        canonicalCheckpoint,
        normalized.agentEvent.id,
        normalized.agentEvent.occurredAt,
        normalized.agentEvent.agentPublicKey,
        normalized.agentEvent.signature,
      ),
      ...normalized.parentNodeIds.map((parentNodeId) => this.database.prepare(
        `INSERT INTO research_derivation_edges (
          child_node_id, parent_node_id, relation, declared_by_payload_hash, recorded_at
        ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(normalized.id, parentNodeId, relation, normalized.payloadHash, normalized.agentEvent.occurredAt)),
      ...normalized.citations.map((citation) => this.database.prepare(
        `INSERT INTO research_node_citations (
          research_node_id, external_work_id, relation, declared_by_payload_hash, recorded_at
        ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(normalized.id, citation.externalWorkId, citation.relation, normalized.payloadHash, normalized.agentEvent.occurredAt)),
      this.database.prepare(
        `INSERT INTO research_node_events (
          id, node_id, sequence, event_type, payload_hash, occurred_at
        ) VALUES (?, ?, 1, 'published', ?, ?)`,
      ).bind(normalized.agentEvent.id, normalized.id, normalized.payloadHash, normalized.agentEvent.occurredAt),
      this.database.prepare(
        `INSERT INTO agent_attempt_events (
          id, attempt_id, sequence, event_type, message, idempotency_key, occurred_at
        )
        SELECT ?, ?, COALESCE(MAX(sequence), 0) + 1, 'checkpoint_published', ?, ?, ?
        FROM agent_attempt_events WHERE attempt_id = ?`,
      ).bind(
        `attempt-checkpoint:${normalized.agentEvent.id}`,
        normalized.attemptId,
        `Published ${normalized.kind} checkpoint ${normalized.id}. It is shared Agent-signed research progress, not Lean verification, independent review, novelty, or contribution credit.`,
        `research-checkpoint:${normalized.agentEvent.id}`,
        normalized.agentEvent.occurredAt,
        normalized.attemptId,
      ),
      this.database.prepare(
        "UPDATE agent_attempts SET updated_at = ? WHERE id = ? AND person_id = ?",
      ).bind(normalized.agentEvent.occurredAt, normalized.attemptId, principal.personId),
    ];

    try {
      await this.database.batch(statements);
    } catch (error) {
      const replay = await this.findStoredCheckpoint(normalized.id, normalized.agentEvent.id, normalized.payloadHash);
      if (replay?.canonical_checkpoint === canonicalCheckpoint && replay?.checkpoint_hash === checkpointHash) {
        return Object.freeze({ node: await this.requirePublicNode(replay.id), created: false, graphState: "shared_unverified" });
      }
      throw error;
    }

    return Object.freeze({
      node: await this.requirePublicNode(normalized.id),
      created: true,
      graphState: "shared_unverified",
    });
  }

  async readProblemGraph(problemRevisionId, { limit = 300 } = {}) {
    requireIdentifier(problemRevisionId, "Problem revision id");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new ResearchGraphValidationError("Research graph limit must be an integer from 1 to 500.");
    }
    const nodeRows = await this.database.prepare(
      `${publicNodeSelect}
       WHERE node.problem_revision_id = ?
       ORDER BY node.agent_event_occurred_at ASC, node.id ASC
       LIMIT ?`,
    ).bind(problemRevisionId, limit).all();
    const nodes = await loadResearchNodeEvidence(
      this.database,
      (nodeRows.results ?? []).map(toPublicNode),
    );
    const nodeIds = nodes.map((node) => node.id);
    const placeholders = nodeIds.map(() => "?").join(",");
    const edgePromise = nodeIds.length === 0
      ? Promise.resolve({ results: [] })
      : this.database.prepare(
        `SELECT child_node_id, parent_node_id, relation, recorded_at
         FROM research_derivation_edges
         WHERE child_node_id IN (${placeholders})
         ORDER BY recorded_at ASC, child_node_id ASC, parent_node_id ASC`,
      ).bind(...nodeIds).all();
    const [edgeRows, sourceRows] = await Promise.all([
      edgePromise,
      this.database.prepare(
        `SELECT citation.research_node_id, citation.external_work_id, citation.relation,
                work.source_system, work.source_url, work.source_object_id,
                work.source_revision, work.title, work.content_hash,
                work.source_license, work.retrieved_at,
                attribution.id AS attribution_id, attribution.display_name,
                attribution.persistent_id_scheme, attribution.persistent_id,
                attribution.role, attribution.assertion_status, attribution.evidence_url
         FROM external_work_problem_links AS problem_link
         INNER JOIN external_works AS work ON work.id = problem_link.external_work_id
         LEFT JOIN research_node_citations AS citation
           ON citation.external_work_id = work.id
          AND citation.research_node_id IN (
            SELECT id FROM research_nodes WHERE problem_revision_id = problem_link.problem_revision_id
          )
         LEFT JOIN external_attributions AS attribution ON attribution.external_work_id = work.id
         WHERE problem_link.problem_revision_id = ?
         ORDER BY work.title ASC, attribution.display_name ASC`,
      ).bind(problemRevisionId).all(),
    ]);
    return Object.freeze({
      nodes: Object.freeze(nodes),
      edges: Object.freeze((edgeRows.results ?? []).map((row) => Object.freeze({
        childNodeId: row.child_node_id,
        parentNodeId: row.parent_node_id,
        relation: row.relation,
        recordedAt: row.recorded_at,
      }))),
      externalWorks: Object.freeze(toExternalWorks(sourceRows.results ?? [])),
      truncated: nodes.length === limit,
    });
  }

  async importExternalWork(personId, input) {
    requireIdentifier(personId, "Asserting Person id");
    const normalized = normalizeExternalWorkInput(input);
    const problem = await this.database.prepare(
      "SELECT id FROM problem_revisions WHERE id = ?",
    ).bind(normalized.problemRevisionId).first();
    if (!problem) throw new ResearchGraphNotFoundError("The historical source target problem revision was not found.");
    const identityHash = await sha256Canonical({
      protocolVersion: "pw-external-work-import-v1",
      sourceSystem: normalized.sourceSystem,
      sourceObjectId: normalized.sourceObjectId,
      sourceRevision: normalized.sourceRevision,
    });
    const id = `external-work:${identityHash.slice("sha256:".length)}`;
    const existing = await this.database.prepare(
      `SELECT * FROM external_works
       WHERE source_system = ? AND source_object_id = ? AND source_revision = ?`,
    ).bind(normalized.sourceSystem, normalized.sourceObjectId, normalized.sourceRevision).first();
    if (existing && !sameExternalWork(existing, normalized)) {
      throw new ResearchGraphConflictError("This historical source revision was already imported with different immutable provenance.");
    }
    const statements = [];
    if (!existing) {
      statements.push(this.database.prepare(
        `INSERT INTO external_works (
          id, source_system, source_url, source_object_id, source_revision,
          title, content_hash, source_license, retrieved_at, asserted_by_person_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        normalized.sourceSystem,
        normalized.sourceUrl,
        normalized.sourceObjectId,
        normalized.sourceRevision,
        normalized.title,
        normalized.contentHash,
        normalized.sourceLicense,
        normalized.retrievedAt,
        personId,
      ));
    }
    const workId = existing?.id ?? id;
    statements.push(this.database.prepare(
      `INSERT OR IGNORE INTO external_work_problem_links (
        external_work_id, problem_revision_id, relation, asserted_by_person_id, recorded_at
      ) VALUES (?, ?, 'prior_work', ?, ?)`,
    ).bind(workId, normalized.problemRevisionId, personId, normalized.retrievedAt));
    for (const contributor of normalized.contributors) {
      const attributionHash = await sha256Canonical({
        protocolVersion: "pw-external-attribution-v1",
        externalWorkId: workId,
        ...contributor,
      });
      statements.push(this.database.prepare(
        `INSERT OR IGNORE INTO external_attributions (
          id, external_work_id, display_name, persistent_id_scheme,
          persistent_id, role, assertion_status, asserted_by_person_id, evidence_url
        ) VALUES (?, ?, ?, ?, ?, ?, 'source_asserted', ?, ?)`,
      ).bind(
        `external-attribution:${attributionHash.slice("sha256:".length)}`,
        workId,
        contributor.displayName,
        contributor.persistentIdScheme,
        contributor.persistentId,
        contributor.role,
        personId,
        contributor.evidenceUrl,
      ));
    }
    if (statements.length > 0) await this.database.batch(statements);
    return Object.freeze({
      externalWork: await this.requireExternalWork(workId),
      created: !existing,
      attributionState: "source_asserted",
      receiptIssued: false,
    });
  }

  async findStoredCheckpoint(id, eventId, payloadHash) {
    return this.database.prepare(
      `SELECT id, canonical_checkpoint, checkpoint_hash FROM research_nodes
       WHERE id = ? OR agent_event_id = ? OR payload_hash = ?
       LIMIT 1`,
    ).bind(id, eventId, payloadHash).first();
  }

  async assertParents(problemRevisionId, parentNodeIds) {
    if (parentNodeIds.length === 0) return;
    const placeholders = parentNodeIds.map(() => "?").join(",");
    const rows = await this.database.prepare(
      `SELECT id, problem_revision_id FROM research_nodes WHERE id IN (${placeholders})`,
    ).bind(...parentNodeIds).all();
    const found = new Map((rows.results ?? []).map((row) => [row.id, row.problem_revision_id]));
    const invalid = parentNodeIds.find((id) => found.get(id) !== problemRevisionId);
    if (invalid) {
      throw new ResearchGraphNotFoundError("Every parent checkpoint must already exist on the same pinned problem revision.");
    }
  }

  async assertCitations(problemRevisionId, citations) {
    if (citations.length === 0) return;
    const ids = [...new Set(citations.map((citation) => citation.externalWorkId))];
    const placeholders = ids.map(() => "?").join(",");
    const rows = await this.database.prepare(
      `SELECT external_work_id FROM external_work_problem_links
       WHERE problem_revision_id = ? AND external_work_id IN (${placeholders})`,
    ).bind(problemRevisionId, ...ids).all();
    const found = new Set((rows.results ?? []).map((row) => row.external_work_id));
    if (ids.some((id) => !found.has(id))) {
      throw new ResearchGraphNotFoundError("Every cited historical work must be imported into this exact target before publishing the checkpoint.");
    }
  }

  async assertArtifactBundle(attemptId, artifactBundleHash) {
    if (artifactBundleHash === null) return;
    const row = await this.database.prepare(
      "SELECT manifest_hash FROM artifact_bundles WHERE manifest_hash = ? AND attempt_id = ?",
    ).bind(artifactBundleHash, attemptId).first();
    if (!row) {
      throw new ResearchGraphNotFoundError("The checkpoint Artifact Bundle must already be staged for this exact Attempt.");
    }
  }

  async requirePublicNode(id) {
    const row = await this.database.prepare(`${publicNodeSelect} WHERE node.id = ?`).bind(id).first();
    if (!row) throw new ResearchGraphNotFoundError("Research checkpoint was not found.");
    return toPublicNode(row);
  }

  async requireExternalWork(id) {
    const rows = await this.database.prepare(
      `SELECT work.id AS external_work_id, work.source_system, work.source_url,
              work.source_object_id, work.source_revision, work.title,
              work.content_hash, work.source_license, work.retrieved_at,
              attribution.id AS attribution_id, attribution.display_name,
              attribution.persistent_id_scheme, attribution.persistent_id,
              attribution.role, attribution.assertion_status, attribution.evidence_url,
              NULL AS research_node_id, NULL AS relation
       FROM external_works AS work
       LEFT JOIN external_attributions AS attribution ON attribution.external_work_id = work.id
       WHERE work.id = ?
       ORDER BY attribution.display_name ASC`,
    ).bind(id).all();
    const works = toExternalWorks(rows.results ?? []);
    if (!works[0]) throw new ResearchGraphNotFoundError("Historical source was not found.");
    return works[0];
  }
}

const publicNodeSelect = `SELECT
  node.id, node.problem_revision_id, node.attempt_id, node.kind, node.summary,
  node.proof_state_hash, node.artifact_bundle_manifest_hash, node.initial_state,
  node.delegation_certificate_id,
  node.payload_hash, node.checkpoint_hash, node.agent_event_occurred_at,
  node.beneficiary_person_id, person.display_name AS person_display_name,
  node.beneficiary_agent_id, agent.label AS agent_label
 FROM research_nodes AS node
 INNER JOIN persons AS person ON person.id = node.beneficiary_person_id
 INNER JOIN agents AS agent ON agent.id = node.beneficiary_agent_id`;

function toPublicNode(row) {
  return Object.freeze({
    id: row.id,
    problemRevisionId: row.problem_revision_id,
    attemptId: row.attempt_id,
    kind: row.kind,
    summary: row.summary,
    proofStateHash: row.proof_state_hash,
    artifactBundleHash: row.artifact_bundle_manifest_hash,
    delegationCertificateId: row.delegation_certificate_id,
    state: row.initial_state,
    payloadHash: row.payload_hash,
    checkpointHash: row.checkpoint_hash,
    occurredAt: row.agent_event_occurred_at,
    creator: Object.freeze({
      personId: row.beneficiary_person_id,
      displayName: row.person_display_name,
      agentId: row.beneficiary_agent_id,
      agentLabel: row.agent_label,
    }),
  });
}

function normalizeExternalWorkInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ResearchGraphValidationError("Historical source input is required.");
  }
  const problemRevisionId = boundedString(input.problemRevisionId, "problemRevisionId", 240);
  const sourceSystem = boundedString(input.sourceSystem, "sourceSystem", 120);
  const sourceUrl = absoluteHttpUrl(input.sourceUrl, "sourceUrl");
  const sourceObjectId = boundedString(input.sourceObjectId, "sourceObjectId", 240);
  const sourceRevision = boundedString(input.sourceRevision, "sourceRevision", 240);
  const title = boundedString(input.title, "title", 500);
  const contentHash = sha256(input.contentHash, "contentHash");
  const sourceLicense = boundedString(input.sourceLicense, "sourceLicense", 160);
  const retrievedAt = utcInstant(input.retrievedAt, "retrievedAt");
  if (!Array.isArray(input.contributors) || input.contributors.length < 1 || input.contributors.length > 100) {
    throw new ResearchGraphValidationError("Historical source contributors must contain between 1 and 100 source-backed entries.");
  }
  const contributors = input.contributors.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ResearchGraphValidationError("Historical contributor must be an object.");
    }
    const role = ["author", "formalizer", "prover", "reviewer", "maintainer"].includes(entry.role) ? entry.role : null;
    if (!role) throw new ResearchGraphValidationError("Historical contributor role is invalid.");
    const persistentIdScheme = entry.persistentIdScheme === null ? null : boundedString(entry.persistentIdScheme, "persistentIdScheme", 40);
    const persistentId = entry.persistentId === null ? null : boundedString(entry.persistentId, "persistentId", 240);
    if ((persistentIdScheme === null) !== (persistentId === null)) {
      throw new ResearchGraphValidationError("Historical contributor persistent identifier scheme and value must be supplied together.");
    }
    return Object.freeze({
      displayName: boundedString(entry.displayName, "contributor displayName", 240),
      persistentIdScheme,
      persistentId,
      role,
      evidenceUrl: absoluteHttpUrl(entry.evidenceUrl, "contributor evidenceUrl"),
    });
  });
  return Object.freeze({ problemRevisionId, sourceSystem, sourceUrl, sourceObjectId, sourceRevision, title, contentHash, sourceLicense, retrievedAt, contributors: Object.freeze(contributors) });
}

function sameExternalWork(row, input) {
  return row.source_url === input.sourceUrl && row.title === input.title &&
    row.content_hash === input.contentHash && row.source_license === input.sourceLicense;
}

function toExternalWorks(rows) {
  const works = new Map();
  for (const row of rows) {
    let work = works.get(row.external_work_id);
    if (!work) {
      work = {
        id: row.external_work_id,
        sourceSystem: row.source_system,
        sourceUrl: row.source_url,
        sourceObjectId: row.source_object_id,
        sourceRevision: row.source_revision,
        title: row.title,
        contentHash: row.content_hash,
        sourceLicense: row.source_license,
        retrievedAt: row.retrieved_at,
        citedBy: [],
        attributions: [],
      };
      works.set(row.external_work_id, work);
    }
    if (row.research_node_id && !work.citedBy.some((entry) => entry.nodeId === row.research_node_id && entry.relation === row.relation)) {
      work.citedBy.push(Object.freeze({ nodeId: row.research_node_id, relation: row.relation }));
    }
    if (row.attribution_id && !work.attributions.some((entry) => entry.id === row.attribution_id)) {
      work.attributions.push(Object.freeze({
        id: row.attribution_id,
        displayName: row.display_name,
        persistentIdScheme: row.persistent_id_scheme,
        persistentId: row.persistent_id,
        role: row.role,
        assertionStatus: row.assertion_status,
        evidenceUrl: row.evidence_url,
      }));
    }
  }
  return [...works.values()].map((work) => Object.freeze({
    ...work,
    citedBy: Object.freeze(work.citedBy),
    attributions: Object.freeze(work.attributions),
  }));
}

function requireIdentifier(value, label) {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || value.length > 240) {
    throw new ResearchGraphValidationError(`${label} must be a trimmed non-empty identifier.`);
  }
}

function boundedString(value, label, maxLength) {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim() || value.length > maxLength || value.includes("\u0000")) {
    throw new ResearchGraphValidationError(`Historical source ${label} is invalid.`);
  }
  return value;
}

function absoluteHttpUrl(value, label) {
  const normalized = boundedString(value, label, 2_000);
  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw new ResearchGraphValidationError(`Historical source ${label} must be an absolute HTTP(S) URL.`);
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.hash) {
    throw new ResearchGraphValidationError(`Historical source ${label} must be an absolute HTTP(S) URL without credentials or fragments.`);
  }
  return url.toString();
}

function sha256(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new ResearchGraphValidationError(`Historical source ${label} must be sha256:<hex>.`);
  }
  return value;
}

function utcInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ResearchGraphValidationError(`Historical source ${label} must be an ISO-8601 UTC instant.`);
  }
  return value;
}
