"use client";

import { useMemo, useState } from "react";
import { Badge, Surface, cx } from "@/app/components/ui";
import {
  type ArgumentMapComparison,
  type ArgumentMapData,
  type ArgumentMapEdge,
  type ProofEvolutionData,
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

type Model = {
  strategies: StrategyModel[];
  strategyById: Map<string, StrategyModel>;
  nodesById: Map<string, MapNode>;
  resultNode: MapNode;
  roles: ArgumentMapData["roles"];
  crossEdges: MapEdge[];
};

function shortLabel(value: string) {
  const compact = value.replace(/\s*·\s*/g, " · ");
  return compact.length > 26 ? `${compact.slice(0, 24)}…` : compact;
}

function buildModel(data: ProofEvolutionData, argumentMap: ArgumentMapData): Model {
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
    label: "Shared result",
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

export function ArgumentMapView({ data, argumentMap }: { data: ProofEvolutionData; argumentMap: ArgumentMapData }) {
  const model = useMemo(() => buildModel(data, argumentMap), [data, argumentMap]);
  const primary = model.strategies.filter((strategy) => strategy.strategy.track === "same-theorem");
  const stronger = model.strategies.filter((strategy) => strategy.strategy.track === "stronger-theorem");
  const [mode, setMode] = useState<"all" | "compare">("all");
  const [showStronger, setShowStronger] = useState(false);
  const [showCrossLinks, setShowCrossLinks] = useState(true);
  const [compareA, setCompareA] = useState(primary[0]?.strategy.versionId ?? "");
  const [compareB, setCompareB] = useState(primary[4]?.strategy.versionId ?? primary[1]?.strategy.versionId ?? "");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedStrategyId, setFocusedStrategyId] = useState<string | null>(null);

  const compareBEffective = compareA === compareB ? (primary.find((strategy) => strategy.strategy.versionId !== compareA)?.strategy.versionId ?? compareB) : compareB;
  const visibleStrategies = mode === "compare"
    ? [model.strategyById.get(compareA), model.strategyById.get(compareBEffective)].filter((strategy): strategy is StrategyModel => Boolean(strategy))
    : [...primary, ...(showStronger ? stronger : [])];
  const visibleIds = new Set(visibleStrategies.map((strategy) => strategy.strategy.versionId));
  const comparison = mode === "compare" ? argumentMap.comparisons.find((entry) => {
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
      <div className="argument-map-modes" role="group" aria-label="Argument map mode">
        <button type="button" className={cx("argument-map-mode", mode === "all" && "is-selected")} aria-pressed={mode === "all"} onClick={() => setMode("all")}>All strategies</button>
        <button type="button" className={cx("argument-map-mode", mode === "compare" && "is-selected")} aria-pressed={mode === "compare"} onClick={() => setMode("compare")}>Compare two</button>
      </div>
      {mode === "all" ? <>
        <label className="argument-map-toggle"><input type="checkbox" checked={showStronger} onChange={(event) => setShowStronger(event.target.checked)} /> Stronger theorem track</label>
        <label className="argument-map-toggle"><input type="checkbox" checked={showCrossLinks} onChange={(event) => setShowCrossLinks(event.target.checked)} /> Cross-links</label>
      </> : <>
        <label className="argument-map-select">A<select value={compareA} onChange={(event) => setCompareA(event.target.value)}>{model.strategies.map((strategy) => <option key={strategy.strategy.versionId} value={strategy.strategy.versionId}>{strategy.version.label} · {strategy.version.pages} pp</option>)}</select></label>
        <label className="argument-map-select">B<select value={compareBEffective} onChange={(event) => setCompareB(event.target.value)}>{model.strategies.filter((strategy) => strategy.strategy.versionId !== compareA).map((strategy) => <option key={strategy.strategy.versionId} value={strategy.strategy.versionId}>{strategy.version.label} · {strategy.version.pages} pp</option>)}</select></label>
      </>}
    </div>

    {mode === "all" && <div className="argument-map-summary">
      <span><Badge tone="positive">Shortest</Badge> {shortest?.version.label} · {shortest?.version.pages} pages · {shortest?.nodes.length} nodes</span>
      <span><Badge>Longest</Badge> {longest?.version.label} · {longest?.version.pages} pages · {longest?.nodes.length} nodes</span>
      <span className="argument-map-summary-note">The shortest path is not a compressed long path: it replaces the interpolation/determinant machinery. Cross-links show what each route shares, replaces, or bypasses.</span>
      {showStronger && <span className="argument-map-summary-note">The stronger-theorem lanes are different theorems. Their arrows to the shared result are implications, not alternative proofs of the same statement.</span>}
    </div>}

    <div className="argument-map-legend" aria-label="Argument edge legend">
      <span><i className="is-depends" />Proof dependency</span>
      <span><i className="is-proves" />Proves / implies</span>
      <span><i className="is-same-role" />Same mathematical role</span>
      <span><i className="is-replaces" />Replaces</span>
      <span><i className="is-bypasses" />Bypasses</span>
      <span>same-role is not a logical dependency</span>
    </div>
    <p className="argument-map-scroll-hint">Scroll horizontally to follow the chain: input → row existence → determinant → p-adic → bounds → assembly → result.</p>

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
          <small>{strategy.version.pages} pp · {strategy.nodes.length} nodes</small>
          <em>{strategy.strategy.track === "stronger-theorem" ? "Stronger theorem" : strategy.strategy.note}</em>
        </button>)}
      </div>

      <div className="argument-map-scroll" tabIndex={0} aria-label="Argument map matrix; scroll horizontally to see all roles">
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
                <title>{`${edge.type}: ${edge.label}`}</title>
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
              <span className="argument-node-top"><span>{node.kind}</span></span>
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
            <span>shared result</span>
            <strong>{argumentMap.result.label}</strong>
            <small>all visible strategies converge here</small>
          </button>
        </div>
      </div>
    </div>

    {mode === "compare" && <ComparePanel
      a={model.strategyById.get(compareA)}
      b={model.strategyById.get(compareBEffective)}
      comparison={comparison}
      argumentMap={argumentMap}
      model={model}
      crossLinks={model.crossEdges.filter((edge) => isBetween(edge, compareA, compareBEffective))}
      sharedInputs={argumentMap.sharedInputs}
    />}

    {selectedNode && <NodeDetail node={selectedNode} argumentMap={argumentMap} model={model} onClose={() => setSelectedNodeId(null)} />}
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

function ComparePanel({ a, b, comparison, argumentMap, model, crossLinks, sharedInputs }: {
  a?: StrategyModel;
  b?: StrategyModel;
  comparison?: ArgumentMapComparison;
  argumentMap: ArgumentMapData;
  model: Model;
  crossLinks: MapEdge[];
  sharedInputs: string[];
}) {
  if (!a || !b) return null;
  const sharedRoles = [...a.roles].filter((role) => b.roles.has(role));
  const uniqueA = [...a.roles].filter((role) => !b.roles.has(role));
  const uniqueB = [...b.roles].filter((role) => !a.roles.has(role));
  return <Surface tone="card" className="argument-compare-panel">
    <div className="argument-compare-heading">
      <div><span className="argument-map-eyebrow">Compare</span><h3>{a.version.label} vs {b.version.label}</h3></div>
      <div className="argument-compare-stats">
        <div><span>{a.version.label}</span><strong>{a.nodes.length}</strong><small>nodes · {a.edges.length} edges</small></div>
        <div><span>{b.version.label}</span><strong>{b.nodes.length}</strong><small>nodes · {b.edges.length} edges</small></div>
      </div>
    </div>
    <div className="argument-compare-roles">
      <div><span>Shared roles</span>{sharedRoles.map((role) => <Badge key={role}>{roleLabel(argumentMap.roles, role)}</Badge>)}</div>
      <div><span>Only {a.version.label}</span>{uniqueA.length ? uniqueA.map((role) => <Badge key={role} tone="warning">{roleLabel(argumentMap.roles, role)}</Badge>) : <small>none</small>}</div>
      <div><span>Only {b.version.label}</span>{uniqueB.length ? uniqueB.map((role) => <Badge key={role} tone="warning">{roleLabel(argumentMap.roles, role)}</Badge>) : <small>none</small>}</div>
    </div>
    {comparison ? <p className="argument-compare-summary">{comparison.summary}</p> : <p className="argument-compare-summary">No curated summary for this pair yet. The graph still shows the shared roles and any direct cross-links.</p>}
    <div className="argument-compare-links">
      <span>Direct cross-links</span>
      {crossLinks.length === 0 ? <p>No direct cross-link; the two routes meet only at the shared result.</p> : <ul>{crossLinks.map((edge) => <li key={`${edge.from}-${edge.to}-${edge.type}`}>
        <Badge tone={edge.type === "bypasses" ? "warning" : "neutral"}>{edge.type}</Badge>
        <span>{model.nodesById.get(edge.from)?.label} → {model.nodesById.get(edge.to)?.label}</span>
        <small>{edge.note ?? edge.label}</small>
      </li>)}</ul>}
    </div>
    {a.strategy.track !== "same-theorem" || b.strategy.track !== "same-theorem" ? <p className="argument-compare-note">One side is a stronger theorem. Its edge to the shared result is an implication, not an alternative proof of the same statement.</p> : null}
    <details className="argument-shared-inputs"><summary>What all routes share</summary><ul>{sharedInputs.map((input) => <li key={input}>{input}</li>)}</ul></details>
  </Surface>;
}

function NodeDetail({ node, argumentMap, model, onClose }: { node: MapNode; argumentMap: ArgumentMapData; model: Model; onClose: () => void }) {
  const strategy = node.versionId ? model.strategyById.get(node.versionId) : undefined;
  const baseEdges = node.isResult ? model.strategies.flatMap((entry) => entry.edges) : strategy?.edges ?? [];
  const incoming = [...baseEdges, ...model.crossEdges].filter((edge) => edge.to === node.id);
  const outgoing = [...baseEdges, ...model.crossEdges].filter((edge) => edge.from === node.id);
  return <Surface tone="card" className="argument-node-detail">
    <div className="argument-node-detail-heading">
      <div>
        <span className="argument-map-eyebrow">{node.isResult ? "Shared result" : `${roleLabel(argumentMap.roles, node.role)} · ${strategy?.version.label ?? "external"}`}</span>
        <h3>{node.fullLabel}</h3>
      </div>
      <button type="button" onClick={onClose} aria-label="Close node detail">×</button>
    </div>
    <p>{node.detail}</p>
    <div className="argument-node-detail-meta">
      <span>Source: {node.source}</span>
      {strategy && <a href={strategy.version.sourceUrl} target="_blank" rel="noreferrer">Open paper ↗</a>}
    </div>
    <div className="argument-node-relations">
      <div><span>Depends on</span>{node.dependencies.length ? node.dependencies.map((id) => <code key={id}>{model.nodesById.get(id)?.label ?? id}</code>) : <small>no internal dependency</small>}</div>
      <div><span>Incoming links</span>{incoming.length ? incoming.map((edge) => <small key={`${edge.from}-${edge.to}-${edge.type}`}>{edge.type}: {model.nodesById.get(edge.from)?.label ?? edge.from}</small>) : <small>none</small>}</div>
      <div><span>Outgoing links</span>{outgoing.length ? outgoing.map((edge) => <small key={`${edge.from}-${edge.to}-${edge.type}`}>{edge.type}: {model.nodesById.get(edge.to)?.label ?? edge.to}</small>) : <small>none</small>}</div>
    </div>
  </Surface>;
}
