"use client";

import { useEffect, useRef } from "react";
import type { ArgumentMapRole } from "@/app/lib/proof-evolution";

export type ArgumentNetworkNode = {
  id: string;
  type: "strategy" | "step" | "result";
  label: string;
  sublabel: string;
  color: string;
  role: string;
  meta: { nodeId?: string; strategyId?: string };
};

export type ArgumentNetworkEdge = {
  source: string;
  target: string;
  type: "strategy" | "depends" | "final" | "cross";
  label?: string;
};

type PositionedNode = ArgumentNetworkNode & {
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  r: number;
  pinned: boolean;
};

type PositionedEdge = ArgumentNetworkEdge & { rest: number; strength: number };

const WORLD_WIDTH = 1100;
const WORLD_HEIGHT = 620;

function initialLayout(nodes: ArgumentNetworkNode[], roles: ArgumentMapRole[]) {
  const roleIds = roles.map((role) => role.id);
  const roleIndex = new Map(roleIds.map((id, index) => [id, index]));
  const roleNodes = new Map<string, ArgumentNetworkNode[]>();
  for (const node of nodes) {
    if (node.type === "strategy") continue;
    const list = roleNodes.get(node.role) ?? [];
    list.push(node);
    roleNodes.set(node.role, list);
  }
  const strategyIds = [...new Set(nodes.filter((node) => node.meta.strategyId).map((node) => node.meta.strategyId as string))];
  const strategyIndex = new Map(strategyIds.map((id, index) => [id, index]));
  const sharedResult = nodes.find((node) => node.type === "result" && node.role === "result" && !node.meta.strategyId);
  return nodes.map((node) => {
    let x = WORLD_WIDTH / 2;
    let y = WORLD_HEIGHT / 2;
    if (node.type === "strategy") {
      const index = strategyIndex.get(node.meta.strategyId ?? "") ?? 0;
      x = strategyIds.length === 1 ? WORLD_WIDTH / 2 : 160 + (index / (strategyIds.length - 1)) * 720;
      y = 64;
    } else if (node === sharedResult) {
      x = WORLD_WIDTH - 118;
      y = WORLD_HEIGHT / 2;
    } else {
      const index = roleIndex.get(node.role) ?? 0;
      const list = roleNodes.get(node.role) ?? [node];
      const sameStrategy = list.filter((candidate) => candidate.meta.strategyId === node.meta.strategyId);
      const position = sameStrategy.indexOf(node);
      const lane = strategyIndex.get(node.meta.strategyId ?? "") ?? 0;
      const laneOffset = strategyIds.length > 1 ? (lane - (strategyIds.length - 1) / 2) * 112 : 0;
      x = 150 + (index / Math.max(1, roles.length - 1)) * 600;
      y = WORLD_HEIGHT / 2 + laneOffset + (position - (sameStrategy.length - 1) / 2) * 40;
    }
    return {
      ...node,
      x,
      y,
      vx: 0,
      vy: 0,
      homeX: x,
      homeY: y,
      r: node.type === "strategy" ? 14 : node.type === "result" ? 10 : 7,
      pinned: node.type === "strategy" || (node.type === "result" && !node.meta.strategyId),
    } satisfies PositionedNode;
  });
}

function edgeStyle(edge: ArgumentNetworkEdge) {
  if (edge.type === "strategy") return { rest: 118, strength: 0.2 };
  if (edge.type === "depends") return { rest: 76, strength: 0.38 };
  if (edge.type === "final") return { rest: 120, strength: 0.55 };
  return { rest: 165, strength: 0.13 };
}

