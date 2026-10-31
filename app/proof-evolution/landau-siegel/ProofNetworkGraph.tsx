"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Surface } from "@/app/components/ui";
import {
  type LeanStructureData,
  type ProofEvolutionData,
  type ProofVersion,
} from "@/app/lib/proof-evolution";

type NetworkNodeType = "version" | "step" | "subsystem" | "anchor" | "module" | "entry" | "external";
type NetworkEdgeType = "version" | "chain" | "step-dep" | "align-source" | "align-inferred" | "import" | "anchor-subsystem" | "anchor-step" | "module" | "entry" | "external";

type NetworkNode = {
  id: string;
  type: NetworkNodeType;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: string;
  meta: { versionId?: string; stepId?: string; subsystemId?: string; anchorId?: string; moduleId?: string };
};

type NetworkEdge = {
  source: string;
  target: string;
  type: NetworkEdgeType;
  label?: string;
  rest: number;
  strength: number;
};

type NetworkGraph = { nodes: NetworkNode[]; edges: NetworkEdge[] };

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 620;
const PRIMARY_VERSION_IDS = ["openai-2026-10-01", "banks-2026-10-11", "kerr-2026-10-15", "green-2026-10-17", "barreto-2026-10-19"];
const COLORS: Record<NetworkNodeType, string> = {
  version: "#e8b35a",
  step: "#8aa0ff",
  subsystem: "#7fc9a0",
  anchor: "#e48a7c",
  module: "#9db4d6",
  entry: "#f0d9a0",
  external: "#7d8ba3",
};

const STEP_LABELS: Record<string, string> = {
  "theorem-1": "Theorem 1",
  "prime-bias": "Prime bias",
  interpolation: "Interpolation",
  "spanning-rows": "Spanning rows",
  "weighted-determinant": "Determinant",
  archimedean: "Archimedean",
  "prime-divisibility": "p-divisibility",
  assembly: "Assembly",
  "theorem-1-1": "Explicit gap",
  "interpolation-chain": "Interpolation",
  greedy: "Greedy",
  "pivot-bounds": "Pivot bounds",
  frobenius: "Frobenius",
  "prime-powers": "Prime powers",
  "lower-bound": "Lower bound",
  masser: "Masser",
  pigeonhole: "Pigeonhole",
  vanishing: "Vanishing mod p",
  "analytic-input": "Prime bias",
  "polynomial-basis": "Basis",
  count: "Counting",
  "nonsingular": "Row independence",
  padic: "p-adic",
  compare: "Comparison",
  wronskian: "Wronskian",
  divisibility: "Divisibility",
  size: "Size bound",
  "corollary-2": "Corollary 2",
  "corollary-1": "Corollary 1",
  "nonvanishing": "Nonvanishing",
  "coefficient-count": "Coefficient count",
  congruences: "Congruences",
  hyperbola: "Hyperbola",
  comparison: "Comparison",
};

function shortStep(step: { id: string; label: string }) {
  if (STEP_LABELS[step.id]) return STEP_LABELS[step.id];
  const compact = step.label.replace(/\s*·\s*/g, " · ");
  return compact.length > 24 ? `${compact.slice(0, 22)}…` : compact;
}

function shortModule(id: string) {
  return id.replace(/^OAI\.NumberTheory\.SiegelZeros\./, "").replace(/^OAI\.NumberTheory\./, "");
}

function clusterPosition(type: NetworkNodeType, index: number, count: number) {
  const config: Record<NetworkNodeType, { cx: number; cy: number; rx: number; ry: number; phase: number }> = {
    version: { cx: 265, cy: 145, rx: 150, ry: 48, phase: -Math.PI / 2 },
    step: { cx: 250, cy: 365, rx: 150, ry: 145, phase: Math.PI },
    subsystem: { cx: 730, cy: 320, rx: 150, ry: 165, phase: 0 },
    anchor: { cx: 500, cy: 535, rx: 220, ry: 55, phase: Math.PI },
    module: { cx: 500, cy: 320, rx: 310, ry: 245, phase: 0 },
    entry: { cx: 500, cy: 42, rx: 0, ry: 0, phase: 0 },
    external: { cx: 900, cy: 540, rx: 50, ry: 38, phase: Math.PI / 2 },
  };
  const c = config[type];
  const angle = c.phase + (index / Math.max(1, count)) * Math.PI * 2;
  return { x: c.cx + Math.cos(angle) * c.rx, y: c.cy + Math.sin(angle) * c.ry };
}

