"use client";

import { useMemo, useState } from "react";
import { Badge, Surface, cx } from "@/app/components/ui";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import { ArgumentNetworkGraph, type ArgumentNetworkEdge, type ArgumentNetworkNode } from "./ArgumentNetworkGraph";
import {
  type ArgumentMapComparison,
  type ArgumentMapData,
  type ArgumentMapEdge,
  type LeanStructureData,
  type ProofEvolutionData,
  type ProofStepKind,
  type ProofVersion,
} from "@/app/lib/proof-evolution";

const CARD_W = 154;
const CARD_H = 64;
const CARD_GAP = 12;
const HEADER_H = 64;
const LANE_H = 112;

type MapNode = {
  id: string;
  versionId: string | null;
  stepId: string | null;
  role: string;
  label: string;
  fullLabel: string;
  kind: string;
  source: string;
  detail: string;
  color: string;
  isResult: boolean;
  dependencies: string[];
  objectUses?: string[];
  mentions?: string[];
};

type MapEdge = {
  from: string;
  to: string;
  type: ArgumentMapEdge["type"];
  label: string;
  note?: string;
  cross: boolean;
  strategyId: string | null;
};

type StrategyModel = {
  strategy: ArgumentMapData["strategies"][number];
  version: ProofVersion;
  color: string;
  nodes: MapNode[];
  edges: MapEdge[];
  nodeById: Map<string, MapNode>;
  roles: Set<string>;
};

const edgeTypeKeys: Record<ArgumentMapEdge["type"], TranslationKey> = {
  depends: "proofMaps.edgeType.depends",
  object: "proofMaps.edgeType.object",
  mentions: "proofMaps.edgeType.mentions",
  proves: "proofMaps.edgeType.proves",
  implies: "proofMaps.edgeType.implies",
  "same-role": "proofMaps.edgeType.same-role",
  replaces: "proofMaps.edgeType.replaces",
  bypasses: "proofMaps.edgeType.bypasses",
};

const kindKeys: Record<ProofStepKind, TranslationKey> = {
  theorem: "proofMaps.label.kind.theorem",
  lemma: "proofMaps.label.kind.lemma",
  proposition: "proofMaps.label.kind.proposition",
  corollary: "proofMaps.label.kind.corollary",
  construction: "proofMaps.label.kind.construction",
  bound: "proofMaps.label.kind.bound",
  assembly: "proofMaps.label.kind.assembly",
  external: "proofMaps.label.kind.external",
};

type Model = {
  strategies: StrategyModel[];
  strategyById: Map<string, StrategyModel>;
  nodesById: Map<string, MapNode>;
  resultNode: MapNode;
  roles: ArgumentMapData["roles"];
  crossEdges: MapEdge[];
};

function pagesLabel(pages: number) {
  return pages > 0 ? `${pages} pp` : "—";
}

function shortLabel(value: string) {
  const compact = value.replace(/\s*·\s*/g, " · ");
  return compact.length > 26 ? `${compact.slice(0, 24)}…` : compact;
}

function shortNetworkLabel(value: string) {
  const compact = value.replace(/\s*·\s*/g, " · ");
  return compact.length > 15 ? `${compact.slice(0, 13)}…` : compact;
}

