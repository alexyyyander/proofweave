/**
 * Read-only reuse projection for a public catalog target. The aggregator is
 * deliberately data-injected: callers pass already-loaded public catalog,
 * curated prior-work, and research-graph data. It does not write, mutate, or
 * infer verification state.
 */

import { findRelatedTargets } from "../../packages/domain/reuse-match.mjs";

export const REUSE_INDEX_RELATED_LIMIT = 5;
export const REUSE_INDEX_RELATED_THRESHOLD = 0.18;
export const REUSE_BOUNDARY_STATEMENT = "Public context ≠ Proofweave verification";

const EMPTY_PRIOR_WORK = Object.freeze({
  count: 0,
  curatedRecords: 0,
  sharedCheckpoints: 0,
  externalWorks: 0,
});

const BOUNDARY = Object.freeze({
  statement: REUSE_BOUNDARY_STATEMENT,
  notes: Object.freeze([
    "Reuse hints are possible duplicate / related / prior work signals only.",
    "They describe textual overlap in public metadata, not novelty, correctness, or a Contribution Receipt.",
    "No match does not mean no prior work exists; it only means the public metadata did not clear the similarity threshold.",
  ]),
});

/**
 * Build the public reuse index for one target.
 *
 * Missing or malformed inputs degrade instead of throwing into the page or
 * API. A missing catalog yields no related targets; missing curated research
 * or research graph data empties only the prior-work sections it feeds.
 *
 * @param {{
 *   catalog?: ReadonlyArray<Record<string, unknown>> | null,
 *   curatedResearch?: ReadonlyArray<Record<string, unknown>> | null,
 *   researchGraph?: Record<string, unknown> | null,
 *   current?: Record<string, unknown> | null
 * }} [input]
 * @returns {{
 *   relatedTargets: Array<{ slug: string, title: string, score: number, label: "possible_duplicate" | "related" }>,
 *   priorWork: { count: number, curatedRecords: number, sharedCheckpoints: number, externalWorks: number },
 *   reusableLeanPaths: Array<{
 *     id: string,
 *     title: string,
 *     url: string,
 *     commit: string | null,
 *     declaration: string | null,
 *     status: string | null,
 *     role: string | null,
 *     sourceSystem: string | null,
 *     sourceIdentifier: string | null
 *   }>,
 *   boundary: { statement: string, notes: readonly string[] },
 *   unavailableReason?: string
 * }}
 */
export function buildReuseIndex({ catalog, curatedResearch, researchGraph, current } = {}) {
  if (!isRecord(current)) return emptyReuseIndex("missing_current_target");

  try {
    const catalogRecords = Array.isArray(catalog) ? catalog.filter(isRecord) : null;
    const curatedRecords = Array.isArray(curatedResearch) ? curatedResearch.filter(isRecord) : null;
    const graph = isRecord(researchGraph) ? researchGraph : null;
    const sharedCheckpoints = graph && Array.isArray(graph.nodes) ? graph.nodes.filter(isRecord) : [];
    const externalWorks = graph && Array.isArray(graph.externalWorks) ? graph.externalWorks.filter(isRecord) : [];

    const relatedTargets = catalogRecords
      ? findRelatedTargets(current, catalogRecords, {
        limit: REUSE_INDEX_RELATED_LIMIT,
        threshold: REUSE_INDEX_RELATED_THRESHOLD,
      })
      : [];
    const reusableLeanPaths = reusablePaths(curatedRecords ?? []);
    const priorWork = {
      count: (curatedRecords?.length ?? 0) + sharedCheckpoints.length + externalWorks.length,
      curatedRecords: curatedRecords?.length ?? 0,
      sharedCheckpoints: sharedCheckpoints.length,
      externalWorks: externalWorks.length,
    };

    const reason = firstUnavailableReason({ catalogRecords, curatedRecords, graph });
    return {
      relatedTargets,
      priorWork,
      reusableLeanPaths,
      boundary: BOUNDARY,
      ...(reason ? { unavailableReason: reason } : {}),
    };
  } catch {
    return emptyReuseIndex("internal_error");
  }
}

function firstUnavailableReason({ catalogRecords, curatedRecords, graph }) {
  if (!catalogRecords) return "catalog_unavailable";
  if (!curatedRecords) return "curated_research_unavailable";
  if (!graph) return "research_graph_unavailable";
  return null;
}

function emptyReuseIndex(reason) {
  return {
    relatedTargets: [],
    priorWork: { ...EMPTY_PRIOR_WORK },
    reusableLeanPaths: [],
    boundary: BOUNDARY,
    unavailableReason: reason,
  };
}

function reusablePaths(records) {
  const seen = new Set();
  const paths = [];
  for (const record of records) {
    const url = typeof record.leanRepositoryUrl === "string" ? record.leanRepositoryUrl.trim() : "";
    if (!url) continue;

    const declaration = typeof record.leanDeclaration === "string" && record.leanDeclaration.length > 0
      ? record.leanDeclaration
      : null;
    const key = `${url}\u0000${declaration ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    paths.push({
      id: typeof record.id === "string" && record.id.length > 0 ? record.id : key,
      title: typeof record.title === "string" && record.title.length > 0
        ? record.title
        : "Lean formalization",
      url,
      commit: typeof record.leanCommit === "string" && record.leanCommit.length > 0 ? record.leanCommit : null,
      declaration,
      status: typeof record.curationStatus === "string" ? record.curationStatus : null,
      role: typeof record.role === "string" ? record.role : null,
      sourceSystem: typeof record.sourceSystem === "string" ? record.sourceSystem : null,
      sourceIdentifier: typeof record.sourceIdentifier === "string" ? record.sourceIdentifier : null,
    });
  }
  return paths;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