export function ArgumentNetworkGraph({ nodes, edges, graphKey, roles, selectedNodeId, onSelectNode }: {
  nodes: ArgumentNetworkNode[];
  edges: ArgumentNetworkEdge[];
  graphKey: string;
  roles: ArgumentMapRole[];
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodesRef = useRef<PositionedNode[]>([]);
  const edgesRef = useRef<PositionedEdge[]>([]);
  const selectedRef = useRef<string | null>(selectedNodeId);
  const hoverRef = useRef<string | null>(null);
  const transformRef = useRef({ x: 0, y: 0, k: 1 });
  const alphaRef = useRef(1);
  const frameRef = useRef<number | null>(null);
  const drawRef = useRef<(() => void) | null>(null);
  const controlRef = useRef<{ reheat: () => void; reset: () => void; zoomIn: () => void; zoomOut: () => void } | null>(null);
  const dragRef = useRef<{ node: PositionedNode | null; startX: number; startY: number; nodeStartX: number; nodeStartY: number; panStartX: number; panStartY: number; moved: boolean } | null>(null);
  useEffect(() => {
    selectedRef.current = selectedNodeId;
    drawRef.current?.();
  }, [selectedNodeId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    const initial = initialLayout(nodes, roles);
    nodesRef.current = initial.map((node) => {
      const old = previous.get(node.id);
      return old ? { ...node, x: old.x, y: old.y, vx: old.vx, vy: old.vy } : node;
    });
    const nodeById = new Map(nodesRef.current.map((node) => [node.id, node]));
    edgesRef.current = edges
      .filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target))
      .map((edge) => ({ ...edge, ...edgeStyle(edge) }));
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
      height = canvas.clientHeight || (width < 620 ? 520 : 620);
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
      const active = hoverRef.current ?? selectedRef.current;
      const neighbors = new Set<string>();
      if (active) for (const edge of edgesRef.current) {
        if (edge.source === active) neighbors.add(edge.target);
        if (edge.target === active) neighbors.add(edge.source);
      }
      for (const edge of edgesRef.current) {
        const source = nodeById.get(edge.source);
        const target = nodeById.get(edge.target);
        if (!source || !target) continue;
        const incident = !active || edge.source === active || edge.target === active;
        ctx.globalAlpha = incident ? (edge.type === "strategy" ? 0.38 : edge.type === "cross" ? 0.42 : 0.78) : 0.08;
        ctx.lineWidth = edge.type === "final" ? 1.8 : edge.type === "cross" ? 1 : 0.9;
        ctx.strokeStyle = edge.type === "final" ? "#e8b35a" : edge.type === "cross" ? "#b7a6d9" : edge.type === "depends" ? "#7f93d8" : "#64748b";
        ctx.setLineDash(edge.type === "cross" ? [4, 5] : edge.type === "strategy" ? [2, 5] : []);
        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      for (const node of nodesRef.current) {
        const isActive = node.id === active;
        const isSelected = node.id === selectedRef.current;
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
      }
      const placedLabels: Array<{ left: number; top: number; right: number; bottom: number }> = [];
      const labelPriority = (node: PositionedNode) => node.id === selectedRef.current || node.id === active ? 0 : node.type === "strategy" ? 1 : node.type === "result" && !node.meta.strategyId ? 2 : node.type === "result" ? 3 : 4;
      const labelNodes = [...nodesRef.current].sort((a, b) => labelPriority(a) - labelPriority(b));
      for (const node of labelNodes) {
        const isActive = node.id === active;
        const isSelected = node.id === selectedRef.current;
        const isNeighbor = neighbors.has(node.id);
        const forceLabel = isActive || isSelected || node.type === "strategy" || (node.type === "result" && !node.meta.strategyId);
        const showLabel = forceLabel || node.type === "result" || node.type === "step"
          && (transform.k > 0.7 || isNeighbor);
        if (!showLabel) continue;
        ctx.font = `${node.type === "step" ? 9 : 11}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
        const labelWidth = ctx.measureText(node.label).width;
        const labelLeft = node.x + node.r + 4;
        const labelTop = node.y - 7;
        const labelBox = { left: labelLeft, top: labelTop, right: labelLeft + labelWidth + 4, bottom: labelTop + 14 };
        const collides = placedLabels.some((placed) => labelBox.left < placed.right && labelBox.right > placed.left && labelBox.top < placed.bottom && labelBox.bottom > placed.top);
        if (collides && !forceLabel) continue;
        ctx.globalAlpha = active && node.id !== active && !neighbors.has(node.id) ? 0.55 : 1;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "rgba(11,24,48,.92)";
        ctx.lineWidth = 3;
        ctx.strokeText(node.label, labelLeft, node.y + 1);
        ctx.fillStyle = "#e7edf9";
        ctx.fillText(node.label, labelLeft, node.y + 1);
        placedLabels.push(labelBox);
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
          const force = (1500 * alpha) / Math.max(64, distanceSquared);
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;
          a.vx -= fx;
          a.vy -= fy;
          b.vx += fx;
          b.vy += fy;
          const minDistance = a.r + b.r + 10;
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
        a.vx += (a.homeX - a.x) * 0.0012 * alpha;
        a.vy += (a.homeY - a.y) * 0.0016 * alpha;
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
        if (node.pinned) {
          node.x = node.homeX;
          node.y = node.homeY;
          node.vx = 0;
          node.vy = 0;
          continue;
        }
        node.vx *= 0.86;
        node.vy *= 0.86;
        node.x = Math.max(22, Math.min(WORLD_WIDTH - 22, node.x + node.vx));
        node.y = Math.max(22, Math.min(WORLD_HEIGHT - 22, node.y + node.vy));
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
        if (Math.hypot(node.x - point.x, node.y - point.y) <= node.r + 8) return node;
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
      if (node.meta.nodeId) onSelectNode(node.meta.nodeId);
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
  }, [graphKey, edges, nodes, onSelectNode, roles]);

  return <div className="argument-network">
    <div className="proof-network-toolbar">
      <span className="lean-structure-eyebrow">Argument network · drag nodes, scroll to zoom, click for detail</span>
      <div className="proof-network-actions">
        <button type="button" onClick={() => controlRef.current?.zoomIn()}>Zoom +</button>
        <button type="button" onClick={() => controlRef.current?.zoomOut()}>Zoom −</button>
        <button type="button" onClick={() => controlRef.current?.reheat()}>Reheat</button>
        <button type="button" onClick={() => controlRef.current?.reset()}>Reset view</button>
      </div>
      <span className="proof-network-mobile-note">On small screens, use Matrix or zoom out for the full structure.</span>
    </div>
    <div className="proof-network-stage" ref={containerRef}>
      <canvas ref={canvasRef} aria-label="Interactive argument network; the matrix view and detail drawer are the accessible full view." />
      <div className="proof-network-hint">Dark nodes are argument steps · gold nodes are results · dashed edges are cross-strategy relations</div>
    </div>
    <div className="proof-network-legend" aria-label="Argument network legend">
      <span><i className="is-strategy" />Strategy hub</span>
      <span><i style={{ background: "#8aa0ff" }} />Argument step</span>
      <span><i style={{ background: "#f2d27a" }} />Shared result</span>
      <span><i className="is-network-edge is-depends" />Dependency</span>
      <span><i className="is-network-edge is-final" />Proves / implies</span>
      <span><i className="is-network-edge is-cross" />Cross-strategy</span>
    </div>
    {selectedNodeId && <span className="argument-network-selected">Selected node: {nodes.find((node) => node.id === selectedNodeId)?.label ?? selectedNodeId}</span>}
  </div>;
}
