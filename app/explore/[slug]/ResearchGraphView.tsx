import Link from "next/link";
import type { CSSProperties } from "react";
import type { PublicResearchGraph, PublicResearchNode } from "@/db/repositories/research-graph";
import { HistoricalSourceImporter } from "./HistoricalSourceImporter";

export function ResearchGraphView({
  graph,
  problemSlug,
  canImportSources,
  signInPath,
}: {
  graph: PublicResearchGraph | null;
  problemSlug: string;
  canImportSources: boolean;
  signInPath: string;
}) {
  if (!graph) {
    return <section className="research-graph-section" aria-labelledby="research-graph-title">
      <GraphHeading nodeCount={0} branchCount={0} />
      <div className="research-graph-unavailable">
        <strong>Research graph activation is pending.</strong>
        <p>The source-pinned conjecture remains available, but its checkpoint schema is not active in this control plane yet.</p>
      </div>
    </section>;
  }

  const layers = layerNodes(graph);
  const parentIds = new Set(graph.edges.map((edge) => edge.parentNodeId));
  const branchCount = graph.nodes.filter((node) => !parentIds.has(node.id)).length;
  const parentsByChild = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const parents = parentsByChild.get(edge.childNodeId) ?? [];
    parents.push(edge.parentNodeId);
    parentsByChild.set(edge.childNodeId, parents);
  }

  return <section className="research-graph-section" aria-labelledby="research-graph-title">
    <GraphHeading nodeCount={graph.nodes.length} branchCount={branchCount} />
    <div className="research-graph-boundary">
      <span>Public checkpoint</span>
      <span>Agent-signed</span>
      <span className="is-boundary">Not yet verified or credited</span>
    </div>

    <div className="research-foundation">
      <div className="research-foundation-heading">
        <div>
          <span className="micro-label">00 · Prior work</span>
          <h3>Start from the record, not from zero.</h3>
        </div>
        <span>{graph.externalWorks.length} source{graph.externalWorks.length === 1 ? "" : "s"}</span>
      </div>
      {graph.externalWorks.length > 0 ? <div className="historical-source-list">
        {graph.externalWorks.map((work) => <article className="historical-source-card" key={work.id}>
          <div><span>{work.sourceSystem}</span><span>{work.sourceRevision}</span></div>
          <h4><a href={work.sourceUrl} rel="noreferrer" target="_blank">{work.title}</a></h4>
          <p>{work.attributions.map((entry) => `${entry.displayName} · ${entry.role}`).join("; ")}</p>
          <small>{work.citedBy.length > 0 ? `Cited by ${work.citedBy.length} shared checkpoint${work.citedBy.length === 1 ? "" : "s"}` : "Linked as prior work; not cited by a checkpoint yet"}</small>
        </article>)}
      </div> : <p className="research-foundation-empty">No historical work has been linked to this exact problem revision yet. Adding a source preserves its original names and provenance; it does not mint Proofweave credit.</p>}
      <HistoricalSourceImporter problemSlug={problemSlug} canImport={canImportSources} signInPath={signInPath} />
    </div>

    {graph.nodes.length === 0 ? <div className="research-graph-empty">
      <strong>No public research checkpoint yet.</strong>
      <p>The first Agent can publish a concise formalization, lemma, counterexample, proof state, or other material milestone without exposing private reasoning.</p>
      <Link className="button button-primary" href={`/workbench?target=${encodeURIComponent(problemSlug)}#research-launcher`}>Open the first branch <span aria-hidden="true">→</span></Link>
    </div> : <div className="research-graph-scroll" tabIndex={0} aria-label="Research checkpoint graph">
      <div className="research-graph-layers" style={{ "--research-layer-count": Math.max(layers.length, 1) } as CSSProperties}>
        {layers.map((nodes, layerIndex) => <section className="research-graph-layer" key={layerIndex} aria-label={`Research layer ${layerIndex + 1}`}>
          <div className="research-layer-heading"><span>{String(layerIndex + 1).padStart(2, "0")}</span><strong>{layerIndex === 0 ? "Starting points" : `Derived step ${layerIndex}`}</strong></div>
          <div className="research-layer-nodes">
            {nodes.map((node) => <ResearchNodeCard
              key={node.id}
              node={node}
              parentIds={parentsByChild.get(node.id) ?? []}
              problemSlug={problemSlug}
              isTip={!parentIds.has(node.id)}
            />)}
          </div>
        </section>)}
      </div>
    </div>}
    {graph.truncated && <p className="research-graph-truncated">This view is capped at the first 300 checkpoints. The API retains explicit node and edge identifiers for paginated graph clients.</p>}
  </section>;
}

function GraphHeading({ nodeCount, branchCount }: { nodeCount: number; branchCount: number }) {
  return <div className="research-graph-heading">
    <div>
      <p className="eyebrow">Open research graph</p>
      <h2 id="research-graph-title">See what has been tried. Continue what matters.</h2>
      <p>Material milestones form an append-only DAG: derive a child from an existing checkpoint, open an independent branch, or synthesize two or more branches. Raw chain-of-thought stays local.</p>
    </div>
    <dl>
      <div><dt>Checkpoints</dt><dd>{nodeCount}</dd></div>
      <div><dt>Open tips</dt><dd>{branchCount}</dd></div>
    </dl>
  </div>;
}

function ResearchNodeCard({
  node,
  parentIds,
  problemSlug,
  isTip,
}: {
  node: PublicResearchNode;
  parentIds: readonly string[];
  problemSlug: string;
  isTip: boolean;
}) {
  return <article className={`research-node-card kind-${node.kind}`}>
    <div className="research-node-top">
      <span>{node.kind.replaceAll("_", " ")}</span>
      {isTip && <span className="research-tip-chip">Open tip</span>}
    </div>
    <p>{node.summary}</p>
    {parentIds.length > 0 && <div className="research-node-parents"><span>From</span>{parentIds.map((id) => <code key={id}>{shortId(id)}</code>)}</div>}
    <div className="research-node-author"><span>{node.creator.displayName}</span><small>via {node.creator.agentLabel} · {formatDate(node.occurredAt)}</small></div>
    <div className="research-node-footer">
      <code>{shortId(node.id)}</code>
      <Link href={`/workbench?target=${encodeURIComponent(problemSlug)}&parent=${encodeURIComponent(node.id)}#research-launcher`}>Continue branch <span aria-hidden="true">→</span></Link>
    </div>
  </article>;
}

function layerNodes(graph: PublicResearchGraph): PublicResearchNode[][] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const parentsByChild = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!nodeById.has(edge.childNodeId) || !nodeById.has(edge.parentNodeId)) continue;
    parentsByChild.set(edge.childNodeId, [...(parentsByChild.get(edge.childNodeId) ?? []), edge.parentNodeId]);
  }
  const levels = new Map<string, number>();
  const visiting = new Set<string>();
  const levelFor = (id: string): number => {
    const known = levels.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const parents = parentsByChild.get(id) ?? [];
    const level = parents.length === 0 ? 0 : Math.max(...parents.map(levelFor)) + 1;
    visiting.delete(id);
    levels.set(id, level);
    return level;
  };
  const layers: PublicResearchNode[][] = [];
  for (const node of graph.nodes) {
    const level = levelFor(node.id);
    (layers[level] ??= []).push(node);
  }
  return layers;
}

function shortId(id: string): string {
  const suffix = id.includes(":") ? id.slice(id.lastIndexOf(":") + 1) : id;
  return suffix.length > 12 ? `${suffix.slice(0, 6)}…${suffix.slice(-4)}` : suffix;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : value;
}
