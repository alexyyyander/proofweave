import { getD1 } from "@/db";
import {
  catalogDisplayStatuses,
  type CatalogClaim,
  type CatalogCollection,
  type CatalogProblem,
  type CatalogProblemSummary,
  type CatalogRecordKind,
  type CatalogSubject,
  type VerificationClaimStatus,
  type VerificationClaimType,
  verificationClaimTypes,
} from "@/packages/domain/catalog";

type CatalogRow = {
  problem_id: string;
  problem_slug: string;
  problem_title: string;
  project_id: string;
  project_slug: string;
  project_title: string;
  project_summary: string;
  project_kind: CatalogRecordKind;
  domain: string;
  research_status: CatalogProblem["researchStatus"];
  informal_statement: string;
  lean_statement: string;
  proof_state: CatalogProblem["proofState"];
  source_correspondence: CatalogProblem["sourceCorrespondence"];
  declaration_name: string;
  declaration_kind: CatalogProblem["declaration"]["kind"];
  declaration_source_path: string;
  declaration_source_url: string;
  declaration_line_start: number;
  declaration_line_end: number;
  declaration_content_hash: string;
  upstream_name: string;
  snapshot_source_url: string;
  revision_tag: string;
  revision_commit: string;
  retrieved_at: string;
  snapshot_content_hash: string;
  manifest_hash: string;
  source_license: string;
  lean_toolchain: string;
  mathlib_revision: string;
  claim_type: VerificationClaimType;
  claim_status: VerificationClaimStatus;
  claim_evidence_url: string | null;
  claim_recorded_at: string;
};

type SubjectRow = {
  problem_revision_id: string;
  id: string;
  slug: string;
  name: string;
  ams_code: string;
  description: string;
  is_primary: number;
};

type CollectionRow = {
  problem_revision_id: string;
  id: string;
  slug: string;
  title: string;
  summary: string;
  tier: CatalogCollection["tier"];
  role: CatalogCollection["role"];
  position: number;
};

type CatalogSummaryRow = {
  problem_id: string;
  problem_slug: string;
  problem_title: string;
  project_title: string;
  domain: string;
  research_status: CatalogProblem["researchStatus"];
  informal_statement: string;
  proof_state: CatalogProblem["proofState"];
  declaration_name: string;
  upstream_name: string;
  revision_tag: string;
  claim_type: VerificationClaimType;
  claim_status: VerificationClaimStatus;
};

type SummarySubjectRow = Pick<SubjectRow, "problem_revision_id" | "id" | "slug" | "name" | "ams_code">;
type SummaryCollectionRow = Pick<CollectionRow, "problem_revision_id" | "tier" | "role" | "position">;

export interface CatalogReader {
  list(kind: CatalogRecordKind): Promise<CatalogProblem[]>;
  listSummaries(kind: CatalogRecordKind): Promise<CatalogProblemSummary[]>;
  findBySlug(slug: string): Promise<CatalogProblem | null>;
}

const selectCatalogRows = `
  SELECT
    revision.id AS problem_id,
    revision.slug AS problem_slug,
    revision.title AS problem_title,
    project.id AS project_id,
    project.slug AS project_slug,
    project.title AS project_title,
    project.summary AS project_summary,
    project.kind AS project_kind,
    revision.domain AS domain,
    revision.research_status AS research_status,
    revision.informal_statement AS informal_statement,
    revision.lean_statement AS lean_statement,
    revision.proof_state AS proof_state,
    revision.source_correspondence AS source_correspondence,
    declaration.qualified_name AS declaration_name,
    declaration.declaration_kind AS declaration_kind,
    declaration.source_path AS declaration_source_path,
    declaration.source_url AS declaration_source_url,
    declaration.source_line_start AS declaration_line_start,
    declaration.source_line_end AS declaration_line_end,
    declaration.source_content_hash AS declaration_content_hash,
    snapshot.upstream_name AS upstream_name,
    snapshot.source_url AS snapshot_source_url,
    snapshot.revision_tag AS revision_tag,
    snapshot.revision_commit AS revision_commit,
    snapshot.retrieved_at AS retrieved_at,
    snapshot.content_hash AS snapshot_content_hash,
    snapshot.manifest_hash AS manifest_hash,
    snapshot.source_license AS source_license,
    snapshot.lean_toolchain AS lean_toolchain,
    snapshot.mathlib_revision AS mathlib_revision,
    claim.claim_type AS claim_type,
    claim.status AS claim_status,
    claim.evidence_url AS claim_evidence_url,
    claim.recorded_at AS claim_recorded_at
  FROM problem_revisions AS revision
  INNER JOIN projects AS project ON project.id = revision.project_id
  INNER JOIN source_snapshots AS snapshot ON snapshot.id = revision.source_snapshot_id
  INNER JOIN declarations AS declaration
    ON declaration.problem_revision_id = revision.id AND declaration.is_primary = 1
  INNER JOIN verification_claims AS claim ON claim.problem_revision_id = revision.id
`;

