import {
  PROOF_EVOLUTION_SCHEMA_VERSION,
  type ArgumentMapComparison,
  type ArgumentMapData,
  type ArgumentMapEdge,
  type ArgumentMapRole,
  type LeanAnchor,
  type LeanPaperAlignment,
  type LeanStatus,
  type LeanStructureData,
  type ProofDetailLevel,
  type ProofEvolutionData,
  type ProofStepKind,
} from "./proof-evolution";

export type DeepProofNode = {
  id: string;
  role: string;
  label: string;
  fullLabel: string;
  kind: ProofStepKind;
  source: string;
  detail: string;
  dependsOn: string[];
};

export type DeepProofStrategy = {
  id: string;
  label: string;
  title: string;
  authors: string[];
  date: string;
  pages: number;
  color: string;
  sourceUrl: string;
  sourceLabel: string;
  note: string;
  proofDetail: ProofDetailLevel;
  leanStatus?: LeanStatus;
  leanLabel?: string;
  leanUrl?: string | null;
  leanNote?: string;
  nodes: DeepProofNode[];
};

export type DeepRelatedManuscript = {
  title: string;
  authors: string[];
  date: string;
  pdfUrl: string;
  readmeUrl: string;
  relation: string;
  note: string;
};

export type DeepLeanAlignment = {
  strategyId: string;
  nodeId: string;
  theoremNames: string[];
  solutionModule: string;
  solutionUrl: string;
  confidence: "source-anchored" | "inferred";
  note: string;
};

export type DeepProofMapData = {
  schemaVersion: "pw-deep-proof-map-v1";
  status: "deep";
  reviewStatus: "unreviewed";
  curatedAt: string;
  familyNumber: string;
  title: string;
  result: {
    id: string;
    label: string;
    statement: string;
    source: string;
    detail?: string;
    roleNote?: string;
  };
  roles: ArgumentMapRole[];
  strategies: DeepProofStrategy[];
  finalEdges: ArgumentMapEdge[];
  crossEdges: ArgumentMapEdge[];
  comparisons: ArgumentMapComparison[];
  sharedInputs: string[];
  summaryNote?: string;
  relatedManuscripts: DeepRelatedManuscript[];
  leanAlignments: DeepLeanAlignment[];
  caveats: string[];
  sources: { label: string; url: string; kind: string }[];
};

export type AdaptedDeepProofMap = {
  proof: ProofEvolutionData;
  argumentMap: ArgumentMapData;
  lean: LeanStructureData;
};

function leanForStrategy(deep: DeepProofMapData, strategy: DeepProofStrategy) {
  const alignments = deep.leanAlignments.filter((alignment) => alignment.strategyId === strategy.id);
  const status: LeanStatus = strategy.leanStatus ?? (alignments.length > 0 ? "formalized_upstream" : "not_formalized");
  return {
    status,
    label: strategy.leanLabel ?? alignments[0]?.theoremNames[0] ?? "No Lean comparator linked",
    url: strategy.leanUrl ?? alignments[0]?.solutionUrl ?? null,
    note: strategy.leanNote ?? (alignments.length > 0
      ? "A comparator-linked declaration is recorded, but it is not a kernel check of this paper step."
      : "No step-level Lean alignment is recorded for this strategy."),
  };
}