function buildGraph(data: ProofEvolutionData, lean: LeanStructureData, selectedVersion: ProofVersion, options: {
  showSteps: boolean;
  showAnchors: boolean;
  showModules: boolean;
  showExternal: boolean;
}): NetworkGraph {
  const nodes: NetworkNode[] = [];
  const edges: NetworkEdge[] = [];
  const nodeIds = new Set<string>();
  const edgeKeys = new Set<string>();
  const versionById = new Map(data.versions.map((version) => [version.id, version]));
  const moduleById = new Map(lean.modules.map((module) => [module.id, module]));
  const subsystemIds = new Set(lean.subsystems.map((subsystem) => subsystem.id));

  const addNode = (node: Omit<NetworkNode, "x" | "y" | "vx" | "vy">) => {
    if (nodeIds.has(node.id)) return;
    const sameType = nodes.filter((candidate) => candidate.type === node.type).length;
    const position = clusterPosition(node.type, sameType, Math.max(1, node.type === "version" ? PRIMARY_VERSION_IDS.length : node.type === "step" ? selectedVersion.proofSteps.length : node.type === "subsystem" ? lean.subsystems.length - 2 : node.type === "anchor" ? lean.anchors.length : lean.topLevelModules.length));
    nodes.push({ ...node, ...position, vx: 0, vy: 0 });
    nodeIds.add(node.id);
  };
  const addEdge = (source: string, target: string, type: NetworkEdgeType, rest: number, strength: number, label?: string) => {
    if (!nodeIds.has(source) || !nodeIds.has(target)) return;
    const key = `${source}|${target}|${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target, type, rest, strength, label });
  };

  const versionNodes = PRIMARY_VERSION_IDS
    .map((id) => versionById.get(id))
    .filter((version): version is ProofVersion => Boolean(version));
  if (!versionNodes.some((version) => version.id === selectedVersion.id)) versionNodes.push(selectedVersion);
  for (const version of versionNodes) {
    addNode({
      id: `version:${version.id}`,
      type: "version",
      label: version.label,
      sublabel: `${version.pages} pp`,
      r: 14,
      color: COLORS.version,
      meta: { versionId: version.id },
    });
  }
  for (const edge of data.versionEdges) {
    if (edge.visible === false) continue;
    addEdge(`version:${edge.from}`, `version:${edge.to}`, "version", 110, 0.75, edge.relation);
  }

  const selectedVersionNode = `version:${selectedVersion.id}`;
  if (options.showSteps) {
    for (const step of selectedVersion.proofSteps) {
      addNode({
        id: `step:${step.id}`,
        type: "step",
        label: shortStep(step),
        sublabel: step.kind,
        r: 7,
        color: COLORS.step,
        meta: { stepId: step.id, versionId: selectedVersion.id },
      });
    }
    for (const step of selectedVersion.proofSteps) {
      addEdge(selectedVersionNode, `step:${step.id}`, "chain", 105, 0.65);
      for (const dependency of step.dependsOn) {
        addEdge(`step:${dependency}`, `step:${step.id}`, "step-dep", 78, 0.4);
      }
    }
  }

  for (const subsystem of lean.subsystems) {
    if (subsystem.id === "Main" || subsystem.id === "Model") continue;
    addNode({
      id: `subsystem:${subsystem.id}`,
      type: "subsystem",
      label: subsystem.label,
      sublabel: `${subsystem.moduleCount} mod`,
      r: 11,
      color: COLORS.subsystem,
      meta: { subsystemId: subsystem.id },
    });
  }
  const importEdges = [...lean.subsystemEdges]
    .filter((edge) => edge.from !== edge.to && subsystemIds.has(edge.from) && subsystemIds.has(edge.to) && edge.from !== "Main" && edge.to !== "Main" && edge.from !== "Model" && edge.to !== "Model")
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
  for (const edge of importEdges) {
    addEdge(`subsystem:${edge.from}`, `subsystem:${edge.to}`, "import", 125, 0.18, `${edge.count}`);
  }

  if (options.showAnchors) {
    for (const anchor of lean.anchors) {
      addNode({
        id: `anchor:${anchor.id}`,
        type: "anchor",
        label: anchor.role,
        sublabel: anchor.declaration,
        r: 6,
        color: COLORS.anchor,
        meta: { anchorId: anchor.id, stepId: anchor.paperStepId },
      });
      if (anchor.module) {
        const moduleInfo = moduleById.get(anchor.module);
        if (moduleInfo) addEdge(`anchor:${anchor.id}`, `subsystem:${moduleInfo.subsystem}`, "anchor-subsystem", 75, 0.35);
      }
      if (selectedVersion.id === lean.formalizedVersionId) {
        addEdge(`anchor:${anchor.id}`, `step:${anchor.paperStepId}`, "anchor-step", 68, 0.25);
      }
    }
  }

  if (selectedVersion.id === lean.formalizedVersionId) {
    for (const alignment of lean.paperAlignments) {
      const primary = alignment.subsystems.find((id) => subsystemIds.has(id));
      if (!primary) continue;
      addEdge(`step:${alignment.stepId}`, `subsystem:${primary}`, alignment.confidence === "source-anchored" ? "align-source" : "align-inferred", 112, 0.3, alignment.confidence);
    }
  }

  if (options.showModules) {
    addNode({
      id: "entry:main",
      type: "entry",
      label: "Main.lean",
      sublabel: `${lean.topLevelModules.length} imports`,
      r: 12,
      color: COLORS.entry,
      meta: {},
    });
    for (const id of lean.topLevelModules) {
      const moduleInfo = moduleById.get(id);
      if (!moduleInfo) continue;
      addNode({
        id: `module:${id}`,
        type: "module",
        label: shortModule(id),
        sublabel: `${moduleInfo.lines} lines`,
        r: 4.5,
        color: COLORS.module,
        meta: { moduleId: id, subsystemId: moduleInfo.subsystem },
      });
      addEdge("entry:main", `module:${id}`, "entry", 62, 0.5);
      addEdge(`module:${id}`, `subsystem:${moduleInfo.subsystem}`, "module", 60, 0.38);
    }
  }

  if (options.showExternal) {
    addNode({
      id: "external:mathlib",
      type: "external",
      label: "Mathlib",
      sublabel: `${lean.externalImports.mathlibCount} imports`,
      r: 9,
      color: COLORS.external,
      meta: {},
    });
    addNode({
      id: "external:pnt",
      type: "external",
      label: "PNT",
      sublabel: "1 import · not fetched",
      r: 6,
      color: COLORS.external,
      meta: {},
    });
    const externalBySubsystem = new Map<string, number>();
    for (const moduleInfo of lean.modules) {
      externalBySubsystem.set(moduleInfo.subsystem, (externalBySubsystem.get(moduleInfo.subsystem) ?? 0) + moduleInfo.importsExternal);
    }
    const topExternal = [...externalBySubsystem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    for (const [subsystem, count] of topExternal) addEdge("external:mathlib", `subsystem:${subsystem}`, "external", 120, 0.08, `${count}`);
    addEdge("external:pnt", "subsystem:Characters", "external", 100, 0.1);
    addEdge("external:pnt", "subsystem:EntireFunctions", "external", 100, 0.1);
  }

  return { nodes, edges };
}

export function ProofNetworkGraph({ data, lean, selectedVersion, selectedStepId, selectedSubsystemId, onSelectVersion, onSelectStep, onSelectSubsystem }: {
  data: ProofEvolutionData;
  lean: LeanStructureData;
  selectedVersion: ProofVersion;
  selectedStepId?: string;
  selectedSubsystemId?: string;
  onSelectVersion: (id: string) => void;
  onSelectStep: (id: string) => void;
  onSelectSubsystem: (id: string) => void;
}) {
  const [showSteps, setShowSteps] = useState(true);
  const [showAnchors, setShowAnchors] = useState(true);
  const [showModules, setShowModules] = useState(false);
  const [showExternal, setShowExternal] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(selectedStepId ? `step:${selectedStepId}` : selectedSubsystemId ? `subsystem:${selectedSubsystemId}` : `version:${selectedVersion.id}`);
  const graph = useMemo(
    () => buildGraph(data, lean, selectedVersion, { showSteps, showAnchors, showModules, showExternal }),
    [data, lean, selectedVersion, showSteps, showAnchors, showModules, showExternal],
  );
  const effectiveSelectedNodeId = selectedNodeId && graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : `version:${selectedVersion.id}`;
  const selectedNode = graph.nodes.find((node) => node.id === effectiveSelectedNodeId) ?? null;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<NetworkNode[]>([]);
  const edgesRef = useRef<NetworkEdge[]>([]);
  const selectedRef = useRef<string | null>(effectiveSelectedNodeId);
  const hoverRef = useRef<string | null>(null);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const alphaRef = useRef(1);
  const frameRef = useRef<number | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const controlRef = useRef<{ reheat: () => void; reset: () => void; zoomIn: () => void; zoomOut: () => void } | null>(null);
  const dragRef = useRef<{ node: NetworkNode | null; startX: number; startY: number; nodeStartX: number; nodeStartY: number; panStartX: number; panStartY: number; moved: boolean } | null>(null);
  const callbacksRef = useRef({ onSelectVersion, onSelectStep, onSelectSubsystem });

  useEffect(() => {
    callbacksRef.current = { onSelectVersion, onSelectStep, onSelectSubsystem };
  }, [onSelectVersion, onSelectStep, onSelectSubsystem]);

  useEffect(() => {
    selectedRef.current = effectiveSelectedNodeId;
    drawRef.current?.();
  }, [effectiveSelectedNodeId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    nodesRef.current = graph.nodes.map((node) => {
      const old = previous.get(node.id);
      return old ? { ...node, x: old.x, y: old.y, vx: old.vx, vy: old.vy } : { ...node };
    });
    edgesRef.current = graph.edges;
    alphaRef.current = 1;
    const context = canvas.getContext("2d");
    if (!context) return;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let lastWidth = 0;

    const fit = () => {
      const nextWidth = Math.max(320, container.clientWidth);
      if (nextWidth === lastWidth) {
        draw();
        return;
      }
      lastWidth = nextWidth;
      width = nextWidth;
      height = canvas.clientHeight || (width < 620 ? 540 : 620);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      const k = Math.min(1.08, Math.max(0.72, Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT)));
      transformRef.current = { x: (width - WORLD_WIDTH * k) / 2, y: (height - WORLD_HEIGHT * k) / 2, k };
      draw();
    };

    const draw = () => {
      const ctx = context;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const background = ctx.createLinearGradient(0, 0, width, height);
      background.addColorStop(0, "#0b1830");
      background.addColorStop(1, "#111f3d");
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
      ctx.save();
      const transform = transformRef.current;
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);
      const hovered = hoverRef.current;
      const selected = selectedRef.current;
      const active = hovered ?? selected;
      const neighbors = new Set<string>();
      if (active) {
        for (const edge of edgesRef.current) {
          if (edge.source === active) neighbors.add(edge.target);
          if (edge.target === active) neighbors.add(edge.source);
        }
      }
      for (const edge of edgesRef.current) {
        const source = nodesRef.current.find((node) => node.id === edge.source);
        const target = nodesRef.current.find((node) => node.id === edge.target);
        if (!source || !target) continue;
        const incident = !active || edge.source === active || edge.target === active;
        ctx.globalAlpha = incident ? 0.78 : 0.1;
        ctx.lineWidth = edge.type === "version" ? 1.7 : edge.type === "align-source" || edge.type === "align-inferred" ? 1.4 : 0.9;
        ctx.strokeStyle = edge.type === "version" ? "#e8b35a" : edge.type === "align-source" ? "#7fc9a0" : edge.type === "align-inferred" ? "#d9a95d" : edge.type === "anchor-step" || edge.type === "anchor-subsystem" ? "#d78a7c" : edge.type === "step-dep" || edge.type === "chain" ? "#7f93d8" : "#64748b";
        ctx.setLineDash(edge.type === "align-inferred" || edge.type === "import" || edge.type === "external" ? [4, 5] : edge.type === "anchor-step" ? [2, 4] : []);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const node of nodesRef.current) {
        const isActive = node.id === active;
        const isSelected = node.id === selected;
        const isNeighbor = neighbors.has(node.id);
        const dimmed = Boolean(active) && !isActive && !isNeighbor;
        ctx.globalAlpha = dimmed ? 0.28 : 1;
        if (isActive || isSelected) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r + 6, 0, Math.PI * 2);
          ctx.fillStyle = isSelected ? "rgba(138,160,255,.22)" : "rgba(232,179,90,.18)";
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();
        ctx.strokeStyle = isSelected ? "#ffffff" : "rgba(11,24,48,.85)";
        ctx.lineWidth = isSelected ? 2 : 1.2;
        ctx.stroke();
        const showLabel = node.type === "version" || node.type === "subsystem" || node.type === "entry"
          || (node.type === "step" && (transform.k > 0.9 || isActive || isSelected))
          || (node.type === "anchor" && (transform.k > 1.05 || isActive || isSelected))
          || (node.type === "module" && (transform.k > 1.35 || isActive || isSelected))
          || (node.type === "external" && (transform.k > 1.05 || isActive || isSelected));
        if (showLabel) {
          ctx.font = `${node.type === "version" || node.type === "entry" ? 11 : 9}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.lineJoin = "round";
          ctx.strokeStyle = "rgba(11,24,48,.92)";
          ctx.lineWidth = 3;
          ctx.strokeText(node.label, node.x + node.r + 4, node.y + 1);
          ctx.fillStyle = "#e7edf9";
          ctx.fillText(node.label, node.x + node.r + 4, node.y + 1);
        }
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    };
    drawRef.current = draw;

    const simulate = () => {
      const nodes = nodesRef.current;
      const alpha = alphaRef.current;
      for (let i = 0; i < nodes.length; i += 1) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j += 1) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < 1) {
            dx = (i - j) * 0.01;
            dy = (j - i) * 0.01;
            distanceSquared = 1;
          }
          const distance = Math.sqrt(distanceSquared);
          const force = (1300 * alpha) / Math.max(64, distanceSquared);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
          const labelAllowance = (node: NetworkNode) => node.type === "step" ? Math.min(34, node.label.length * 1.6) : node.type === "anchor" ? Math.min(24, node.label.length * 1.3) : 0;
          const minDistance = a.r + b.r + 9 + labelAllowance(a) + labelAllowance(b);
          if (distance < minDistance) {
            const push = (minDistance - distance) * 0.5;
            const px = (dx / distance) * push;
            const py = (dy / distance) * push;
            a.x -= px;
            a.y -= py;
            b.x += px;
            b.y += py;
          }
        }
        a.vx += (WORLD_WIDTH / 2 - a.x) * 0.0009 * alpha;
        a.vy += (WORLD_HEIGHT / 2 - a.y) * 0.0011 * alpha;
      }
      for (const edge of edgesRef.current) {
        const source = nodes.find((node) => node.id === edge.source);
        const target = nodes.find((node) => node.id === edge.target);
        if (!source || !target) continue;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const force = (distance - edge.rest) * 0.016 * edge.strength * alpha;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        source.vx += fx;
        source.vy += fy;
        target.vx -= fx;
        target.vy -= fy;
      }
      for (const node of nodes) {
        node.vx *= 0.86;
        node.vy *= 0.86;
        node.x = Math.max(20, Math.min(WORLD_WIDTH - 20, node.x + node.vx));
        node.y = Math.max(20, Math.min(WORLD_HEIGHT - 20, node.y + node.vy));
      }
      alphaRef.current = Math.max(0.006, alpha * 0.994);
    };

    const tick = () => {
      simulate();
      draw();
      if (alphaRef.current > 0.01) frameRef.current = requestAnimationFrame(tick);
      else frameRef.current = null;
    };
    const start = () => {
      alphaRef.current = Math.max(alphaRef.current, 0.7);
      if (frameRef.current === null) frameRef.current = requestAnimationFrame(tick);
    };
    const zoomBy = (factor: number) => {
      const transform = transformRef.current;
      const nextK = Math.max(0.4, Math.min(2.8, transform.k * factor));
      const ratio = nextK / transform.k;
      const centerX = width / 2;
      const centerY = height / 2;
      transformRef.current = { x: centerX - (centerX - transform.x) * ratio, y: centerY - (centerY - transform.y) * ratio, k: nextK };
      draw();
    };
    controlRef.current = {
      reheat: () => {
        alphaRef.current = 1;
        for (const node of nodesRef.current) {
          node.vx += (Math.random() - 0.5) * 2;
          node.vy += (Math.random() - 0.5) * 2;
        }
        start();
      },
      reset: fit,
      zoomIn: () => zoomBy(1.25),
      zoomOut: () => zoomBy(0.8),
    };

    const worldPoint = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const transform = transformRef.current;
      return { x: (event.clientX - rect.left - transform.x) / transform.k, y: (event.clientY - rect.top - transform.y) / transform.k };
    };
    const nodeAt = (point: { x: number; y: number }) => {
      for (let i = nodesRef.current.length - 1; i >= 0; i -= 1) {
        const node = nodesRef.current[i];
        if (Math.hypot(node.x - point.x, node.y - point.y) <= node.r + 7) return node;
      }
      return null;
    };
    const onMouseDown = (event: MouseEvent) => {
      const point = worldPoint(event);
      const node = nodeAt(point);
      dragRef.current = {
        node,
        startX: event.clientX,
        startY: event.clientY,
        nodeStartX: node?.x ?? 0,
        nodeStartY: node?.y ?? 0,
        panStartX: transformRef.current.x,
        panStartY: transformRef.current.y,
        moved: false,
      };
      canvas.style.cursor = node ? "grabbing" : "grab";
      event.preventDefault();
    };
    const onMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (drag) {
        const dx = event.clientX - drag.startX;
        const dy = event.clientY - drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
        if (drag.node) {
          drag.node.x = drag.nodeStartX + dx / transformRef.current.k;
          drag.node.y = drag.nodeStartY + dy / transformRef.current.k;
          drag.node.vx = 0;
          drag.node.vy = 0;
          alphaRef.current = Math.max(alphaRef.current, 0.35);
          draw();
        } else {
          transformRef.current.x = drag.panStartX + dx;
          transformRef.current.y = drag.panStartY + dy;
          draw();
        }
        return;
      }
      const node = nodeAt(worldPoint(event));
      hoverRef.current = node?.id ?? null;
      canvas.style.cursor = node ? "pointer" : "grab";
      draw();
    };
    const onMouseUp = (event: MouseEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      canvas.style.cursor = "grab";
      if (!drag || drag.moved) {
        if (drag?.node) start();
        return;
      }
      const node = nodeAt(worldPoint(event));
      if (!node) return;
      setSelectedNodeId(node.id);
      if (node.meta.versionId) callbacksRef.current.onSelectVersion(node.meta.versionId);
      if (node.meta.stepId) callbacksRef.current.onSelectStep(node.meta.stepId);
      if (node.meta.subsystemId) callbacksRef.current.onSelectSubsystem(node.meta.subsystemId);
    };
    const onMouseLeave = () => {
      dragRef.current = null;
      hoverRef.current = null;
      draw();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const transform = transformRef.current;
      const nextK = Math.max(0.35, Math.min(2.8, transform.k * Math.exp(-event.deltaY * 0.0012)));
      const ratio = nextK / transform.k;
      transformRef.current = { x: mouseX - (mouseX - transform.x) * ratio, y: mouseY - (mouseY - transform.y) * ratio, k: nextK };
      draw();
    };

    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("mouseleave", onMouseLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(fit);
    });
    observer.observe(container);
    fit();
    start();
    return () => {
      cancelAnimationFrame(resizeFrame);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseup", onMouseUp);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      canvas.removeEventListener("wheel", onWheel);
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      drawRef.current = null;
      controlRef.current = null;
    };
  }, [graph]);

  return <div className="proof-network">
    <div className="proof-network-toolbar">
      <div className="proof-network-filters" aria-label="Network layers">
        <label><input type="checkbox" checked={showSteps} onChange={(event) => setShowSteps(event.target.checked)} /> Proof steps</label>
        <label><input type="checkbox" checked={showAnchors} onChange={(event) => setShowAnchors(event.target.checked)} /> Lean anchors</label>
        <label><input type="checkbox" checked={showModules} onChange={(event) => setShowModules(event.target.checked)} /> Top-level modules</label>
        <label><input type="checkbox" checked={showExternal} onChange={(event) => setShowExternal(event.target.checked)} /> External libs</label>
      </div>
      <div className="proof-network-actions">
        <button type="button" onClick={() => controlRef.current?.zoomIn()}>Zoom +</button>
        <button type="button" onClick={() => controlRef.current?.zoomOut()}>Zoom −</button>
        <button type="button" onClick={() => controlRef.current?.reheat()}>Reheat</button>
        <button type="button" onClick={() => controlRef.current?.reset()}>Reset view</button>
      </div>
      <span className="proof-network-mobile-note">On small screens, use Layered or the module tables below for the full structure.</span>
    </div>
    <div className="proof-network-stage" ref={containerRef}>
      <canvas ref={canvasRef} aria-label="Interactive proof and Lean structure network; the tables below are the accessible full view." />
      <div className="proof-network-hint">Drag nodes · scroll to zoom · click to focus · hover for labels</div>
    </div>
    <div className="proof-network-legend" aria-label="Network legend">
      <span><i style={{ background: COLORS.version }} />Version</span>
      <span><i style={{ background: COLORS.step }} />Paper step</span>
      <span><i style={{ background: COLORS.subsystem }} />Lean subsystem</span>
      <span><i style={{ background: COLORS.anchor }} />Declaration anchor</span>
      <span><i className="is-module" style={{ background: COLORS.module }} />Module</span>
      <span><i className="is-external" style={{ background: COLORS.external }} />External</span>
      <span>solid = source-anchored · dashed amber = inferred · thin = imports</span>
    </div>
    {selectedNode && <Surface tone="card" className="proof-network-detail">
      <span className="proof-network-detail-type">{selectedNode.type}</span>
      <h3>{selectedNode.label}</h3>
      <p>{networkDetail(selectedNode, data, lean, selectedVersion)}</p>
      {selectedNode.meta.anchorId && (() => {
        const anchor = lean.anchors.find((candidate) => candidate.id === selectedNode.meta.anchorId);
        return anchor ? <div className="proof-network-detail-meta">
          <code>{anchor.fullName}</code>
          {anchor.module && <a href={anchor.url ?? "#"} target="_blank" rel="noreferrer">{shortModule(anchor.module)}:{anchor.line} ↗</a>}
          <span>{anchor.note}</span>
        </div> : null;
      })()}
      {selectedNode.meta.moduleId && (() => {
        const moduleInfo = lean.modules.find((candidate) => candidate.id === selectedNode.meta.moduleId);
        return moduleInfo ? <div className="proof-network-detail-meta">
          <code>{shortModule(moduleInfo.id)}</code>
          <a href={moduleInfo.url} target="_blank" rel="noreferrer">Open source ↗</a>
          <span>{moduleInfo.lines} lines · {moduleInfo.declarations} declarations · {moduleInfo.importsOai} OAI imports · {moduleInfo.importsExternal} external imports</span>
        </div> : null;
      })()}
    </Surface>}
  </div>;
}