function buildModel(data: ProofEvolutionData, argumentMap: ArgumentMapData, t: Translator): Model {
  const versionById = new Map(data.versions.map((version) => [version.id, version]));
  const strategies: StrategyModel[] = argumentMap.strategies.map((strategy) => {
    const version = versionById.get(strategy.versionId);
    if (!version) throw new Error(`Argument map references unknown version ${strategy.versionId}`);
    const roleMap = argumentMap.nodeRoles[strategy.versionId] ?? {};
    const nodes: MapNode[] = version.proofSteps.map((step) => ({
      id: `${strategy.versionId}:${step.id}`,
      versionId: strategy.versionId,
      stepId: step.id,
      role: roleMap[step.id] ?? "assembly",
      label: shortLabel(step.label),
      fullLabel: step.label,
      kind: step.kind,
      source: step.source,
      detail: step.detail,
      color: strategy.color,
      isResult: roleMap[step.id] === "result",
      dependencies: step.dependsOn.map((dependency) => `${strategy.versionId}:${dependency}`),
      ...(step.objectUses && step.objectUses.length > 0 ? { objectUses: step.objectUses.map((object) => `${strategy.versionId}:${object}`) } : {}),
      ...(step.mentions && step.mentions.length > 0 ? { mentions: step.mentions.map((mention) => `${strategy.versionId}:${mention}`) } : {}),
    }));
    for (const extra of argumentMap.extraNodes.filter((node) => node.versionId === strategy.versionId)) {
      nodes.push({
        id: extra.id,
        versionId: strategy.versionId,
        stepId: null,
        role: extra.role,
        label: shortLabel(extra.label),
        fullLabel: extra.label,
        kind: extra.kind,
        source: extra.source,
        detail: extra.statement,
        color: strategy.color,
        isResult: extra.role === "result",
        dependencies: [],
      });
    }
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const edges: MapEdge[] = [];
    for (const step of version.proofSteps) {
      const targetId = `${strategy.versionId}:${step.id}`;
      for (const dependency of step.dependsOn) {
        const sourceId = `${strategy.versionId}:${dependency}`;
        if (nodeById.has(sourceId)) edges.push({ from: sourceId, to: targetId, type: "depends", label: "uses", cross: false, strategyId: strategy.versionId });
      }
      for (const object of step.objectUses ?? []) {
        const sourceId = `${strategy.versionId}:${object}`;
        if (nodeById.has(sourceId)) edges.push({ from: sourceId, to: targetId, type: "object", label: t("proofMaps.argument.edgeObject"), cross: false, strategyId: strategy.versionId });
      }
      for (const mention of step.mentions ?? []) {
        const sourceId = `${strategy.versionId}:${mention}`;
        if (nodeById.has(sourceId)) edges.push({ from: sourceId, to: targetId, type: "mentions", label: t("proofMaps.argument.edgeMentions"), cross: false, strategyId: strategy.versionId });
      }
    }
    for (const edge of argumentMap.finalEdges) {
      if (!nodeById.has(edge.from) && !nodeById.has(edge.to)) continue;
      edges.push({ from: edge.from, to: edge.to, type: edge.type, label: edge.label, note: edge.note, cross: false, strategyId: strategy.versionId });
    }
    return {
      strategy,
      version,
      color: strategy.color,
      nodes,
      edges,
      nodeById,
      roles: new Set(nodes.map((node) => node.role)),
    };
  });

  const nodesById = new Map<string, MapNode>();
  for (const strategy of strategies) for (const node of strategy.nodes) nodesById.set(node.id, node);
  const resultNode: MapNode = {
    id: argumentMap.result.id,
    versionId: null,
    stepId: null,
    role: "result",
    label: t("proofMaps.argument.sharedResultLabel"),
    fullLabel: argumentMap.result.label,
    kind: "theorem",
    source: argumentMap.result.source,
    detail: argumentMap.result.statement,
    color: "#f2d27a",
    isResult: true,
    dependencies: [],
  };
  nodesById.set(resultNode.id, resultNode);

  const crossEdges: MapEdge[] = argumentMap.crossEdges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    type: edge.type,
    label: edge.label,
    note: edge.note,
    cross: true,
    strategyId: nodeStrategy(edge.from, strategies),
  }));
  return {
    strategies,
    strategyById: new Map(strategies.map((strategy) => [strategy.strategy.versionId, strategy])),
    nodesById,
    resultNode,
    roles: argumentMap.roles,
    crossEdges,
  };
}

function nodeStrategy(nodeId: string, strategies: StrategyModel[]) {
  return strategies.find((strategy) => strategy.nodeById.has(nodeId))?.strategy.versionId ?? null;
}

function roleLabel(roles: ArgumentMapData["roles"], roleId: string) {
  return roles.find((role) => role.id === roleId)?.label ?? roleId;
}