const selectCatalogSummaryRows = `
  SELECT
    revision.id AS problem_id,
    revision.slug AS problem_slug,
    revision.title AS problem_title,
    project.title AS project_title,
    revision.domain AS domain,
    revision.research_status AS research_status,
    revision.informal_statement AS informal_statement,
    revision.proof_state AS proof_state,
    declaration.qualified_name AS declaration_name,
    snapshot.upstream_name AS upstream_name,
    snapshot.revision_tag AS revision_tag,
    claim.claim_type AS claim_type,
    claim.status AS claim_status
  FROM problem_revisions AS revision
  INNER JOIN projects AS project ON project.id = revision.project_id
  INNER JOIN source_snapshots AS snapshot ON snapshot.id = revision.source_snapshot_id
  INNER JOIN declarations AS declaration
    ON declaration.problem_revision_id = revision.id AND declaration.is_primary = 1
  INNER JOIN verification_claims AS claim ON claim.problem_revision_id = revision.id
`;

class D1CatalogRepository implements CatalogReader {
  async list(kind: CatalogRecordKind): Promise<CatalogProblem[]> {
    const rows = await this.readRows(
      `${selectCatalogRows}
       WHERE project.kind = ? AND project.visibility = 'public'
       ORDER BY revision.priority DESC, revision.title ASC, claim.claim_type ASC`,
      [kind],
    );

    return this.enrich(toCatalogProblems(rows));
  }

  async listSummaries(kind: CatalogRecordKind): Promise<CatalogProblemSummary[]> {
    const result = await getD1()
      .prepare(
        `${selectCatalogSummaryRows}
         WHERE project.kind = ? AND project.visibility = 'public'
         ORDER BY revision.priority DESC, revision.title ASC, claim.claim_type ASC`,
      )
      .bind(kind)
      .all<CatalogSummaryRow>();

    return this.enrichSummaries(toCatalogProblemSummaries(result.results ?? []));
  }

  async findBySlug(slug: string): Promise<CatalogProblem | null> {
    const rows = await this.readRows(
      `${selectCatalogRows}
       WHERE revision.slug = ? AND project.visibility = 'public'
       ORDER BY claim.claim_type ASC`,
      [slug],
    );
    return (await this.enrich(toCatalogProblems(rows)))[0] ?? null;
  }

  private async readRows(query: string, bindings: readonly string[]) {
    const result = await getD1().prepare(query).bind(...bindings).all<CatalogRow>();
    return result.results ?? [];
  }


  private async enrich(problems: CatalogProblem[]): Promise<CatalogProblem[]> {
    if (problems.length === 0) return problems;

    const ids = problems.map((problem) => problem.id);
    const placeholders = ids.map(() => "?").join(", ");
    const database = getD1();
    const [subjectResult, collectionResult] = await Promise.all([
      database
        .prepare(`
          SELECT
            membership.problem_revision_id,
            subject.id,
            subject.slug,
            subject.name,
            subject.ams_code,
            subject.description,
            membership.is_primary
          FROM problem_subjects AS membership
          INNER JOIN catalog_subjects AS subject ON subject.id = membership.subject_id
          WHERE membership.problem_revision_id IN (${placeholders})
          ORDER BY membership.is_primary DESC, subject.sort_order ASC, subject.name ASC
        `)
        .bind(...ids)
        .all<SubjectRow>(),
      database
        .prepare(`
          SELECT
            membership.problem_revision_id,
            collection.id,
            collection.slug,
            collection.title,
            collection.summary,
            collection.tier,
            membership.role,
            membership.position
          FROM catalog_collection_members AS membership
          INNER JOIN catalog_collections AS collection ON collection.id = membership.collection_id
          WHERE membership.problem_revision_id IN (${placeholders})
            AND collection.visibility = 'public'
          ORDER BY collection.priority DESC, membership.position ASC
        `)
        .bind(...ids)
        .all<CollectionRow>(),
    ]);

    const subjects = groupSubjects(subjectResult.results ?? []);
    const collections = groupCollections(collectionResult.results ?? []);

    return problems.map((problem) => ({
      ...problem,
      subjects: subjects.get(problem.id) ?? [],
      collections: collections.get(problem.id) ?? [],
    }));
  }

