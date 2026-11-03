"use client";

import { useMemo, useState } from "react";
import { Badge, Surface, cx } from "@/app/components/ui";
import { useI18n } from "@/app/i18n/client";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import { ProofNetworkGraph } from "./ProofNetworkGraph";
import {
  versionById,
  type LeanAnchor,
  type LeanStructureData,
  type LeanSubsystem,
  type ProofEvolutionData,
  type ProofStep,
  type ProofStepKind,
  type ProofVersion,
} from "@/app/lib/proof-evolution";

const STEP_W = 210;
const STEP_H = 68;
const SUBSYS_W = 220;
const SUBSYS_H = 64;
const LEFT_X = 24;
const RIGHT_X = 720;
const TOP = 64;
const STEP_ROW = 84;
const SUBSYS_ROW = 76;
const GRAPH_WIDTH = 980;

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

const primaryVersionIds = ["openai-2026-10-01", "banks-2026-10-11", "kerr-2026-10-15", "green-2026-10-17", "barreto-2026-10-19"];

function shortModule(id: string) {
  return id.replace(/^OAI\.NumberTheory\.SiegelZeros\./, "").replace(/^OAI\.NumberTheory\./, "");
}

function shortSubsystem(id: string) {
  return id;
}

function stepLabel(version: ProofVersion, stepId: string) {
  return version.proofSteps.find((step) => step.id === stepId)?.label ?? stepId;
}

function orderedSteps(steps: ProofStep[]) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const layers = new Map<string, number>();
  const resolve = (id: string, stack: Set<string>): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    const step = byId.get(id);
    const deps = step?.dependsOn ?? [];
    const layer = deps.length === 0 ? 0 : Math.max(...deps.map((dep) => resolve(dep, stack))) + 1;
    stack.delete(id);
    layers.set(id, layer);
    return layer;
  };
  for (const step of steps) resolve(step.id, new Set());
  const groups: ProofStep[][] = [];
  for (const step of steps) {
    const layer = layers.get(step.id) ?? 0;
    (groups[layer] ??= []).push(step);
  }
  return groups.flat();
}

