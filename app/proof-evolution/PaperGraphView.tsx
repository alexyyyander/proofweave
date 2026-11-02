"use client";

import { useMemo } from "react";
import { ArgumentMapView } from "./landau-siegel/ArgumentMapView";
import type { PaperStructure } from "@/app/lib/proof-map";
import type { ArgumentMapData, LeanStructureData, ProofEvolutionData, ProofStepKind } from "@/app/lib/proof-evolution";
import { useI18n } from "@/app/i18n/client";

/**
 * Render a paper-derived structure with the same matrix/network graph used by
 * curated deep maps. Columns are the paper's sections, lanes are its papers,
 * and edges are the references recorded between statements. The graph never
 * presents those references as verified proof dependencies.
 */
const strategyColors = ["#8b75c9", "#5c8fd6", "#c98b5c", "#5cc9a0"];

function roleId(section: string, index: number) {
  const slug = section.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug || `section-${index + 1}`;
}

function kindOf(kind: string): ProofStepKind {
  if (kind === "theorem" || kind === "lemma" || kind === "corollary") return kind;
  return "assembly";
}

export function PaperGraphView({ structure, claim }: { structure: PaperStructure; claim: string }) {
  const { t } = useI18n();
  const { data, argumentMap, lean } = useMemo(() => {
    const sections = structure.sections.length > 0 ? structure.sections : [t("proofMaps.paper.noSection")];
    const roleIds = new Map<string, string>();
    const roles = sections.slice(0, 30).map((section, index) => {
      const id = roleId(section, index);
      roleIds.set(section, id);
      return { id, label: section, description: t("proofMaps.paper.roleDescription") };
    });
    const fallbackRole = roles[0].id;

    const strategies = structure.manuscripts.map((manuscript, index) => {
      const versionId = `m${index + 1}`;
      const prefix = `m${index + 1}-`;
      const nodes = structure.nodes.filter((node) => node.id.startsWith(prefix));
      const nodeIds = new Set(nodes.map((node) => node.id));
      const dependencies = new Map<string, string[]>();
      for (const edge of structure.edges) {
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
        dependencies.set(edge.to, [...(dependencies.get(edge.to) ?? []), edge.from]);
      }
      return {
        version: {
          id: versionId,
          trackId: "same-theorem",
          label: manuscript.title,
          title: manuscript.title,
          authors: ["OpenAI"],
          date: manuscript.date,
          pages: 0,
          proofSteps: nodes.map((node) => ({
            id: node.id,
            label: node.label,
            kind: kindOf(node.kind),
            detail: node.statement,
            source: node.section ?? manuscript.title,
            dependsOn: dependencies.get(node.id) ?? [],
          })),
        },
        strategy: { versionId, color: strategyColors[index % strategyColors.length], track: "same-theorem" as const, note: manuscript.title },
        nodeRoles: Object.fromEntries(nodes.map((node) => [node.id, roleIds.get(node.section ?? "") ?? fallbackRole])),
        manuscript,
      };
    }).filter((entry) => entry.version.proofSteps.length > 0);

    const finalEdges = strategies.flatMap((entry) => {
      const nodes = entry.version.proofSteps;
      const main = nodes.find((node) => node.kind === "theorem") ?? nodes[nodes.length - 1];
      return main ? [{ from: `${entry.version.id}:${main.id}`, to: "paper-result", type: "proves" as const, label: t("proofMaps.paper.finalEdge") }] : [];
    });

    const data = { versions: strategies.map((entry) => entry.version) } as unknown as ProofEvolutionData;
    const argumentMap: ArgumentMapData = {
      schemaVersion: "pw-argument-map-v1",
      status: "draft",
      reviewStatus: "unreviewed",
      result: {
        id: "paper-result",
        label: structure.familyTitle,
        statement: claim,
        source: t("proofMaps.paper.resultSource"),
        roleNote: t("proofMaps.paper.resultRole"),
      },
      roles,
      strategies: strategies.map((entry) => entry.strategy),
      nodeRoles: Object.assign({}, ...strategies.map((entry) => ({ [entry.version.id]: entry.nodeRoles }))),
      extraNodes: [],
      finalEdges,
      crossEdges: [],
      comparisons: [],
      sharedInputs: [],
      caveats: [],
      summaryNote: t("proofMaps.paper.graphNote"),
      scrollHint: t("proofMaps.paper.graphHint"),
    };
    const lean = {
      paperAlignments: [],
      anchors: [],
      noAlignmentNote: t("proofMaps.paper.noAlignment"),
    } as unknown as LeanStructureData;
    return { data, argumentMap, lean };
  }, [structure, claim, t]);

  return <ArgumentMapView data={data} argumentMap={argumentMap} lean={lean} />;
}
