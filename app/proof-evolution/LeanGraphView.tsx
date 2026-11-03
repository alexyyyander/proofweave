"use client";

import { useMemo } from "react";
import { ArgumentMapView } from "./landau-siegel/ArgumentMapView";
import type { LeanCoverageFamily } from "@/app/lib/proof-map";
import type { ArgumentMapData, LeanStructureData, ProofEvolutionData, ProofStepKind } from "@/app/lib/proof-evolution";
import { useI18n } from "@/app/i18n/client";

/**
 * The same matrix/network graph for Lean-derived families: lanes are the
 * pinned comparators and columns describe their metadata. The names and
 * permitted axioms do not establish proof relationships, so no edges are drawn.
 */
const strategyColors = ["#5c8fd6", "#8b75c9", "#c98b5c", "#5cc9a0", "#b07cc6", "#4fa3a3"];

export function LeanGraphView({ family, claim, date }: { family: LeanCoverageFamily; claim: string; date: string }) {
  const { t } = useI18n();
  const { data, argumentMap, lean } = useMemo(() => {
    const roles = [
      { id: "target", label: t("proofMaps.derived.target"), description: t("proofMaps.derived.targetDetail") },
      { id: "theorems", label: t("proofMaps.derived.theorems"), description: t("proofMaps.derived.theoremsDetail") },
      { id: "axioms", label: t("proofMaps.derived.axioms"), description: t("proofMaps.derived.axiomsDetail") },
    ];

    const strategies = family.comparators.map((comparator, index) => {
      const versionId = `c${index + 1}`;
      const prefix = `${versionId}-`;
      const axiomIds = comparator.permittedAxioms.map((axiom) => `${prefix}axiom-${axiom.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`);
      const theoremIds = comparator.theoremNames.map((name, theoremIndex) => `${prefix}theorem-${theoremIndex + 1}`);
      const proofSteps = [
        {
          id: `${prefix}target`,
          label: comparator.label,
          kind: "assembly" as ProofStepKind,
          detail: t("proofMaps.derived.targetDetail"),
          source: comparator.label,
          dependsOn: [],
        },
        ...comparator.theoremNames.map((name, theoremIndex) => ({
          id: theoremIds[theoremIndex],
          label: name,
          kind: "theorem" as ProofStepKind,
          detail: t("proofMaps.derived.theoremDetail"),
          source: comparator.label,
          dependsOn: [],
        })),
        ...comparator.permittedAxioms.map((axiom, axiomIndex) => ({
          id: axiomIds[axiomIndex],
          label: axiom,
          kind: "external" as ProofStepKind,
          detail: t("proofMaps.derived.axiomDetail"),
          source: comparator.label,
          dependsOn: [],
        })),
      ];
      const nodeRoles: Record<string, string> = {};
      nodeRoles[`${prefix}target`] = "target";
      for (const id of theoremIds) nodeRoles[id] = "theorems";
      for (const id of axiomIds) nodeRoles[id] = "axioms";
      return {
        version: {
          id: versionId,
          trackId: "same-theorem",
          label: comparator.label,
          title: comparator.label,
          authors: ["OpenAI"],
          date,
          pages: 0,
          proofSteps,
        },
        strategy: { versionId, color: strategyColors[index % strategyColors.length], track: "same-theorem" as const, note: comparator.label },
        nodeRoles,
      };
    });

    const finalEdges: ArgumentMapData["finalEdges"] = [];

    const data = { versions: strategies.map((entry) => entry.version) } as unknown as ProofEvolutionData;
    const argumentMap: ArgumentMapData = {
      schemaVersion: "pw-argument-map-v1",
      status: "draft",
      reviewStatus: "unreviewed",
      result: {
        id: "lean-result",
        label: family.familyTitle,
        statement: claim,
        source: t("proofMaps.derived.resultSource"),
        roleNote: t("proofMaps.derived.resultRole"),
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
      summaryNote: t("proofMaps.derived.graphNote"),
      scrollHint: t("proofMaps.derived.graphHint"),
    };
    const lean = {
      paperAlignments: [],
      anchors: [],
      noAlignmentNote: t("proofMaps.derived.noAlignment"),
    } as unknown as LeanStructureData;
    return { data, argumentMap, lean };
  }, [family, claim, date, t]);

  return <ArgumentMapView data={data} argumentMap={argumentMap} lean={lean} />;
}