export function ArgumentMapView({ data, argumentMap, lean }: { data: ProofEvolutionData; argumentMap: ArgumentMapData; lean: LeanStructureData }) {
  const { t } = useI18n();
  const model = useMemo(() => buildModel(data, argumentMap, t), [data, argumentMap, t]);
  const primary = model.strategies.filter((strategy) => strategy.strategy.track === "same-theorem");
  const stronger = model.strategies.filter((strategy) => strategy.strategy.track === "stronger-theorem");
  const [mode, setMode] = useState<"all" | "compare">("all");
  const [view, setView] = useState<"matrix" | "network">("matrix");
  const [showStronger, setShowStronger] = useState(false);
  const [showCrossLinks, setShowCrossLinks] = useState(true);
  const [compareA, setCompareA] = useState(primary[0]?.strategy.versionId ?? "");
  const [compareB, setCompareB] = useState(primary[4]?.strategy.versionId ?? primary[1]?.strategy.versionId ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedStrategyId, setFocusedStrategyId] = useState<string | null>(null);

  const compareBEffective = compareA === compareB ? (primary.find((strategy) => strategy.strategy.versionId !== compareA)?.strategy.versionId ?? compareB) : compareB;
  const canCompare = primary.length > 1;
  const visibleStrategies = mode === "compare" && canCompare
    ? [model.strategyById.get(compareA), model.strategyById.get(compareBEffective)].filter((strategy): strategy is StrategyModel => Boolean(strategy))
    : [...primary, ...(showStronger ? stronger : [])];
  const visibleIds = new Set(visibleStrategies.map((strategy) => strategy.strategy.versionId));
  const comparison = mode === "compare" && canCompare ? argumentMap.comparisons.find((entry) => {
    const pair = [entry.a, entry.b].sort().join("|");
    return pair === [compareA, compareBEffective].sort().join("|");
  }) : undefined;
  const activeNodeId = hoveredNodeId ?? selectedNodeId;
  const selectedNode = selectedNodeId ? model.nodesById.get(selectedNodeId) ?? null : null;
  const focusedEdges = activeNodeId
    ? [...visibleStrategies.flatMap((strategy) => strategy.edges), ...(showCrossLinks || mode === "compare" ? model.crossEdges : [])].filter((edge) => edge.from === activeNodeId || edge.to === activeNodeId)
    : [];
  const neighborIds = new Set(focusedEdges.flatMap((edge) => [edge.from, edge.to]));
  const canShowCrossLinks = mode === "compare" || showCrossLinks;

  const visibleStrategyKey = visibleStrategies.map((strategy) => strategy.strategy.versionId).join("|");
  const networkGraph = useMemo(() => {
    const nodes: ArgumentNetworkNode[] = [];
    const edges: ArgumentNetworkEdge[] = [];
    const nodeIds = new Set<string>();
    const strategies = visibleStrategyKey
      .split("|")
      .filter(Boolean)
      .map((id) => model.strategyById.get(id))
      .filter((strategy): strategy is StrategyModel => Boolean(strategy));
    for (const strategy of strategies) {
      const resultNode = strategy.nodes.find((node) => node.isResult);
      nodes.push({
        id: `strategy:${strategy.strategy.versionId}`,
        type: "strategy",
        label: strategy.version.label,
        sublabel: pagesLabel(strategy.version.pages),
        color: strategy.color,
        role: "strategy",
        meta: { nodeId: resultNode?.id, strategyId: strategy.strategy.versionId },
      });
      nodeIds.add(`strategy:${strategy.strategy.versionId}`);
      for (const node of strategy.nodes) {
        nodes.push({
          id: node.id,
          type: node.isResult ? "result" : "step",
          label: shortNetworkLabel(node.fullLabel),
          sublabel: node.kind,
          color: node.color,
          role: node.role,
          meta: { nodeId: node.id, strategyId: strategy.strategy.versionId },
        });
        nodeIds.add(node.id);
        edges.push({ source: `strategy:${strategy.strategy.versionId}`, target: node.id, type: "strategy" });
      }
      for (const edge of strategy.edges) {
        edges.push({
          source: edge.from,
          target: edge.to,
          type: edge.type === "object" ? "object" : edge.type === "mentions" ? "mentions" : edge.type === "depends" ? "depends" : edge.type === "proves" || edge.type === "implies" ? "final" : "depends",
          label: edge.label,
        });
      }
    }
    nodes.push({
      id: model.resultNode.id,
      type: "result",
      label: t("proofMaps.argument.sharedResultLabel"),
      sublabel: model.resultNode.fullLabel,
      color: "#f2d27a",
      role: "result",
      meta: { nodeId: model.resultNode.id },
    });
    nodeIds.add(model.resultNode.id);
    if (canShowCrossLinks) {
      for (const edge of model.crossEdges) {
        if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
          edges.push({ source: edge.from, target: edge.to, type: "cross", label: edge.label });
        }
      }
    }
    return { nodes, edges };
  }, [model, visibleStrategyKey, canShowCrossLinks, t]);
  const networkKey = `${visibleStrategyKey}|${canShowCrossLinks}`;

  const roleBlocks = new Map<string, { start: number; width: number }>();
  let cursor = 16;
  for (const role of argumentMap.roles) {
    const maxCount = Math.max(1, ...visibleStrategies.map((strategy) => strategy.nodes.filter((node) => node.role === role.id).length));
    const width = maxCount * (CARD_W + CARD_GAP);
    roleBlocks.set(role.id, { start: cursor, width });
    cursor += width + 16;
  }
  const resultX = cursor + 24;
  const resultWidth = 210;
  const resultY = HEADER_H + 12 + (visibleStrategies.length * LANE_H) / 2 - 44;
  const matrixWidth = resultX + resultWidth + 28;
  const matrixHeight = HEADER_H + 12 + visibleStrategies.length * LANE_H + 20;

  const positions = new Map<string, { x: number; y: number }>();
  for (const [laneIndex, strategy] of visibleStrategies.entries()) {
    const laneTop = HEADER_H + 12 + laneIndex * LANE_H;
    for (const role of argumentMap.roles) {
      const roleNodes = strategy.nodes.filter((node) => node.role === role.id);
      const block = roleBlocks.get(role.id);
      if (!block) continue;
      roleNodes.forEach((node, index) => {
        positions.set(node.id, { x: block.start + index * (CARD_W + CARD_GAP), y: laneTop + 24 });
      });
    }
  }
  positions.set(model.resultNode.id, { x: resultX, y: resultY });

  const allEdges = [
    ...visibleStrategies.flatMap((strategy) => strategy.edges),
    ...(canShowCrossLinks ? model.crossEdges.filter((edge) => {
      const fromStrategy = nodeStrategy(edge.from, model.strategies);
      const toStrategy = nodeStrategy(edge.to, model.strategies);
      return (!fromStrategy || visibleIds.has(fromStrategy)) && (!toStrategy || visibleIds.has(toStrategy));
    }) : []),
  ].filter((edge) => positions.has(edge.from) && positions.has(edge.to));

  const summaryStrategies = visibleStrategies.filter((strategy) => strategy.strategy.track === "same-theorem");
  const shortest = [...(summaryStrategies.length ? summaryStrategies : visibleStrategies)].sort((a, b) => a.version.pages - b.version.pages || a.nodes.length - b.nodes.length)[0];
  const longest = [...(summaryStrategies.length ? summaryStrategies : visibleStrategies)].sort((a, b) => b.version.pages - a.version.pages || b.nodes.length - a.nodes.length)[0];

  return <div className="argument-map">
    <div className="argument-map-toolbar">
      <div className="argument-map-modes" role="group" aria-label={t("proofMaps.argument.modeAria")}>
        <button type="button" className={cx("argument-map-mode", mode === "all" && "is-selected")} aria-pressed={mode === "all"} onClick={() => setMode("all")}>{t("proofMaps.argument.allStrategies")}</button>
        <button type="button" className={cx("argument-map-mode", mode === "compare" && canCompare && "is-selected")} aria-pressed={mode === "compare" && canCompare} onClick={() => setMode("compare")} disabled={!canCompare} title={canCompare ? t("proofMaps.argument.compareTitle") : t("proofMaps.argument.singleStrategyTitle")}>{t("proofMaps.argument.compareTwo")}</button>
      </div>
      <div className="argument-map-modes" role="group" aria-label={t("proofMaps.argument.viewAria")}>
        <button type="button" className={cx("argument-map-mode", view === "matrix" && "is-selected")} aria-pressed={view === "matrix"} onClick={() => setView("matrix")}>{t("proofMaps.argument.matrix")}</button>
        <button type="button" className={cx("argument-map-mode", view === "network" && "is-selected")} aria-pressed={view === "network"} onClick={() => setView("network")}>{t("proofMaps.argument.network")}</button>
      </div>
      {mode === "all" || !canCompare ? <>
        {stronger.length > 0 && <label className="argument-map-toggle"><input type="checkbox" checked={showStronger} onChange={(event) => setShowStronger(event.target.checked)} /> {t("proofMaps.argument.strongerTrack")}</label>}
        {model.crossEdges.length > 0 && <label className="argument-map-toggle"><input type="checkbox" checked={showCrossLinks} onChange={(event) => setShowCrossLinks(event.target.checked)} /> {t("proofMaps.argument.crossLinks")}</label>}
      </> : <>
        <label className="argument-map-select">A<select value={compareA} onChange={(event) => setCompareA(event.target.value)}>{model.strategies.map((strategy) => <option key={strategy.strategy.versionId} value={strategy.strategy.versionId}>{strategy.version.label} · {pagesLabel(strategy.version.pages)}</option>)}</select></label>
        <label className="argument-map-select">B<select value={compareBEffective} onChange={(event) => setCompareB(event.target.value)}>{model.strategies.filter((strategy) => strategy.strategy.versionId !== compareA).map((strategy) => <option key={strategy.strategy.versionId} value={strategy.strategy.versionId}>{strategy.version.label} · {pagesLabel(strategy.version.pages)}</option>)}</select></label>
      </>}
    </div>

    {(mode === "all" || !canCompare) && <div className="argument-map-summary">
      {visibleStrategies.length > 1 ? <>
        <span><Badge tone="positive">{t("proofMaps.argument.shortest")}</Badge> {shortest?.version.label} · {shortest && (shortest.version.pages > 0 ? `${shortest.version.pages} pages` : t("proofMaps.paper.pagesUnknown"))} · {shortest?.nodes.length} nodes</span>
        <span><Badge>{t("proofMaps.argument.longest")}</Badge> {longest?.version.label} · {longest && (longest.version.pages > 0 ? `${longest.version.pages} pages` : t("proofMaps.paper.pagesUnknown"))} · {longest?.nodes.length} nodes</span>
      </> : visibleStrategies[0] ? <span><Badge>{t("proofMaps.argument.strategy")}</Badge> {visibleStrategies[0].version.label} · {visibleStrategies[0].version.pages > 0 ? `${visibleStrategies[0].version.pages} pages` : t("proofMaps.paper.pagesUnknown")} · {visibleStrategies[0].nodes.length} nodes</span> : null}
      <span className="argument-map-summary-note">{argumentMap.summaryNote ?? t("proofMaps.argument.summaryDefault")}</span>
      {showStronger && <span className="argument-map-summary-note">{t("proofMaps.argument.strongerNote")}</span>}
    </div>}

    {view === "matrix" && <div className="argument-map-legend" aria-label={t("proofMaps.argument.legendAria")}>
      <span><i className="is-depends" />{t("proofMaps.argument.legendDepends")}</span>
      <span><i className="is-object" />{t("proofMaps.argument.legendObject")}</span>
      <span><i className="is-mentions" />{t("proofMaps.argument.legendMentions")}</span>
      <span><i className="is-proves" />{t("proofMaps.argument.legendProves")}</span>
      <span><i className="is-same-role" />{t("proofMaps.argument.legendSameRole")}</span>
      <span><i className="is-replaces" />{t("proofMaps.argument.legendReplaces")}</span>
      <span><i className="is-bypasses" />{t("proofMaps.argument.legendBypasses")}</span>
      <span>{t("proofMaps.argument.legendNote")}</span>
    </div>}
    {view === "network" ? <ArgumentNetworkGraph
      nodes={networkGraph.nodes}
      edges={networkGraph.edges}
      graphKey={networkKey}
      roles={argumentMap.roles}
      selectedNodeId={selectedNodeId}
      onSelectNode={setSelectedNodeId}
    /> : <>
      <p className="argument-map-scroll-hint">{argumentMap.scrollHint ?? t("proofMaps.argument.scrollHint")}</p>

    <div className="argument-map-body">
      <div className="argument-map-labels" style={{ paddingTop: HEADER_H + 12 }}>
        {visibleStrategies.map((strategy) => <button
          type="button"
          key={strategy.strategy.versionId}
          className={cx("argument-strategy-label", strategy.strategy.track === "stronger-theorem" && "is-stronger", focusedStrategyId === strategy.strategy.versionId && "is-focused")}
          style={{ height: LANE_H }}
          onClick={() => setFocusedStrategyId((current) => current === strategy.strategy.versionId ? null : strategy.strategy.versionId)}
        >
          <span className="argument-strategy-dot" style={{ background: strategy.color }} aria-hidden="true" />
          <strong>{strategy.version.label}</strong>
          <small>{pagesLabel(strategy.version.pages)} · {strategy.nodes.length} nodes</small>
          <em>{strategy.strategy.track === "stronger-theorem" ? t("proofMaps.evolution.strongerTheorem") : strategy.strategy.note}</em>
        </button>)}
      </div>

      <div className="argument-map-scroll" tabIndex={0} aria-label={t("proofMaps.argument.matrixAria")}>
        <div className="argument-map-canvas" style={{ width: matrixWidth, height: matrixHeight }}>
          {argumentMap.roles.map((role) => {
            const block = roleBlocks.get(role.id);
            return block ? <div className="argument-role-header" key={role.id} style={{ left: block.start, width: block.width, top: 8 }} title={role.description}>
              <span>{role.label}</span>
            </div> : null;
          })}
          <svg className="argument-map-edges" viewBox={`0 0 ${matrixWidth} ${matrixHeight}`} aria-hidden="true">
            <defs>
              <marker id="argument-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#8b96a9" />
              </marker>
            </defs>
            {allEdges.map((edge) => {
              const from = positions.get(edge.from);
              const to = positions.get(edge.to);
              if (!from || !to) return null;
              const incident = !activeNodeId || edge.from === activeNodeId || edge.to === activeNodeId;
              const strategyColor = edge.strategyId ? model.strategyById.get(edge.strategyId)?.color : undefined;
              const highlighted = edge.cross && mode === "compare" && isBetween(edge, compareA, compareBEffective);
              return <path
                key={`${edge.from}-${edge.to}-${edge.type}`}
                d={edgePath(from, to)}
                className={cx("argument-edge", `is-${edge.type}`, edge.cross && "is-cross", highlighted && "is-compared", !incident && activeNodeId && "is-dimmed")}
                style={{ stroke: edge.type === "depends" ? strategyColor : edge.type === "proves" || edge.type === "implies" ? strategyColor : undefined }}
                markerEnd="url(#argument-arrow)"
              >
                <title>{`${t(edgeTypeKeys[edge.type])}: ${edge.label}`}</title>
              </path>;
            })}
          </svg>

          {visibleStrategies.flatMap((strategy) => strategy.nodes.map((node) => {
            const position = positions.get(node.id);
            if (!position) return null;
            const dimmed = (activeNodeId && node.id !== activeNodeId && !neighborIds.has(node.id)) || (focusedStrategyId && visibleIds.has(focusedStrategyId) && focusedStrategyId !== strategy.strategy.versionId);
            return <button
              type="button"
              key={node.id}
              className={cx("argument-node", `role-${node.role}`, node.isResult && "is-result", selectedNodeId === node.id && "is-selected", dimmed && "is-dimmed")}
              style={{ left: position.x, top: position.y, width: CARD_W, height: CARD_H, borderLeftColor: strategy.color }}
              onClick={() => setSelectedNodeId(node.id)}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              title={node.fullLabel}
            >
              <span className="argument-node-top"><span>{kindKeys[node.kind as ProofStepKind] ? t(kindKeys[node.kind as ProofStepKind]) : node.kind}</span></span>
              <strong>{node.label}</strong>
              <small>{node.source}</small>
            </button>;
          }))}

          <button
            type="button"
            className={cx("argument-result-node", selectedNodeId === model.resultNode.id && "is-selected", activeNodeId && !neighborIds.has(model.resultNode.id) && activeNodeId !== model.resultNode.id && "is-dimmed")}
            style={{ left: resultX, top: resultY, width: resultWidth, height: 88 }}
            onClick={() => setSelectedNodeId(model.resultNode.id)}
            onMouseEnter={() => setHoveredNodeId(model.resultNode.id)}
            onMouseLeave={() => setHoveredNodeId(null)}
          >
            <span>{t("proofMaps.argument.sharedResult")}</span>
            <strong>{argumentMap.result.label}</strong>
            <small>{t("proofMaps.argument.converge")}</small>
          </button>
        </div>
      </div>
    </div>
    </>}

    {mode === "compare" && <ComparePanel
      a={model.strategyById.get(compareA)}
      b={model.strategyById.get(compareBEffective)}
      comparison={comparison}
      argumentMap={argumentMap}
      model={model}
      crossLinks={model.crossEdges.filter((edge) => isBetween(edge, compareA, compareBEffective))}
      sharedInputs={argumentMap.sharedInputs}
      t={t}
    />}

    {selectedNode && <NodeDrawer node={selectedNode} argumentMap={argumentMap} model={model} lean={lean} onClose={() => setSelectedNodeId(null)} onSelectNode={setSelectedNodeId} t={t} />}
  </div>;
}

