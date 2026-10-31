"use client";

import { useMemo, useState } from "react";
import { Badge, Surface, cx } from "@/app/components/ui";
import { ProofNetworkGraph } from "./ProofNetworkGraph";
import {
  versionById,
  type LeanAnchor,
  type LeanStructureData,
  type LeanSubsystem,
  type ProofEvolutionData,
  type ProofStep,
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
    <div className="lean-structure-stats" aria-label="Lean structure summary">
      <Stat label="Upstream modules" value={lean.summary.oaiModules.toLocaleString("en-US")} detail={`${lean.topLevelModules.length} direct from Main.lean`} />
      <Stat label="Lines" value={lean.summary.totalLines.toLocaleString("en-US")} detail="fetched source" />
      <Stat label="Declarations" value={lean.summary.declarations.toLocaleString("en-US")} detail="theorem / lemma / def / structure" />
      <Stat label="Sorry / axiom" value={`${lean.summary.sorry} / ${lean.summary.axioms}`} detail="textual scan, not kernel audit" />
      <Stat label="External imports" value={lean.summary.mathlibImports.toLocaleString("en-US")} detail="unique Mathlib modules" />
    </div>

    <div className="lean-version-strip" aria-label="Select a proof version">
      <span className="lean-structure-eyebrow">Proof version</span>
      {primaryVersions.map((version) => <button
        type="button"
        key={version.id}
        className={cx("lean-version-chip", version.id === selectedVersion.id && "is-selected")}
        aria-pressed={version.id === selectedVersion.id}
        onClick={() => onSelectVersion(version.id)}
      >
        <strong>{version.label}</strong>
        <small>{version.pages} pp · {version.lean.status === "formalized_upstream" ? "Lean" : "no Lean"}</small>
      </button>)}
    </div>

    {!isFormalizedRoute && <div className="lean-mapping-banner">
      <Badge tone="warning">No Lean mapping</Badge>
      <p>The fetched Lean closure follows the OpenAI 9-page route. Select OpenAI to see the step-to-module alignment; the right column remains the actual upstream Lean structure.</p>
    </div>}

    <div className="lean-view-toggle" aria-label="Graph view">
      <span className="lean-structure-eyebrow">Graph view</span>
      <button type="button" className={cx("lean-view-button", view === "network" && "is-selected")} aria-pressed={view === "network"} onClick={() => setView("network")}>Network</button>
      <button type="button" className={cx("lean-view-button", view === "layers" && "is-selected")} aria-pressed={view === "layers"} onClick={() => setView("layers")}>Layered</button>
      <span className="lean-view-note">Force-directed network or fixed layered reading.</span>
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
    <div className="lean-combined-scroll" tabIndex={0} aria-label="Combined proof and Lean structure graph">
      <div className="lean-combined-graph" style={{ width: GRAPH_WIDTH, height: graphHeight }}>
        <div className="lean-graph-label is-left" style={{ left: LEFT_X, top: 18 }}>
          <span>Proof chain</span>
          <strong>{selectedVersion.label} · {selectedVersion.pages} pp</strong>
        </div>
        <div className="lean-graph-label is-right" style={{ left: RIGHT_X, top: 18 }}>
          <span>Lean structure</span>
          <strong>{lean.summary.oaiModules} modules · {subsystems.length} subsystems shown</strong>
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
              <title>{`${edge.from} imports ${edge.to}: ${edge.count} modules`}</title>
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
              <title>{`${step.label} → ${primary}: ${alignment.confidence}`}</title>
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
            <span className="lean-node-top"><span>{step.kind}</span>{alignment ? <span className="lean-align-dot" aria-label="has Lean alignment" /> : <span className="lean-no-align">no Lean</span>}</span>
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
            <span className="lean-node-top"><span>subsystem</span><span>{subsystem.moduleCount} mod</span></span>
            <strong>{subsystem.label}</strong>
            <small>{subsystem.lines.toLocaleString("en-US")} lines · {subsystem.declarations} decls</small>
          </button>;
        })}
      </div>
    </div>
    )}

    <div className="lean-selection-grid">
      <Surface tone="card" className="lean-selection-card">
        <span className="lean-structure-eyebrow">Selected paper step</span>
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
          </> : <p className="lean-selection-note">No Lean alignment is recorded for this version. The formalized route is OpenAI&apos;s interpolation-determinant proof; switch to OpenAI to inspect it.</p>}
        </> : <p className="lean-selection-note">This version has no proof steps in the dataset.</p>}
      </Surface>

      <Surface tone="card" className="lean-selection-card">
        <span className="lean-structure-eyebrow">Selected Lean subsystem</span>
        {selectedSubsystem ? <>
          <h3>{selectedSubsystem.label}</h3>
          <p>{selectedSubsystem.moduleCount} modules · {selectedSubsystem.lines.toLocaleString("en-US")} lines · {selectedSubsystem.declarations.toLocaleString("en-US")} declarations.</p>
          <div className="lean-module-mini-list">
            {selectedSubsystem.modules.slice(0, 7).map((id) => {
              const moduleInfo = moduleById.get(id);
              return moduleInfo ? <a key={id} href={moduleInfo.url} target="_blank" rel="noreferrer">
                <code>{shortModule(id)}</code>
                <span>{moduleInfo.lines} lines · {moduleInfo.declarations} decls</span>
              </a> : null;
            })}
          </div>
          <p className="lean-selection-note">Open the module explorer below for all {selectedSubsystem.moduleCount} modules and their import counts.</p>
        </> : <p className="lean-selection-note">No subsystem selected.</p>}
      </Surface>
    </div>

    <section className="lean-subsection" aria-labelledby="lean-explorer-title">
      <div className="lean-subsection-heading">
        <span className="lean-structure-eyebrow">Actual structure</span>
        <h3 id="lean-explorer-title">Module explorer</h3>
        <p>Every subsystem below is derived from the fetched import closure. Expand a subsystem to see its modules, line counts, declaration counts, and source links.</p>
      </div>
      <div className="lean-explorer-grid">
        {subsystems.map((subsystem) => <details className="lean-subsystem-card" key={subsystem.id}>
          <summary>
            <div>
              <strong>{subsystem.label}</strong>
              <span>{subsystem.moduleCount} modules · {subsystem.lines.toLocaleString("en-US")} lines · {subsystem.declarations.toLocaleString("en-US")} declarations</span>
            </div>
            <span className="lean-import-summary">{topImports(subsystem, lean)}</span>
          </summary>
          <div className="lean-module-list">
            {subsystem.modules.map((id) => {
              const moduleInfo = moduleById.get(id);
              return moduleInfo ? <div className="lean-module-row" key={id}>
                <code>{shortModule(id)}</code>
                <span>{moduleInfo.lines} lines</span>
                <span>{moduleInfo.declarations} decls</span>
                <span>{moduleInfo.importsOai} OAI imports</span>
                <a href={moduleInfo.url} target="_blank" rel="noreferrer">source ↗</a>
              </div> : null;
            })}
          </div>
        </details>)}
        <details className="lean-subsystem-card lean-main-card">
          <summary>
            <div>
              <strong>Main.lean</strong>
              <span>{lean.topLevelModules.length} direct imports · root module</span>
            </div>
            <span className="lean-import-summary">entry point</span>
          </summary>
          <div className="lean-module-list">
            {lean.topLevelModules.map((id) => {
              const moduleInfo = moduleById.get(id);
              return moduleInfo ? <div className="lean-module-row" key={id}>
                <code>{shortModule(id)}</code>
                <span>{moduleInfo.lines} lines</span>
                <span>{moduleInfo.declarations} decls</span>
                <span>{moduleInfo.subsystem}</span>
                <a href={moduleInfo.url} target="_blank" rel="noreferrer">source ↗</a>
              </div> : null;
            })}
          </div>
        </details>
      </div>
      <div className="lean-external-card">
        <div>
          <span className="lean-structure-eyebrow">External libraries</span>
          <h4>{lean.externalImports.mathlibCount} Mathlib modules + {lean.externalImports.pnt.length} PNT import</h4>
          <p>The closure imports {lean.externalImports.mathlibCount} unique Mathlib modules. The external <code>{lean.externalImports.pnt[0] ?? "PrimeNumberTheoremAnd"}</code> module was not fetched (404 at the pinned path); it is counted as external, not as part of the 306-module OAI closure.</p>
        </div>
        <div className="lean-prefix-list">
          {lean.externalImports.mathlibPrefixes.slice(0, 8).map((prefix) => <span key={prefix.prefix}><code>{prefix.prefix}</code> {prefix.count}</span>)}
        </div>
      </div>
    </section>

    <section className="lean-subsection" aria-labelledby="lean-anchors-title">
      <div className="lean-subsection-heading">
        <span className="lean-structure-eyebrow">Declaration anchors</span>
        <h3 id="lean-anchors-title">From the paper steps to the actual Lean declarations</h3>
        <p>These are source-located declarations, not a kernel dependency trace. The final theorem calls W50 and W22 directly; the other anchors mark the closest named declarations for the paper&apos;s main lemmas.</p>
      </div>
      <div className="lean-table-scroll" tabIndex={0} aria-label="Lean declaration anchors">
        <table className="lean-anchor-table">
          <thead><tr><th scope="col">Role</th><th scope="col">Declaration</th><th scope="col">Module / line</th><th scope="col">Paper step</th></tr></thead>
          <tbody>
            {lean.anchors.map((anchor) => <tr key={anchor.id}>
              <th scope="row">{anchor.role}</th>
              <td><code>{anchor.fullName}</code><span>{anchor.kind}</span></td>
              <td>{anchor.module ? <a href={anchor.url ?? "#"} target="_blank" rel="noreferrer">{shortModule(anchor.module)}:{anchor.line} ↗</a> : <span>Not located</span>}<small>{anchor.note}</small></td>
              <td>{stepLabel(openai, anchor.paperStepId)}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <section className="lean-subsection" aria-labelledby="lean-alignment-title">
      <div className="lean-subsection-heading">
        <span className="lean-structure-eyebrow">Paper ↔ Lean alignment</span>
        <h3 id="lean-alignment-title">Where each OpenAI step lands</h3>
        <p>Source-anchored rows are backed by a located declaration; inferred rows are curatorial hypotheses based on module names and nearby lemmas. None of these is a verified line-by-line mapping.</p>
      </div>
      <div className="lean-table-scroll" tabIndex={0} aria-label="Paper to Lean alignment">
        <table className="lean-alignment-table">
          <thead><tr><th scope="col">OpenAI step</th><th scope="col">Confidence</th><th scope="col">Lean subsystems</th><th scope="col">Anchors / note</th></tr></thead>
          <tbody>
            {lean.paperAlignments.map((alignment) => <tr key={alignment.stepId}>
              <th scope="row">{stepLabel(openai, alignment.stepId)}</th>
              <td><Badge tone={alignment.confidence === "source-anchored" ? "positive" : "warning"}>{alignment.confidence}</Badge></td>
              <td>{alignment.subsystems.map((id) => <Badge key={id}>{id}</Badge>)}</td>
              <td><span>{alignment.anchors.map((id) => anchorById.get(id)?.declaration).filter(Boolean).join(" · ") || "No anchor"}</span><small>{alignment.note}</small></td>
            </tr>)}
          </tbody>
        </table>
      </div>
    </section>

    <div className="lean-structure-caveat">
      <strong>What this view is, and is not</strong>
      <ul>{lean.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
      <p>Pinned source: <code>{lean.commit.slice(0, 12)}</code> · root <code>{lean.root}</code> · {lean.summary.fetchedModules} modules fetched.</p>
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

function topImports(subsystem: LeanSubsystem, lean: LeanStructureData) {
  const imports = lean.subsystemEdges
    .filter((edge) => edge.from === subsystem.id && edge.to !== subsystem.id)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  return imports.length > 0 ? `imports ${imports.map((edge) => `${edge.to} (${edge.count})`).join(", ")}` : "no cross-subsystem imports";
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