function networkDetail(node: NetworkNode, data: ProofEvolutionData, lean: LeanStructureData, selectedVersion: ProofVersion) {
  if (node.type === "version") {
    const version = data.versions.find((candidate) => candidate.id === node.meta.versionId);
    return version ? `${version.pages} pages · ${version.method} · ${version.lean.status === "formalized_upstream" ? "Lean formalized upstream" : "no Lean formalization found"}` : "";
  }
  if (node.type === "step") {
    const step = selectedVersion.proofSteps.find((candidate) => candidate.id === node.meta.stepId);
    const alignment = lean.paperAlignments.find((candidate) => candidate.versionId === selectedVersion.id && candidate.stepId === node.meta.stepId);
    return step ? `${step.source} · ${alignment ? `Lean alignment: ${alignment.subsystems.join(", ")} (${alignment.confidence})` : "no Lean alignment for this version"}` : "";
  }
  if (node.type === "subsystem") {
    const subsystem = lean.subsystems.find((candidate) => candidate.id === node.meta.subsystemId);
    if (!subsystem) return "";
    const imports = lean.subsystemEdges.filter((edge) => edge.from === subsystem.id && edge.to !== subsystem.id).sort((a, b) => b.count - a.count).slice(0, 3);
    return `${subsystem.moduleCount} modules · ${subsystem.lines.toLocaleString("en-US")} lines · ${subsystem.declarations.toLocaleString("en-US")} declarations · imports ${imports.map((edge) => `${edge.to} (${edge.count})`).join(", ") || "none"}.`;
  }
  if (node.type === "anchor") {
    const anchor = lean.anchors.find((candidate) => candidate.id === node.meta.anchorId);
    return anchor ? `${anchor.role} · ${anchor.paperStepId} · source-located declaration` : "";
  }
  if (node.type === "module") {
    const moduleInfo = lean.modules.find((candidate) => candidate.id === node.meta.moduleId);
    return moduleInfo ? `${moduleInfo.subsystem} · ${moduleInfo.lines} lines · ${moduleInfo.declarations} declarations` : "";
  }
  if (node.type === "entry") return `${lean.topLevelModules.length} direct imports of Main.lean. Turn off filters to see the full module list below.`;
  return node.type === "external" ? `External import node · Mathlib: ${lean.externalImports.mathlibCount} · PNT: ${lean.externalImports.pnt.length} (not fetched).` : "";
}