function isBetween(edge: MapEdge, a: string, b: string) {
  const ids = new Set([a, b]);
  const from = edge.from.split(":")[0];
  const to = edge.to.split(":")[0];
  return ids.has(from) && ids.has(to) && from !== to;
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const x1 = from.x + CARD_W;
  const y1 = from.y + CARD_H / 2;
  const x2 = to.x;
  const y2 = to.y + CARD_H / 2;
  if (x2 >= x1) {
    const dx = Math.max(28, (x2 - x1) * 0.42);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }
  const yMid = Math.max(y1, y2) + 34;
  return `M ${x1} ${y1} C ${x1 + 42} ${yMid}, ${x2 - 42} ${yMid}, ${x2} ${y2}`;
}

function ComparePanel({ a, b, comparison, argumentMap, model, crossLinks, sharedInputs, t }: {
  a?: StrategyModel;
  b?: StrategyModel;
  comparison?: ArgumentMapComparison;
  argumentMap: ArgumentMapData;
  model: Model;
  crossLinks: MapEdge[];
  sharedInputs: string[];
  t: Translator;
}) {
  if (!a || !b) return null;
  const sharedRoles = [...a.roles].filter((role) => b.roles.has(role));
  const uniqueA = [...a.roles].filter((role) => !b.roles.has(role));
  const uniqueB = [...b.roles].filter((role) => !a.roles.has(role));
  return <Surface tone="card" className="argument-compare-panel">
    <div className="argument-compare-heading">
      <div><span className="argument-map-eyebrow">{t("proofMaps.argument.compare")}</span><h3>{t("proofMaps.argument.versus", { a: a.version.label, b: b.version.label })}</h3></div>
      <div className="argument-compare-stats">
        <div><span>{a.version.label}</span><strong>{a.nodes.length}</strong><small>{t("proofMaps.argument.statEdges", { count: a.edges.length })}</small></div>
        <div><span>{b.version.label}</span><strong>{b.nodes.length}</strong><small>{t("proofMaps.argument.statEdges", { count: b.edges.length })}</small></div>
      </div>
    </div>
    <div className="argument-compare-roles">
      <div><span>{t("proofMaps.argument.sharedRoles")}</span>{sharedRoles.map((role) => <Badge key={role}>{roleLabel(argumentMap.roles, role)}</Badge>)}</div>
      <div><span>{t("proofMaps.argument.only", { label: a.version.label })}</span>{uniqueA.length ? uniqueA.map((role) => <Badge key={role} tone="warning">{roleLabel(argumentMap.roles, role)}</Badge>) : <small>{t("proofMaps.argument.none")}</small>}</div>
      <div><span>{t("proofMaps.argument.only", { label: b.version.label })}</span>{uniqueB.length ? uniqueB.map((role) => <Badge key={role} tone="warning">{roleLabel(argumentMap.roles, role)}</Badge>) : <small>{t("proofMaps.argument.none")}</small>}</div>
    </div>
    {comparison ? <p className="argument-compare-summary">{comparison.summary}</p> : <p className="argument-compare-summary">{t("proofMaps.argument.noSummary")}</p>}
    <div className="argument-compare-links">
      <span>{t("proofMaps.argument.directCrossLinks")}</span>
      {crossLinks.length === 0 ? <p>{t("proofMaps.argument.noCrossLink")}</p> : <ul>{crossLinks.map((edge) => <li key={`${edge.from}-${edge.to}-${edge.type}`}>
        <Badge tone={edge.type === "bypasses" ? "warning" : "neutral"}>{t(edgeTypeKeys[edge.type])}</Badge>
        <span>{model.nodesById.get(edge.from)?.label} → {model.nodesById.get(edge.to)?.label}</span>
        <small>{edge.note ?? edge.label}</small>
      </li>)}</ul>}
    </div>
    {a.strategy.track !== "same-theorem" || b.strategy.track !== "same-theorem" ? <p className="argument-compare-note">{t("proofMaps.argument.strongerCompareNote")}</p> : null}
    <details className="argument-shared-inputs"><summary>{t("proofMaps.argument.whatRoutesShare")}</summary><ul>{sharedInputs.map((input) => <li key={input}>{input}</li>)}</ul></details>
  </Surface>;
}

