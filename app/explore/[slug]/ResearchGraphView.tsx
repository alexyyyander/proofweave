import { CardTitle, SectionTitle, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import Link from "next/link";
import { type CSSProperties } from "react";
import { type PublicResearchGraph, type PublicResearchNode, type ResearchNodeKind } from "@/db/repositories/research-graph";
import { getI18n } from "@/app/i18n/server";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import { HistoricalSourceImporter } from "./HistoricalSourceImporter";

const kindKeys: Record<ResearchNodeKind, TranslationKey> = {
  formalization: "explore.graph.kind.formalization",
  hypothesis: "explore.graph.kind.hypothesis",
  lemma: "explore.graph.kind.lemma",
  proof_state: "explore.graph.kind.proof_state",
  proof_patch: "explore.graph.kind.proof_patch",
  counterexample: "explore.graph.kind.counterexample",
  negative_result: "explore.graph.kind.negative_result",
  synthesis: "explore.graph.kind.synthesis",
};

const stageKeys: Record<PublicResearchNode["evidence"]["stage"], TranslationKey> = {
  shared: "explore.graph.stage.shared",
  bundle_staged: "explore.graph.stage.bundle_staged",
  kernel_accepted: "explore.graph.stage.kernel_accepted",
  review_recorded: "explore.graph.stage.review_recorded",
  receipt_recorded: "explore.graph.stage.receipt_recorded",
};

export async function ResearchGraphView({
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
  const { t } = await getI18n();
  if (!graph) {
    return <section className="research-graph-section" aria-labelledby="research-graph-title">
      <GraphHeading nodeCount={0} branchCount={0} t={t} />
      <div className="research-graph-unavailable">
        <strong>{t("explore.graph.pendingTitle")}</strong>
        <p>{t("explore.graph.pendingBody")}</p>
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
    <GraphHeading nodeCount={graph.nodes.length} branchCount={branchCount} t={t} />
    <div className="research-graph-boundary">
      <span>{t("explore.graph.boundary.public")}</span>
      <span>{t("explore.graph.boundary.signed")}</span>
      <span className="is-boundary">{t("explore.graph.boundary.separate")}</span>
    </div>

    <div className="research-foundation">
      <div className="research-foundation-heading">
        <div>
          <span className="micro-label">{t("explore.graph.prior.label")}</span>
          <CardTitle>{t("explore.graph.prior.title")}</CardTitle>
        </div>
        <span>{t("explore.graph.prior.sources", { count: graph.externalWorks.length })}</span>
      </div>
      {graph.externalWorks.length > 0 ? <div className="historical-source-list">
        {graph.externalWorks.map((work) => <Surface as="article" className="historical-source-card" key={work.id}>
          <div><span>{work.sourceSystem}</span><span>{work.sourceRevision}</span></div>
          <h4><a href={work.sourceUrl} rel="noreferrer" target="_blank">{work.title}</a></h4>
          <p>{work.attributions.map((entry) => `${entry.displayName} · ${entry.role}`).join("; ")}</p>
          <small>{work.citedBy.length > 0 ? t("explore.graph.prior.cited", { count: work.citedBy.length }) : t("explore.graph.prior.linked")}</small>
        </Surface>)}
      </div> : <p className="research-foundation-empty">{t("explore.graph.prior.empty")}</p>}
      <HistoricalSourceImporter problemSlug={problemSlug} canImport={canImportSources} signInPath={signInPath} />
    </div>

    {graph.nodes.length === 0 ? <EmptyState as="div" className="research-graph-empty">
      <strong>{t("explore.graph.empty.title")}</strong>
      <p>{t("explore.graph.empty.body")}</p>
      <ActionLink className="button button-primary" href={`/workbench?target=${encodeURIComponent(problemSlug)}#research-launcher`}>{t("explore.graph.empty.action")} <span aria-hidden="true">→</span></ActionLink>
    </EmptyState> : <div className="research-graph-scroll" tabIndex={0} aria-label={t("explore.graph.aria")}>
      <div className="research-graph-layers" style={{ "--research-layer-count": Math.max(layers.length, 1) } as CSSProperties}>
        {layers.map((nodes, layerIndex) => <section className="research-graph-layer" key={layerIndex} aria-label={t("explore.graph.layerAria", { number: layerIndex + 1 })}>
          <div className="research-layer-heading"><span>{String(layerIndex + 1).padStart(2, "0")}</span><strong>{layerIndex === 0 ? t("explore.graph.startingPoints") : t("explore.graph.derived", { number: layerIndex })}</strong></div>
          <div className="research-layer-nodes">
            {nodes.map((node) => <ResearchNodeCard
              key={node.id}
              node={node}
              parentIds={parentsByChild.get(node.id) ?? []}
              problemSlug={problemSlug}
              isTip={!parentIds.has(node.id)}
              t={t}
            />)}
          </div>
        </section>)}
      </div>
    </div>}
    {graph.truncated && <p className="research-graph-truncated">{t("explore.graph.truncated")}</p>}
  </section>;
}

function GraphHeading({ nodeCount, branchCount, t }: { nodeCount: number; branchCount: number; t: Translator }) {
  return <SectionHeading as="div" className="research-graph-heading">
    <div>
      <p className="eyebrow">{t("explore.graph.heading.eyebrow")}</p>
      <SectionTitle id="research-graph-title">{t("explore.graph.heading.title")}</SectionTitle>
      <p>{t("explore.graph.heading.body")}</p>
    </div>
    <FieldList layout="stacked">
      <Field label={t("explore.graph.field.checkpoints")}>{nodeCount}</Field>
      <Field label={t("explore.graph.field.openTips")}>{branchCount}</Field>
    </FieldList>
  </SectionHeading>;
}

function ResearchNodeCard({
  node,
  parentIds,
  problemSlug,
  isTip,
  t,
}: {
  node: PublicResearchNode;
  parentIds: readonly string[];
  problemSlug: string;
  isTip: boolean;
  t: Translator;
}) {
  return <Surface as="article" className={`research-node-card kind-${node.kind}`}>
    <div className="research-node-top">
      <span>{t(kindKeys[node.kind])}</span>
      {isTip && <span className="research-tip-chip">{t("explore.graph.node.openTip")}</span>}
    </div>
    <p>{node.summary}</p>
    {parentIds.length > 0 && <div className="research-node-parents"><span>{t("explore.graph.node.from")}</span>{parentIds.map((id) => <code key={id}>{shortId(id)}</code>)}</div>}
    <ResearchNodeEvidence node={node} t={t} />
    <div className="research-node-author"><Link href={`/people/${encodeURIComponent(node.creator.personId)}`}>{node.creator.displayName}</Link><small>{t("explore.graph.node.via")} {node.creator.agentLabel} · {formatDate(node.occurredAt)}</small></div>
    <div className="research-node-footer">
      <code>{shortId(node.id)}</code>
      <Link href={`/workbench?target=${encodeURIComponent(problemSlug)}&parent=${encodeURIComponent(node.id)}#research-launcher`}>{t("explore.graph.node.continue")} <span aria-hidden="true">→</span></Link>
    </div>
  </Surface>;
}

function ResearchNodeEvidence({ node, t }: { node: PublicResearchNode; t: Translator }) {
  const evidence = node.evidence;
  return <div className={`research-node-evidence stage-${evidence.stage}`}>
    <div className="research-evidence-heading"><span>{t("explore.graph.evidence.title")}</span><strong>{t(stageKeys[evidence.stage])}</strong></div>
    <ol aria-label={t("explore.graph.evidence.gatesAria")}>
      <EvidenceGate label={t("explore.graph.gate.shared")} active />
      <EvidenceGate label={t("explore.graph.gate.bundle")} active={Boolean(evidence.bundle)} />
      <EvidenceGate label={t("explore.graph.gate.lean")} active={Boolean(evidence.lean)} />
      <EvidenceGate label={t("explore.graph.gate.review")} active={Boolean(evidence.review)} />
      <EvidenceGate label={t("explore.graph.gate.receipt")} active={Boolean(evidence.receipt)} />
    </ol>
    {evidence.review && <small>{t("explore.graph.review.summary", { claims: evidence.review.attestationCount, owners: evidence.review.reviewerCount })}</small>}
    {evidence.receipt && <Link className="research-evidence-receipt" href={`/receipt/${encodeURIComponent(evidence.receipt.id)}`}>{t("explore.graph.receipt.open")} <span aria-hidden="true">→</span></Link>}
  </div>;
}

function EvidenceGate({ label, active }: { label: string; active: boolean }) {
  return <li className={active ? "is-recorded" : ""}><i aria-hidden="true" /><span>{label}</span></li>;
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