function buildLeanData(deep: DeepProofMapData, revision: string): LeanStructureData {
  const nodeById = new Map(deep.strategies.flatMap((strategy) => strategy.nodes.map((node) => [`${strategy.id}:${node.id}`, node] as const)));
  const anchors: LeanAnchor[] = [];
  const paperAlignments: LeanPaperAlignment[] = [];
  for (const alignment of deep.leanAlignments) {
    const node = nodeById.get(`${alignment.strategyId}:${alignment.nodeId}`);
    if (!node) continue;
    const anchorIds: string[] = [];
    for (const theoremName of alignment.theoremNames) {
      const id = `${alignment.strategyId}:${alignment.nodeId}:${theoremName}`;
      anchorIds.push(id);
      anchors.push({
        id,
        declaration: theoremName.split(".").pop() ?? theoremName,
        fullName: theoremName,
        kind: "theorem",
        module: alignment.solutionModule,
        line: null,
        paperStepId: alignment.nodeId,
        role: node.fullLabel,
        note: alignment.note,
        url: alignment.solutionUrl,
      });
    }
    paperAlignments.push({
      versionId: alignment.strategyId,
      stepId: alignment.nodeId,
      subsystems: [],
      modules: [alignment.solutionModule],
      anchors: anchorIds,
      confidence: alignment.confidence,
      note: alignment.note,
    });
  }
  const modules = [...new Set(deep.leanAlignments.map((alignment) => alignment.solutionModule))];
  const alignedNodes = [...new Set(deep.leanAlignments.map((alignment) => {
    const node = nodeById.get(`${alignment.strategyId}:${alignment.nodeId}`);
    return node?.fullLabel ?? `${alignment.strategyId}:${alignment.nodeId}`;
  }))];
  return {
    schemaVersion: "pw-lean-structure-v1",
    status: "draft",
    reviewStatus: "unreviewed",
    generatedAt: deep.curatedAt,
    root: deep.familyNumber,
    commit: revision,
    sourceNote: "Lean alignment built from the curated deep map and comparator metadata. It records declaration names and modules, not a kernel build.",
    noAlignmentNote: deep.leanAlignments.length === 0
      ? "No Lean scope document or comparator is linked for this family in the pinned snapshot."
      : `No step-level Lean alignment is recorded for this node. The recorded alignments cover: ${alignedNodes.join("; ")}.`,
    summary: {
      fetchedModules: modules.length,
      oaiModules: modules.length,
      totalLines: 0,
      declarations: anchors.length,
      sorry: 0,
      axioms: 0,
      mathlibImports: 0,
      pntImports: 0,
      leanImports: 0,
      failedModules: [],
      truncated: false,
    },
    subsystems: [],
    modules: [],
    subsystemEdges: [],
    topLevelModules: modules,
    anchors,
    paperAlignments,
    externalImports: { mathlibCount: 0, mathlibPrefixes: [], pnt: [], lean: [] },
    formalizedVersionId: deep.leanAlignments[0]?.strategyId ?? "",
    caveats: deep.caveats,
  };
}

export function adaptDeepProofMap(deep: DeepProofMapData, revision: string, subject: string): AdaptedDeepProofMap {
  const proof: ProofEvolutionData = {
    schemaVersion: PROOF_EVOLUTION_SCHEMA_VERSION,
    status: "draft",
    reviewStatus: "unreviewed",
    curatedAt: deep.curatedAt,
    theorem: {
      id: deep.result.id,
      title: deep.title,
      statement: deep.result.statement,
      scopeNote: deep.result.detail ?? "The linked paper remains authoritative.",
      sourceNote: deep.result.source,
    },
    tracks: [{
      id: "deep",
      label: "Deep argument map",
      description: "A curated theorem-level strategy map. It is not a kernel check or a Proofweave replay.",
    }],
    versions: deep.strategies.map((strategy) => ({
      id: strategy.id,
      trackId: "deep",
      label: strategy.label,
      title: strategy.title,
      authors: strategy.authors,
      date: strategy.date,
      pages: strategy.pages,
      goal: "origin",
      method: strategy.note,
      field: subject,
      explicitConstant: "existential",
      aiAssistance: "Not recorded",
      summary: strategy.note,
      changeSummary: strategy.note,
      lean: leanForStrategy(deep, strategy),
      sourceUrl: strategy.sourceUrl,
      sourceLabel: strategy.sourceLabel,
      proofDetail: strategy.proofDetail,
      layout: { x: 0, y: 0 },
      proofSteps: strategy.nodes.map((node) => ({
        id: node.id,
        label: node.fullLabel,
        kind: node.kind,
        detail: node.detail,
        source: node.source,
        dependsOn: node.dependsOn,
      })),
    })),
    versionEdges: [],
    ledger: { columns: [], rows: [] },
    caveats: deep.caveats,
    sources: deep.sources,
  };

  const argumentMap: ArgumentMapData = {
    schemaVersion: "pw-argument-map-v1",
    status: "draft",
    reviewStatus: "unreviewed",
    result: deep.result,
    roles: deep.roles,
    strategies: deep.strategies.map((strategy) => ({
      versionId: strategy.id,
      color: strategy.color,
      track: "same-theorem",
      note: strategy.note,
    })),
    nodeRoles: Object.fromEntries(deep.strategies.map((strategy) => [
      strategy.id,
      Object.fromEntries(strategy.nodes.map((node) => [node.id, node.role])),
    ])),
    extraNodes: [],
    finalEdges: deep.finalEdges,
    crossEdges: deep.crossEdges,
    comparisons: deep.comparisons,
    sharedInputs: deep.sharedInputs,
    caveats: deep.caveats,
    summaryNote: deep.summaryNote,
  };

  return { proof, argumentMap, lean: buildLeanData(deep, revision) };
}