  private async enrichSummaries(problems: CatalogProblemSummary[]): Promise<CatalogProblemSummary[]> {
    if (problems.length === 0) return problems;

    const ids = problems.map((problem) => problem.id);
    const placeholders = ids.map(() => "?").join(", ");
    const database = getD1();
    const [subjectResult, collectionResult] = await Promise.all([
      database
        .prepare(`
          SELECT membership.problem_revision_id, subject.id, subject.slug,
                 subject.name, subject.ams_code
          FROM problem_subjects AS membership
          INNER JOIN catalog_subjects AS subject ON subject.id = membership.subject_id
          WHERE membership.problem_revision_id IN (${placeholders})
          ORDER BY membership.is_primary DESC, subject.sort_order ASC, subject.name ASC
        `)
        .bind(...ids)
        .all<SummarySubjectRow>(),
      database
        .prepare(`
          SELECT membership.problem_revision_id, collection.tier,
                 membership.role, membership.position
          FROM catalog_collection_members AS membership
          INNER JOIN catalog_collections AS collection ON collection.id = membership.collection_id
          WHERE membership.problem_revision_id IN (${placeholders})
            AND collection.visibility = 'public'
          ORDER BY collection.priority DESC, membership.position ASC
        `)
        .bind(...ids)
        .all<SummaryCollectionRow>(),
    ]);

    const subjects = groupSummarySubjects(subjectResult.results ?? []);
    const collections = groupSummaryCollections(collectionResult.results ?? []);
    return problems.map((problem) => ({
      ...problem,
      subjects: subjects.get(problem.id) ?? [],
      collections: collections.get(problem.id) ?? [],
    }));
  }
}

export function getCatalogRepository(): CatalogReader {
  return new D1CatalogRepository();
}

function toCatalogProblems(rows: readonly CatalogRow[]): CatalogProblem[] {
  const records = new Map<string, CatalogProblem>();

  for (const row of rows) {
    const claim = toClaim(row);
    const existing = records.get(row.problem_id);

    if (existing) {
      records.set(row.problem_id, {
        ...existing,
        claims: [...existing.claims, claim],
        displayStatuses: catalogDisplayStatuses(existing.proofState, [
          ...existing.claims,
          claim,
        ]),
      });
      continue;
    }

    records.set(row.problem_id, {
      id: row.problem_id,
      slug: row.problem_slug,
      kind: row.project_kind,
      title: row.problem_title,
      projectId: row.project_id,
      projectSlug: row.project_slug,
      projectTitle: row.project_title,
      projectSummary: row.project_summary,
      domain: row.domain,
      subjects: [],
      collections: [],
      researchStatus: row.research_status,
      informalStatement: row.informal_statement,
      leanStatement: row.lean_statement,
      proofState: row.proof_state,
      sourceCorrespondence: row.source_correspondence,
      declaration: {
        qualifiedName: row.declaration_name,
        kind: row.declaration_kind,
        sourcePath: row.declaration_source_path,
        sourceUrl: row.declaration_source_url,
        sourceLineStart: row.declaration_line_start,
        sourceLineEnd: row.declaration_line_end,
        sourceContentHash: row.declaration_content_hash,
      },
      source: {
        upstreamName: row.upstream_name,
        sourceUrl: row.snapshot_source_url,
        revisionTag: row.revision_tag,
        revisionCommit: row.revision_commit,
        retrievedAt: row.retrieved_at,
        contentHash: row.snapshot_content_hash,
        manifestHash: row.manifest_hash,
        sourceLicense: row.source_license,
        leanToolchain: row.lean_toolchain,
        mathlibRevision: row.mathlib_revision,
      },
      claims: [claim],
      displayStatuses: catalogDisplayStatuses(row.proof_state, [claim]),
    });
  }

  return [...records.values()];
}