export function LeanStructureView({ data, lean, selectedVersion, onSelectVersion }: {
  data: ProofEvolutionData;
  lean: LeanStructureData;
  selectedVersion: ProofVersion;
  onSelectVersion: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const [selectedStepId, setSelectedStepId] = useState("prime-bias");
  const [selectedSubsystemId, setSelectedSubsystemId] = useState("Characters");
  const [view, setView] = useState<"network" | "layers">("network");

  const openai = versionById(data, lean.formalizedVersionId) ?? data.versions[0];
  const primaryVersions = primaryVersionIds
    .map((id) => versionById(data, id))
    .filter((version): version is ProofVersion => Boolean(version));
  const subsystems = useMemo(
    () => lean.subsystems.filter((subsystem) => subsystem.id !== "Main" && subsystem.id !== "Model").sort((a, b) => b.moduleCount - a.moduleCount),
    [lean.subsystems],
  );
  const moduleById = new Map(lean.modules.map((module) => [module.id, module]));
  const anchorById = new Map(lean.anchors.map((anchor) => [anchor.id, anchor]));
  const alignments = lean.paperAlignments.filter((alignment) => alignment.versionId === selectedVersion.id);
  const alignmentByStep = new Map(alignments.map((alignment) => [alignment.stepId, alignment]));
  const steps = orderedSteps(selectedVersion.proofSteps);
  const selectedStep = selectedVersion.proofSteps.find((step) => step.id === selectedStepId) ?? selectedVersion.proofSteps[0];
  const selectedAlignment = selectedStep ? alignmentByStep.get(selectedStep.id) : undefined;
  const selectedSubsystem = subsystems.find((subsystem) => subsystem.id === selectedSubsystemId) ?? subsystems[0];
  const graphHeight = Math.max(TOP + steps.length * STEP_ROW, TOP + subsystems.length * SUBSYS_ROW) + 36;
  const stepPositions = new Map(steps.map((step, index) => [step.id, { x: LEFT_X, y: TOP + index * STEP_ROW }]));
  const subsystemPositions = new Map(subsystems.map((subsystem, index) => [subsystem.id, { x: RIGHT_X, y: TOP + index * SUBSYS_ROW }]));
  const visibleSubsystemIds = new Set(subsystems.map((subsystem) => subsystem.id));
  const importEdges = [...lean.subsystemEdges]
    .filter((edge) => edge.from !== edge.to && visibleSubsystemIds.has(edge.from) && visibleSubsystemIds.has(edge.to))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const isFormalizedRoute = selectedVersion.id === lean.formalizedVersionId;

  if (!openai || !selectedSubsystem) return null;

  const chooseStep = (stepId: string) => {
    setSelectedStepId(stepId);
    const alignment = alignmentByStep.get(stepId);
    const primary = alignment?.subsystems.find((id) => subsystems.some((subsystem) => subsystem.id === id));
    if (primary) setSelectedSubsystemId(primary);
  };

  return <div className="lean-structure-view">
    <div className="lean-structure-stats" aria-label={t("proofMaps.lean.statsAria")}>
      <Stat label={t("proofMaps.lean.statModules")} value={lean.summary.oaiModules.toLocaleString(locale)} detail={t("proofMaps.lean.statModulesDetail", { count: lean.topLevelModules.length })} />
      <Stat label={t("proofMaps.lean.statLines")} value={lean.summary.totalLines.toLocaleString(locale)} detail={t("proofMaps.lean.statLinesDetail")} />
      <Stat label={t("proofMaps.lean.statDeclarations")} value={lean.summary.declarations.toLocaleString(locale)} detail={t("proofMaps.lean.statDeclarationsDetail")} />
      <Stat label={t("proofMaps.lean.statSorryAxiom")} value={`${lean.summary.sorry} / ${lean.summary.axioms}`} detail={t("proofMaps.lean.statSorryAxiomDetail")} />
      <Stat label={t("proofMaps.lean.statExternal")} value={lean.summary.mathlibImports.toLocaleString(locale)} detail={t("proofMaps.lean.statExternalDetail")} />
    </div>

    <div className="lean-version-strip" aria-label={t("proofMaps.lean.versionStripAria")}>
      <span className="lean-structure-eyebrow">{t("proofMaps.lean.proofVersion")}</span>
      {primaryVersions.map((version) => <button
        type="button"
        key={version.id}
        className={cx("lean-version-chip", version.id === selectedVersion.id && "is-selected")}
        aria-pressed={version.id === selectedVersion.id}
        onClick={() => onSelectVersion(version.id)}
      >
        <strong>{version.label}</strong>
        <small>{t("proofMaps.evolution.pages", { count: version.pages })} · {version.lean.status === "formalized_upstream" ? t("proofMaps.evolution.lean") : t("proofMaps.lean.noLeanShort")}</small>
      </button>)}
    </div>

    {!isFormalizedRoute && <div className="lean-mapping-banner">
      <Badge tone="warning">{t("proofMaps.lean.noMapping")}</Badge>
      <p>{t("proofMaps.lean.noMappingBody")}</p>
    </div>}

    <div className="lean-view-toggle" aria-label={t("proofMaps.lean.viewAria")}>
      <span className="lean-structure-eyebrow">{t("proofMaps.lean.viewAria")}</span>
      <button type="button" className={cx("lean-view-button", view === "network" && "is-selected")} aria-pressed={view === "network"} onClick={() => setView("network")}>{t("proofMaps.lean.network")}</button>
      <button type="button" className={cx("lean-view-button", view === "layers" && "is-selected")} aria-pressed={view === "layers"} onClick={() => setView("layers")}>{t("proofMaps.lean.layered")}</button>
      <span className="lean-view-note">{t("proofMaps.lean.viewNote")}</span>
    </div>
    {view === "network" ? <ProofNetworkGraph
      data={data}
      lean={lean}
      selectedVersion={selectedVersion}
      selectedStepId={selectedStep?.id}
      selectedSubsystemId={selectedSubsystem.id}
      onSelectVersion={onSelectVersion}
      onSelectStep={chooseStep}
      onSelectSubsystem={setSelectedSubsystemId}
    /> : (
    <div className="lean-combined-scroll" tabIndex={0} aria-label={t("proofMaps.lean.combinedAria")}>
      <div className="lean-combined-graph" style={{ width: GRAPH_WIDTH, height: graphHeight }}>
        <div className="lean-graph-label is-left" style={{ left: LEFT_X, top: 18 }}>
          <span>{t("proofMaps.lean.proofChain")}</span>
          <strong>{t("proofMaps.lean.proofChainMeta", { label: selectedVersion.label, pages: selectedVersion.pages })}</strong>
        </div>
        <div className="lean-graph-label is-right" style={{ left: RIGHT_X, top: 18 }}>
          <span>{t("proofMaps.lean.leanStructureLabel")}</span>
          <strong>{t("proofMaps.lean.leanStructureMeta", { modules: lean.summary.oaiModules.toLocaleString(locale), subsystems: subsystems.length })}</strong>
        </div>
        <svg className="lean-combined-edges" viewBox={`0 0 ${GRAPH_WIDTH} ${graphHeight}`} aria-hidden="true">
          <defs>
            <marker id="lean-combined-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#718096" />
            </marker>
          </defs>
          {steps.flatMap((step) => step.dependsOn.flatMap((dependency) => {
            const from = stepPositions.get(dependency);
            const to = stepPositions.get(step.id);
            if (!from || !to) return [];
            return [<path key={`step-${dependency}-${step.id}`} d={stepPath(from, to)} className="lean-combined-step-edge" markerEnd="url(#lean-combined-arrow)" />];
          }))}
          {importEdges.map((edge) => {
            const from = subsystemPositions.get(edge.from);
            const to = subsystemPositions.get(edge.to);
            if (!from || !to) return null;
            return <path key={`import-${edge.from}-${edge.to}`} d={subsystemPath(from, to)} className="lean-combined-import-edge" markerEnd="url(#lean-combined-arrow)">
              <title>{t("proofMaps.lean.importsTitle", { from: edge.from, to: edge.to, count: edge.count })}</title>
            </path>;
          })}
          {isFormalizedRoute && steps.flatMap((step) => {
            const alignment = alignmentByStep.get(step.id);
            if (!alignment) return [];
            const from = stepPositions.get(step.id);
            const primary = alignment.subsystems.find((id) => subsystemPositions.has(id));
            const to = primary ? subsystemPositions.get(primary) : undefined;
            if (!from || !to) return [];
            return [<path
              key={`align-${step.id}`}
              d={alignmentPath(from, to)}
              className={cx("lean-combined-align-edge", `is-${alignment.confidence}`, selectedStep?.id === step.id && "is-highlighted")}
              markerEnd="url(#lean-combined-arrow)"
            >
              <title>{t("proofMaps.lean.alignmentTitle", { step: step.label, subsystem: primary ?? "", confidence: alignment.confidence })}</title>
            </path>];
          })}
        </svg>

        {steps.map((step) => {
          const position = stepPositions.get(step.id);
          if (!position) return null;
          const alignment = alignmentByStep.get(step.id);
          return <button
            type="button"
            key={step.id}
            className={cx("lean-step-node", `kind-${step.kind}`, selectedStep?.id === step.id && "is-selected", alignment ? "has-alignment" : "no-alignment")}
            style={{ left: position.x, top: position.y, width: STEP_W, height: STEP_H }}
            aria-pressed={selectedStep?.id === step.id}
            onClick={() => chooseStep(step.id)}
          >
            <span className="lean-node-top"><span>{kindKeys[step.kind] ? t(kindKeys[step.kind]) : step.kind}</span>{alignment ? <span className="lean-align-dot" aria-label={t("proofMaps.lean.hasAlignment")} /> : <span className="lean-no-align">{t("proofMaps.lean.noLeanShort")}</span>}</span>
            <strong>{step.label}</strong>
            <small>{step.source}</small>
          </button>;
        })}

        {subsystems.map((subsystem) => {
          const position = subsystemPositions.get(subsystem.id);
          if (!position) return null;
          const highlighted = selectedAlignment?.subsystems.includes(subsystem.id);
          return <button
            type="button"
            key={subsystem.id}
            className={cx("lean-subsystem-node", selectedSubsystem.id === subsystem.id && "is-selected", highlighted && "is-aligned")}
            style={{ left: position.x, top: position.y, width: SUBSYS_W, height: SUBSYS_H }}
            aria-pressed={selectedSubsystem.id === subsystem.id}
            onClick={() => setSelectedSubsystemId(subsystem.id)}
          >
            <span className="lean-node-top"><span>{t("proofMaps.lean.subsystem")}</span><span>{t("proofMaps.lean.moduleShort", { count: subsystem.moduleCount })}</span></span>
            <strong>{subsystem.label}</strong>
            <small>{t("proofMaps.lean.subsystemMeta", { lines: subsystem.lines.toLocaleString(locale), decls: subsystem.declarations.toLocaleString(locale) })}</small>
          </button>;
        })}
      </div>
    </div>
    )}

    <div className="lean-selection-grid">
      <Surface tone="card" className="lean-selection-card">
        <span className="lean-structure-eyebrow">{t("proofMaps.lean.selectedPaperStep")}</span>
        {selectedStep ? <>
          <h3>{selectedStep.label}</h3>
          <p>{selectedStep.detail}</p>
          {selectedAlignment ? <>
            <div className="lean-selection-badges">
              <Badge tone={selectedAlignment.confidence === "source-anchored" ? "positive" : "warning"}>{selectedAlignment.confidence}</Badge>
              {selectedAlignment.subsystems.map((id) => <Badge key={id}>{shortSubsystem(id)}</Badge>)}
            </div>
            <div className="lean-anchor-list">
              {selectedAlignment.anchors.map((id) => {
                const anchor = anchorById.get(id);
                return anchor ? <AnchorRow anchor={anchor} key={id} paperVersion={openai} /> : null;
              })}
            </div>
            <p className="lean-selection-note">{selectedAlignment.note}</p>
          </> : <p className="lean-selection-note">{t("proofMaps.lean.noAlignmentForVersion")}</p>}
        </> : <p className="lean-selection-note">{t("proofMaps.lean.noSteps")}</p>}
      </Surface>

      <Surface tone="card" className="lean-selection-card">
        <span className="lean-structure-eyebrow">{t("proofMaps.lean.selectedSubsystem")}</span>
        {selectedSubsystem ? <>
          <h3>{selectedSubsystem.label}</h3>
          <p>{t("proofMaps.lean.subsystemSummary", { modules: selectedSubsystem.moduleCount.toLocaleString(locale), lines: selectedSubsystem.lines.toLocaleString(locale), declarations: selectedSubsystem.declarations.toLocaleString(locale) })}</p>
          <div className="lean-module-mini-list">
            {selectedSubsystem.modules.slice(0, 7).map((id) => {
              const moduleInfo = moduleById.get(id);
              return moduleInfo ? <a key={id} href={moduleInfo.url} target="_blank" rel="noreferrer">
                <code>{shortModule(id)}</code>
                <span>{t("proofMaps.lean.subsystemMeta", { lines: moduleInfo.lines.toLocaleString(locale), decls: moduleInfo.declarations.toLocaleString(locale) })}</span>
              </a> : null;
            })}
          </div>
          <p className="lean-selection-note">{t("proofMaps.lean.explorerHint", { count: selectedSubsystem.moduleCount })}</p>
        </> : <p className="lean-selection-note">{t("proofMaps.lean.noSubsystem")}</p>}
      </Surface>
    </div>

    <section className="lean-subsection" aria-labelledby="lean-explorer-title">
      <div className="lean-subsection-heading">
        <span className="lean-structure-eyebrow">{t("proofMaps.lean.actualStructure")}</span>
        <h3 id="lean-explorer-title">{t("proofMaps.lean.explorerTitle")}</h3>
        <p>{t("proofMaps.lean.explorerBody")}</p>
      </div>
      <div className="lean-explorer-grid">
        {subsystems.map((subsystem) => <details className="lean-subsystem-card" key={subsystem.id}>
          <summary>
            <div>
              <strong>{subsystem.label}</strong>
              <span>{t("proofMaps.lean.subsystemSummary", { modules: subsystem.moduleCount.toLocaleString(locale), lines: subsystem.lines.toLocaleString(locale), declarations: subsystem.declarations.toLocaleString(locale) })}</span>
            </div>
            <span className="lean-import-summary">{topImports(subsystem, lean, t)}</span>
          </summary>
          <div className="lean-module-list">
            {subsystem.modules.map((id) => {
              const moduleInfo = moduleById.get(id);
              return moduleInfo ? <div className="lean-module-row" key={id}>
                <code>{shortModule(id)}</code>
                <span>{t("proofMaps.lean.moduleLines", { count: moduleInfo.lines.toLocaleString(locale) })}</span>
                <span>{t("proofMaps.lean.moduleDecls", { count: moduleInfo.declarations.toLocaleString(locale) })}</span>
                <span>{t("proofMaps.lean.moduleImports", { count: moduleInfo.importsOai.toLocaleString(locale) })}</span>
                <a href={moduleInfo.url} target="_blank" rel="noreferrer">{t("proofMaps.lean.sourceLink")}</a>
              </div> : null;
            })}
          </div>
        </details>)}
        <details className="lean-subsystem-card lean-main-card">
          <summary>
            <div>
              <strong>{t("proofMaps.lean.mainEntry")}</strong>
              <span>{t("proofMaps.lean.mainMeta", { count: lean.topLevelModules.length })}</span>
            </div>
            <span className="lean-import-summary">{t("proofMaps.lean.entryPoint")}</span>
          </summary>
          <div className="lean-module-list">
            {lean.topLevelModules.map((id) => {
              const moduleInfo = moduleById.get(id);
              return moduleInfo ? <div className="lean-module-row" key={id}>
                <code>{shortModule(id)}</code>
                <span>{t("proofMaps.lean.moduleLines", { count: moduleInfo.lines.toLocaleString(locale) })}</span>
                <span>{t("proofMaps.lean.moduleDecls", { count: moduleInfo.declarations.toLocaleString(locale) })}</span>
                <span>{moduleInfo.subsystem}</span>
                <a href={moduleInfo.url} target="_blank" rel="noreferrer">{t("proofMaps.lean.sourceLink")}</a>
              </div> : null;
            })}
          </div>
        </details>
      </div>
      <div className="lean-external-card">
        <div>
          <span className="lean-structure-eyebrow">{t("proofMaps.lean.externalLibraries")}</span>
          <h4>{t("proofMaps.lean.externalTitle", { mathlib: lean.externalImports.mathlibCount.toLocaleString(locale), pnt: lean.externalImports.pnt.length })}</h4>
          <p>{t("proofMaps.lean.externalBodyA", { mathlib: lean.externalImports.mathlibCount.toLocaleString(locale) })}<code>{lean.externalImports.pnt[0] ?? "PrimeNumberTheoremAnd"}</code>{t("proofMaps.lean.externalBodyB")}</p>
        </div>
        <div className="lean-prefix-list">
          {lean.externalImports.mathlibPrefixes.slice(0, 8).map((prefix) => <span key={prefix.prefix}><code>{prefix.prefix}</code> {prefix.count}</span>)}
        </div>
      </div>
    </section>

    <section className="lean-subsection" aria-labelledby="lean-anchors-title">
      <div className="lean-subsection-heading">
        <span className="lean-structure-eyebrow">{t("proofMaps.lean.anchorsEyebrow")}</span>
        <h3 id="lean-anchors-title">{t("proofMaps.lean.anchorsTitle")}</h3>
        <p>{t("proofMaps.lean.anchorsBody")}</p>
      </div>
      <div className="lean-table-scroll" tabIndex={0} aria-label={t("proofMaps.lean.anchorsAria")}>
        <table className="lean-anchor-table">
          <thead><tr><th scope="col">{t("proofMaps.lean.colRole")}</th><th scope="col">{t("proofMaps.lean.colDeclaration")}</th><th scope="col">{t("proofMaps.lean.colModuleLine")}</th><th scope="col">{t("proofMaps.lean.colPaperStep")}</th></tr></thead>
          <tbody>
            {lean.anchors.map((anchor) => <tr key={anchor.id}>
              <th scope="row">{anchor.role}</th>
              <td><code>{anchor.fullName}</code><span>{anchor.kind}</span></td>
              <td>{anchor.module ? <a href={anchor.url ?? "#"} target="_blank" rel="noreferrer">{shortModule(anchor.module)}:{anchor.line} ↗</a> : <span>{t("proofMaps.lean.notLocated")}</span>}<small>{anchor.note}</small></td>
              <td>{stepLabel(openai, anchor.paperStepId)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="lean-subsection" aria-labelledby="lean-alignment-title">
      <div className="lean-subsection-heading">
        <span className="lean-structure-eyebrow">{t("proofMaps.lean.alignmentEyebrow")}</span>
        <h3 id="lean-alignment-title">{t("proofMaps.lean.alignmentHeading")}</h3>
        <p>{t("proofMaps.lean.alignmentBody")}</p>
      </div>
      <div className="lean-table-scroll" tabIndex={0} aria-label={t("proofMaps.lean.alignmentAria")}>
        <table className="lean-alignment-table">
          <thead><tr><th scope="col">{t("proofMaps.lean.colOpenAiStep")}</th><th scope="col">{t("proofMaps.lean.colConfidence")}</th><th scope="col">{t("proofMaps.lean.colLeanSubsystems")}</th><th scope="col">{t("proofMaps.lean.colAnchorsNote")}</th></tr></thead>
          <tbody>
            {lean.paperAlignments.map((alignment) => <tr key={alignment.stepId}>
              <th scope="row">{stepLabel(openai, alignment.stepId)}</th>
              <td><Badge tone={alignment.confidence === "source-anchored" ? "positive" : "warning"}>{alignment.confidence}</Badge></td>
              <td>{alignment.subsystems.map((id) => <Badge key={id}>{id}</Badge>)}</td>
              <td><span>{alignment.anchors.map((id) => anchorById.get(id)?.declaration).filter(Boolean).join(" · ") || t("proofMaps.lean.noAnchor")}</span><small>{alignment.note}</small></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <div className="lean-structure-caveat">
      <strong>{t("proofMaps.lean.caveatTitle")}</strong>
      <ul>{lean.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
      <p>{t("proofMaps.lean.pinnedSourceA")}<code>{lean.commit.slice(0, 12)}</code>{t("proofMaps.lean.pinnedSourceB")}<code>{lean.root}</code>{t("proofMaps.lean.pinnedSourceC", { modules: lean.summary.fetchedModules.toLocaleString(locale) })}</p>
    </div>
  </div>;
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="lean-stat"><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function AnchorRow({ anchor, paperVersion }: { anchor: LeanAnchor; paperVersion: ProofVersion }) {
  return <div className="lean-anchor-row">
    <div><strong>{anchor.role}</strong><span>{stepLabel(paperVersion, anchor.paperStepId)}</span></div>
    <code>{anchor.fullName}</code>
    {anchor.module && <a href={anchor.url ?? "#"} target="_blank" rel="noreferrer">{shortModule(anchor.module)}:{anchor.line} ↗</a>}
  </div>;
}

function topImports(subsystem: LeanSubsystem, lean: LeanStructureData, t: Translator) {
  const imports = lean.subsystemEdges
    .filter((edge) => edge.from === subsystem.id && edge.to !== subsystem.id)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return imports.length > 0
    ? t("proofMaps.lean.topImports", { list: imports.map((edge) => `${edge.to} (${edge.count})`).join(", ") })
    : t("proofMaps.lean.noImports");
}

function stepPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const x = from.x + STEP_W / 2;
  const y1 = from.y + STEP_H;
  const y2 = to.y;
  return `M ${x} ${y1} C ${x + 34} ${y1 + 20}, ${x - 34} ${y2 - 20}, ${x} ${y2}`;
}

function subsystemPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const x = from.x + SUBSYS_W / 2;
  const y1 = from.y + SUBSYS_H;
  const y2 = to.y;
  return `M ${x} ${y1} C ${x + 30} ${y1 + 18}, ${x - 30} ${y2 - 18}, ${x} ${y2}`;
}

function alignmentPath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const x1 = from.x + STEP_W;
  const y1 = from.y + STEP_H / 2;
  const x2 = to.x;
  const y2 = to.y + SUBSYS_H / 2;
  const dx = (x2 - x1) * 0.48;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