function moduleShort(id: string) {
  return id.split(".").slice(-2).join(".");
}

function pathToResult(node: MapNode, model: Model, strategy?: StrategyModel) {
  if (node.id === model.resultNode.id) return [model.resultNode];
  const edges = strategy?.edges ?? [];
  const parent = new Map<string, string | null>([[node.id, null]]);
  const queue = [node.id];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current === model.resultNode.id) break;
    for (const edge of edges.filter((candidate) => candidate.from === current)) {
      if (!parent.has(edge.to)) {
        parent.set(edge.to, current);
        queue.push(edge.to);
      }
    }
  }
  if (!parent.has(model.resultNode.id)) return [];
  const path: MapNode[] = [];
  let current: string | null = model.resultNode.id;
  while (current) {
    const item = model.nodesById.get(current);
    if (item) path.unshift(item);
    current = parent.get(current) ?? null;
  }
  return path;
}

function NodeDrawer({ node, argumentMap, model, lean, onClose, onSelectNode, t }: {
  node: MapNode;
  argumentMap: ArgumentMapData;
  model: Model;
  lean: LeanStructureData;
  onClose: () => void;
  onSelectNode: (id: string) => void;
  t: Translator;
}) {
  const strategy = node.versionId ? model.strategyById.get(node.versionId) : undefined;
  const role = argumentMap.roles.find((candidate) => candidate.id === node.role);
  const isSharedResult = node.id === argumentMap.result.id;
  const baseEdges = node.isResult ? model.strategies.flatMap((entry) => entry.edges) : strategy?.edges ?? [];
  const dependencies = node.dependencies.map((id) => model.nodesById.get(id)).filter((entry): entry is MapNode => Boolean(entry));
  const usedBy = baseEdges.filter((edge) => edge.from === node.id);
  const objects = (node.objectUses ?? []).map((id) => model.nodesById.get(id)).filter((entry): entry is MapNode => Boolean(entry));
  const mentions = (node.mentions ?? []).map((id) => model.nodesById.get(id)).filter((entry): entry is MapNode => Boolean(entry));
  const crossRelations = model.crossEdges.filter((edge) => edge.from === node.id || edge.to === node.id);
  const path = pathToResult(node, model, strategy);
  const alignment = node.versionId && node.stepId ? lean.paperAlignments.find((candidate) => candidate.versionId === node.versionId && candidate.stepId === node.stepId) : undefined;
  const anchors = alignment ? alignment.anchors.map((id) => lean.anchors.find((anchor) => anchor.id === id)).filter((anchor): anchor is NonNullable<typeof anchor> => Boolean(anchor)) : [];
  const converging = isSharedResult ? model.strategies.flatMap((entry) => entry.edges.filter((edge) => edge.to === node.id).map((edge) => ({ strategy: entry, edge }))) : [];

  return <Surface as="aside" tone="card" className="argument-detail-drawer" aria-label={t("proofMaps.argument.drawerAria", { label: node.fullLabel })}>
    <header className="argument-drawer-header">
      <div>
        <span className="argument-map-eyebrow">{isSharedResult ? t("proofMaps.argument.sharedResultLabel") : `${role?.label ?? node.role} · ${strategy?.version.label ?? t("proofMaps.argument.external")}`}</span>
        <h3>{node.fullLabel}</h3>
        <div className="argument-drawer-badges">
          <Badge>{kindKeys[node.kind as ProofStepKind] ? t(kindKeys[node.kind as ProofStepKind]) : node.kind}</Badge>
          {strategy && strategy.version.pages > 0 && <Badge>{t("proofMaps.evolution.pagesBadge", { count: strategy.version.pages })}</Badge>}
          {isSharedResult && <Badge tone="positive">{t("proofMaps.argument.allConverge")}</Badge>}
        </div>
      </div>
      <button type="button" className="argument-drawer-close" onClick={onClose} aria-label={t("proofMaps.argument.closeDrawer")}>×</button>
    </header>

    <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.proofDetail")}</span>
      <p>{node.detail}</p>
    </section>

    <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.roleInArgument")}</span>
      <p>{isSharedResult ? argumentMap.result.roleNote ?? t("proofMaps.argument.sharedResultNote") : role?.description ?? t("proofMaps.argument.noRole")}</p>
      {strategy && <p className="argument-drawer-note">{strategy.strategy.note}</p>}
    </section>

    {!isSharedResult && path.length > 0 && <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.pathToResult")}</span>
      <div className="argument-drawer-path">
        {path.map((entry, index) => <span key={entry.id}>
          <button type="button" className={cx(entry.id === node.id && "is-current")} onClick={() => onSelectNode(entry.id)}>{entry.label}</button>
          {index < path.length - 1 && <i aria-hidden="true">→</i>}
        </span>)}
      </div>
    </section>}

    <div className="argument-drawer-columns">
      <section className="argument-drawer-section">
        <span>{t("proofMaps.argument.dependsOn")}</span>
        {dependencies.length > 0 ? <div className="argument-drawer-links">{dependencies.map((entry) => <button type="button" key={entry.id} onClick={() => onSelectNode(entry.id)}>{entry.label}</button>)}</div> : <p>{t("proofMaps.argument.noDependency")}</p>}
      </section>
      <section className="argument-drawer-section">
        <span>{t("proofMaps.argument.usedBy")}</span>
        {usedBy.length > 0 ? <div className="argument-drawer-links">{usedBy.map((edge) => {
          const target = model.nodesById.get(edge.to);
          return target ? <button type="button" key={`${edge.from}-${edge.to}-${edge.type}`} onClick={() => onSelectNode(target.id)}>{target.label}</button> : null;
        })}</div> : <p>{t("proofMaps.argument.noDownstream")}</p>}
      </section>
    </div>

    {objects.length > 0 && <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.drawerObjects")}</span>
      <div className="argument-drawer-links">{objects.map((entry) => <button type="button" key={entry.id} onClick={() => onSelectNode(entry.id)}>{entry.label}</button>)}</div>
    </section>}

    {mentions.length > 0 && <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.drawerMentions")}</span>
      <div className="argument-drawer-links">{mentions.map((entry) => <button type="button" key={entry.id} onClick={() => onSelectNode(entry.id)}>{entry.label}</button>)}</div>
    </section>}

    <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.crossRelations")}</span>
      {crossRelations.length > 0 ? <ul className="argument-drawer-relations">{crossRelations.map((edge) => {
        const otherId = edge.from === node.id ? edge.to : edge.from;
        const other = model.nodesById.get(otherId);
        return other ? <li key={`${edge.from}-${edge.to}-${edge.type}`}>
          <Badge tone={edge.type === "bypasses" ? "warning" : edge.type === "replaces" ? "warning" : "neutral"}>{t(edgeTypeKeys[edge.type])}</Badge>
          <span>{edge.from === node.id ? "→" : "←"}</span>
          <button type="button" onClick={() => onSelectNode(other.id)}>{other.label}</button>
          <small>{edge.note ?? edge.label}</small>
        </li> : null;
      })}</ul> : <p>{t("proofMaps.argument.noCrossRelation")}</p>}
    </section>

    {argumentMap.result.detail && isSharedResult && <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.resultBoundary")}</span>
      <p>{argumentMap.result.detail}</p>
    </section>}

    {isSharedResult && <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.converging")}</span>
      <ul className="argument-drawer-relations">{converging.map(({ strategy: source, edge }) => <li key={`${source.strategy.versionId}-${edge.from}`}>
        <Badge tone={source.strategy.track === "stronger-theorem" ? "neutral" : "positive"}>{source.version.label}</Badge>
        <button type="button" onClick={() => onSelectNode(edge.from)}>{model.nodesById.get(edge.from)?.label ?? edge.from}</button>
        <small>{edge.type} · {edge.label}</small>
      </li>)}</ul>
    </section>}

    <section className="argument-drawer-section">
      <span>{t("proofMaps.argument.leanAlignment")}</span>
      {alignment ? <div className="argument-drawer-lean">
        <div className="argument-drawer-badges">
          <Badge tone={alignment.confidence === "source-anchored" ? "positive" : "warning"}>{alignment.confidence}</Badge>
          {alignment.subsystems.map((id) => <Badge key={id}>{id}</Badge>)}
        </div>
        {anchors.length > 0 ? <ul>{anchors.map((anchor) => <li key={anchor.id}>
          <a href={anchor.url ?? "#"} target="_blank" rel="noreferrer">{anchor.role} ↗</a>
          <code>{anchor.fullName}</code>
          <small>{anchor.module ? `${moduleShort(anchor.module)}${anchor.line !== null ? `:${anchor.line}` : ""}` : t("proofMaps.argument.moduleNotLocated")}</small>
        </li>)}</ul> : <p>{t("proofMaps.argument.noAnchor")}</p>}
        <p className="argument-drawer-note">{alignment.note}</p>
      </div> : <p>{lean.noAlignmentNote ?? t("proofMaps.argument.noAlignment")}</p>}
    </section>

    <section className="argument-drawer-section argument-drawer-source">
      <span>{t("proofMaps.argument.source")}</span>
      <p>{node.source}</p>
      {strategy && <a href={strategy.version.sourceUrl} target="_blank" rel="noreferrer">{t("proofMaps.argument.openSource", { label: strategy.version.sourceLabel })}</a>}
      <small>{t("proofMaps.argument.sourceNote")}</small>
    </section>
  </Surface>;
}
