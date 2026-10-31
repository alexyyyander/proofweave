import type { CatalogProblemSummary, CatalogRecordKind } from "./catalog";

export const catalogPageSize = 10;
export type CatalogSort = "recommended" | "title" | "subject";
export type OpportunityFilter = "all" | "formalize" | "advance" | "verified";
export type ScopeFilter = "all" | "bounded" | "long-horizon";
export type CatalogQuery = Readonly<{
  q: string;
  opportunity: OpportunityFilter;
  scope: ScopeFilter;
  subject: string;
  sort: CatalogSort;
}>;
export type CatalogBrowseOptions = CatalogQuery & { kind: CatalogRecordKind; cursor?: string | null };
export type CatalogPage = Readonly<{ records: readonly CatalogProblemSummary[]; nextCursor: string | null }>;
export type CatalogMetadata = Readonly<{
  total: number;
  bounded: number;
  opportunities: Readonly<Record<Exclude<OpportunityFilter, "all">, number>>;
  subjects: CatalogProblemSummary["subjects"];
}>;

export function parseCatalogQuery(params: Pick<URLSearchParams, "get">): CatalogQuery {
  const opportunity = params.get("kind");
  const scope = params.get("scope");
  const sort = params.get("sort");
  return {
    q: (params.get("q") ?? "").trim().slice(0, 200),
    opportunity: opportunity === "formalize" || opportunity === "advance" || opportunity === "verified" ? opportunity : "all",
    scope: scope === "bounded" || scope === "long-horizon" ? scope : "all",
    subject: (params.get("subject") ?? "all").slice(0, 100),
    sort: sort === "title" || sort === "subject" ? sort : "recommended",
  };
}

export function catalogQueryParams(query: CatalogQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.q.trim()) params.set("q", query.q.trim());
  if (query.opportunity !== "all") params.set("kind", query.opportunity);
  if (query.scope !== "all") params.set("scope", query.scope);
  if (query.subject !== "all") params.set("subject", query.subject);
  if (query.sort !== "recommended") params.set("sort", query.sort);
  return params;
}
