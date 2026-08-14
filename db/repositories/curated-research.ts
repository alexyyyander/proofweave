import { getD1 } from "@/db";

export type CuratedResearchRole =
  | "origin"
  | "definition"
  | "special_case"
  | "key_lemma"
  | "counterexample"
  | "negative_result"
  | "progress"
  | "formalization"
  | "reproduction"
  | "announcement"
  | "current_state";

export type CuratedResearchKind =
  | "paper"
  | "preprint"
  | "repository"
  | "announcement"
  | "formalization"
  | "result"
  | "review";

export type CuratedResearchStatus =
  | "source_asserted"
  | "curator_reviewed"
  | "lean_reproduced"
  | "disputed"
  | "superseded";

export type PublicCuratedResearchRecord = Readonly<{
  id: string;
  problemRevisionId: string;
  role: CuratedResearchRole;
  kind: CuratedResearchKind;
  title: string;
  authors: string;
  summary: string;
  sourceSystem: string;
  sourceUrl: string;
  sourceIdentifier: string;
  occurredAt: string;
  curationStatus: CuratedResearchStatus;
  leanRepositoryUrl: string | null;
  leanCommit: string | null;
  leanDeclaration: string | null;
  position: number;
}>;

export class CuratedResearchSchemaUnavailableError extends Error {
  constructor() {
    super("The curated research registry is not active in this control plane.");
    this.name = "CuratedResearchSchemaUnavailableError";
  }
}

export interface CuratedResearchRepository {
  findByProblemRevisionId(
    problemRevisionId: string,
  ): Promise<readonly PublicCuratedResearchRecord[]>;
}

class D1CuratedResearchRepository implements CuratedResearchRepository {
  async findByProblemRevisionId(problemRevisionId: string) {
    try {
      const result = await getD1().prepare(
        `SELECT id, problem_revision_id, role, kind, title, authors, summary,
                source_system, source_url, source_identifier, occurred_at,
                curation_status, lean_repository_url, lean_commit,
                lean_declaration, position
         FROM curated_research_records
         WHERE problem_revision_id = ?
         ORDER BY occurred_at ASC, position ASC, id ASC`,
      ).bind(problemRevisionId).all();

      return Object.freeze((result.results ?? []).map(toPublicRecord));
    } catch (error) {
      if (isMissingCuratedResearchTable(error)) {
        throw new CuratedResearchSchemaUnavailableError();
      }
      throw error;
    }
  }
}

const repository = new D1CuratedResearchRepository();

export function getCuratedResearchRepository(): CuratedResearchRepository {
  return repository;
}

function toPublicRecord(row: Record<string, unknown>): PublicCuratedResearchRecord {
  return Object.freeze({
    id: requireString(row.id, "id"),
    problemRevisionId: requireString(row.problem_revision_id, "problem_revision_id"),
    role: requireString(row.role, "role") as CuratedResearchRole,
    kind: requireString(row.kind, "kind") as CuratedResearchKind,
    title: requireString(row.title, "title"),
    authors: requireString(row.authors, "authors"),
    summary: requireString(row.summary, "summary"),
    sourceSystem: requireString(row.source_system, "source_system"),
    sourceUrl: requireString(row.source_url, "source_url"),
    sourceIdentifier: requireString(row.source_identifier, "source_identifier"),
    occurredAt: requireString(row.occurred_at, "occurred_at"),
    curationStatus: requireString(row.curation_status, "curation_status") as CuratedResearchStatus,
    leanRepositoryUrl: nullableString(row.lean_repository_url),
    leanCommit: nullableString(row.lean_commit),
    leanDeclaration: nullableString(row.lean_declaration),
    position: requireNumber(row.position, "position"),
  });
}

function isMissingCuratedResearchTable(error: unknown): boolean {
  return error instanceof Error && /no such table:\s*curated_research_records/i.test(error.message);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`Curated research ${label} is invalid.`);
  return value;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : requireString(value, "nullable field");
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`Curated research ${label} is invalid.`);
  }
  return value;
}