function toCatalogProblemSummaries(rows: readonly CatalogSummaryRow[]): CatalogProblemSummary[] {
  const records = new Map<string, Omit<CatalogProblemSummary, "displayStatuses">>();
  const claims = new Map<string, Pick<CatalogClaim, "type" | "status">[]>();

  for (const row of rows) {
    if (!verificationClaimTypes.includes(row.claim_type)) {
      throw new Error(`Unknown verification claim type: ${row.claim_type}`);
    }
    if (!records.has(row.problem_id)) {
      records.set(row.problem_id, {
        id: row.problem_id,
        slug: row.problem_slug,
        title: row.problem_title,
        projectTitle: row.project_title,
        domain: row.domain,
        subjects: [],
        collections: [],
        researchStatus: row.research_status,
        informalStatement: row.informal_statement,
        proofState: row.proof_state,
        declaration: { qualifiedName: row.declaration_name },
        source: { upstreamName: row.upstream_name, revisionTag: row.revision_tag },
      });
    }
    claims.set(row.problem_id, [
      ...(claims.get(row.problem_id) ?? []),
      { type: row.claim_type, status: row.claim_status },
    ]);
  }

  return [...records.entries()].map(([id, problem]) => ({
    ...problem,
    displayStatuses: catalogDisplayStatuses(problem.proofState, claims.get(id) ?? []),
  }));
}

function groupSubjects(rows: readonly SubjectRow[]): Map<string, CatalogSubject[]> {
  const grouped = new Map<string, CatalogSubject[]>();
  for (const row of rows) {
    const subject: CatalogSubject = {
      id: row.id,
      slug: row.slug,
      name: row.name,
      amsCode: row.ams_code,
      description: row.description,
      isPrimary: row.is_primary === 1,
    };
    grouped.set(row.problem_revision_id, [...(grouped.get(row.problem_revision_id) ?? []), subject]);
  }
  return grouped;
}

function groupCollections(rows: readonly CollectionRow[]): Map<string, CatalogCollection[]> {
  const grouped = new Map<string, CatalogCollection[]>();
  for (const row of rows) {
    const collection: CatalogCollection = {
      id: row.id,
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      tier: row.tier,
      role: row.role,
      position: row.position,
    };
    grouped.set(row.problem_revision_id, [...(grouped.get(row.problem_revision_id) ?? []), collection]);
  }
  return grouped;
}

function groupSummarySubjects(
  rows: readonly SummarySubjectRow[],
): Map<string, CatalogProblemSummary["subjects"]> {
  const grouped = new Map<string, CatalogProblemSummary["subjects"]>();
  for (const row of rows) {
    grouped.set(row.problem_revision_id, [
      ...(grouped.get(row.problem_revision_id) ?? []),
      { id: row.id, slug: row.slug, name: row.name, amsCode: row.ams_code },
    ]);
  }
  return grouped;
}

function groupSummaryCollections(
  rows: readonly SummaryCollectionRow[],
): Map<string, CatalogProblemSummary["collections"]> {
  const grouped = new Map<string, CatalogProblemSummary["collections"]>();
  for (const row of rows) {
    grouped.set(row.problem_revision_id, [
      ...(grouped.get(row.problem_revision_id) ?? []),
      { tier: row.tier, role: row.role, position: row.position },
    ]);
  }
  return grouped;
}

function toClaim(row: CatalogRow): CatalogClaim {
  if (!verificationClaimTypes.includes(row.claim_type)) {
    throw new Error(`Unknown verification claim type: ${row.claim_type}`);
  }

  return {
    type: row.claim_type,
    status: row.claim_status,
    evidenceUrl: row.claim_evidence_url,
    recordedAt: row.claim_recorded_at,
  };
}
