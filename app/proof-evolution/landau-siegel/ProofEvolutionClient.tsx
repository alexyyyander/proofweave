"use client";

import { useState } from "react";
import { Badge, CardTitle, Field, FieldList, Surface, cx } from "@/app/components/ui";
import { LeanStructureView } from "./LeanStructureView";
import { ArgumentMapView } from "./ArgumentMapView";
import {
  explicitConstantLabel,
  goalLabel,
  leanStatusLabel,
  ledgerStatusLabel,
  relationLabel,
  trackById,
  versionById,
  versionsForTrack,
  type ArgumentMapData,
  type LeanStructureData,
  type LedgerStatus,
  type LeanStatus,
  type ProofDetailLevel,
  type ProofEvolutionData,
  type ProofStep,
  type ProofVersion,
} from "@/app/lib/proof-evolution";

const VERSION_NODE_WIDTH = 190;
const VERSION_NODE_HEIGHT = 104;
const STEP_NODE_WIDTH = 210;
const STEP_NODE_HEIGHT = 96;
const STEP_COLUMN_WIDTH = 250;
const STEP_ROW_HEIGHT = 118;

const detailLevelLabel: Record<ProofDetailLevel, string> = {
  lemma: "Lemma-level map",
  grouped: "Grouped lemma map",
  summary: "Summary map",
  section: "Section-level map",
};

const detailLevelNote: Record<ProofDetailLevel, string> = {
  lemma: "Nodes are curated at the theorem/lemma level; the linked source remains authoritative.",
  grouped: "Some adjacent lemmas are grouped into one node to keep the map readable.",
  summary: "This is a summary-level map, not a full lemma-by-lemma extraction.",
  section: "This is a section-level map of a longer proof, not a full lemma DAG.",
};

const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return value;
  return `${monthNames[month - 1]} ${day}, ${year}`;
}

function leanTone(status: LeanStatus): "positive" | "neutral" | "warning" {
  if (status === "formalized_upstream") return "positive";
  if (status === "not_separately_formalized") return "neutral";
  return "warning";
}

function ledgerTone(status: LedgerStatus): "positive" | "neutral" | "warning" | "negative" {
  if (status === "used" || status === "explicit") return "positive";
  if (status === "replaced") return "warning";
  if (status === "removed") return "negative";
  return "neutral";
}

export function ProofEvolutionClient({ data, leanStructure, argumentMap }: { data: ProofEvolutionData; leanStructure: LeanStructureData; argumentMap: ArgumentMapData }) {
  const [selectedId, setSelectedId] = useState("barreto-2026-10-19");
  const selected = versionById(data, selectedId) ?? data.versions[0];
  if (!selected) return null;

  return <div className="proof-evolution-content">
    <CaveatPanel caveats={data.caveats} />

    <section id="evolution" className="proof-evolution-section" aria-labelledby="evolution-title">
      <SectionHeading
        id="evolution-title"
        eyebrow="Version lineage"
        title="Two theorem tracks, one simplification story"
        description="Read left to right. Solid edges simplify an argument; dashed edges make constants explicit; dotted edges recombine ideas. The stronger-theorem track is separate: its page counts are not the old version of the 3-page proof."
      />
      <div className="proof-evolution-legend" aria-label="Edge legend">
        <span><i className="proof-legend-line is-simplifies" aria-hidden="true" />Simplifies</span>
        <span><i className="proof-legend-line is-explicitizes" aria-hidden="true" />Explicitizes</span>
        <span><i className="proof-legend-line is-recombines" aria-hidden="true" />Recombines</span>
        <span className="proof-evolution-legend-note">Solid line = same theorem; separated band = stronger theorem</span>
      </div>
      <VersionGraph data={data} selectedId={selected.id} onSelect={setSelectedId} />
      <p className="proof-evolution-graph-note">Scroll the graph horizontally to see all branches. Page counts come from the linked PDFs. Banks is longer because it adds explicit constants, not because it is a less successful simplification. Van Dijk also follows Kerr and Green; Guo is an explicit side branch. Both relations are recorded in the version details.</p>
    </section>

    <section id="argument-map" className="proof-evolution-section" aria-labelledby="argument-map-title">
      <SectionHeading
        id="argument-map-title"
        eyebrow="Theorem dependencies · multiple strategies"
        title="How each proof actually reaches the result"
        description="Each lane is a proof strategy; each column is a mathematical role. Solid edges are proof dependencies; dotted and dashed edges show shared roles, replacements, and bypasses. Select two strategies to see what they share, what one replaces, and where the short route leaves the long route."
      />
      <ArgumentMapView data={data} argumentMap={argumentMap} lean={leanStructure} />
    </section>

    <section id="detail" className="proof-evolution-section" aria-labelledby="detail-title">
      <SectionHeading
        id="detail-title"
        eyebrow="Selected version"
        title="Inside the proof"
        description="Select any version in the lineage to inspect its internal proof map, what it changed, and its Lean status."
      />
      <VersionDetail version={selected} data={data} />
    </section>

    <section id="ledger" className="proof-evolution-section" aria-labelledby="ledger-title">
      <SectionHeading
        id="ledger-title"
        eyebrow="Compression ledger"
        title="What each simplification removed, replaced, or made explicit"
        description="A shorter proof is not just fewer pages. The ledger records which machinery disappears, which tool replaces it, and which versions pay for explicitness."
      />
      <CompressionLedger data={data} />
    </section>

    <section id="lean" className="proof-evolution-section" aria-labelledby="lean-title">
      <SectionHeading
        id="lean-title"
        eyebrow="Lean coverage"
        title="The shortest human proof is not the formalized proof"
        description="The upstream Lean solution follows OpenAI's longer interpolation-determinant route. Barreto's 3-page Wronskian proof has no Lean artifact in this prototype's source set."
      />
      <LeanCoveragePanel data={data} />
    </section>

    <section id="lean-structure" className="proof-evolution-section" aria-labelledby="lean-structure-title">
      <SectionHeading
        id="lean-structure-title"
        eyebrow="Lean structure · source-derived"
        title="What the formalization actually contains"
        description={`The fetched closure contains ${leanStructure.summary.oaiModules.toLocaleString("en-US")} modules, ${leanStructure.summary.totalLines.toLocaleString("en-US")} lines, and ${leanStructure.summary.declarations.toLocaleString("en-US")} declarations. This view combines the proof chain with the real import graph: select a version to see its steps, select a step to see its Lean alignment, and expand a subsystem to inspect the modules.`}
      />
      <LeanStructureView data={data} lean={leanStructure} selectedVersion={selected} onSelectVersion={setSelectedId} />
    </section>

    <section id="sources" className="proof-evolution-section" aria-labelledby="sources-title">
      <SectionHeading
        id="sources-title"
        eyebrow="Sources"
        title="Primary sources and upstream artifacts"
        description="Links point to the papers, the 3-page manuscript, the expositions, and the upstream Lean files. None of these links is a Proofweave verification."
      />
      <SourcesPanel data={data} />
    </section>
  </div>;
}

function CaveatPanel({ caveats }: { caveats: string[] }) {
  return <Surface tone="inset" className="proof-evolution-caveat">
    <div className="proof-evolution-caveat-heading">
      <Badge tone="warning">Draft · unreviewed</Badge>
      <strong>What this prototype is, and is not</strong>
    </div>
    <ul>
      {caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
    </ul>
  </Surface>;
}

function SectionHeading({ id, eyebrow, title, description }: { id: string; eyebrow: string; title: string; description: string }) {
  return <div className="proof-evolution-section-heading">
    <p className="eyebrow">{eyebrow}</p>
    <h2 id={id}>{title}</h2>
    <p>{description}</p>
  </div>;
}

function VersionGraph({ data, selectedId, onSelect }: {
  data: ProofEvolutionData;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const byId = new Map(data.versions.map((version) => [version.id, version]));
  const width = 1200;
  const height = 640;
  return <>
    <div className="proof-evolution-graph-scroll" tabIndex={0} aria-label="Proof evolution graph; select a version to inspect it">
    <div className="proof-evolution-graph" style={{ width, height }}>
      <div className="proof-track-band proof-track-band-stronger" style={{ left: 20, top: 0, width: width - 40, height: 140 }}>
        <span>Stronger theorem · different analytic track</span>
      </div>
      <div className="proof-track-band proof-track-band-same" style={{ left: 20, top: 160, width: width - 40, height: 460 }}>
        <span>Same theorem · Landau–Siegel real-zero gap</span>
      </div>
      <svg className="proof-evolution-edges" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        <defs>
          <marker id="proof-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#718096" />
          </marker>
        </defs>
        {data.versionEdges.filter((edge) => edge.visible !== false).map((edge) => {
          const from = byId.get(edge.from);
          const to = byId.get(edge.to);
          if (!from || !to) return null;
          return <path
            key={`${edge.from}-${edge.to}-${edge.relation}`}
            d={versionEdgePath(from, to)}
            className={cx("proof-edge", `is-${edge.relation}`, edge.secondary && "is-secondary")}
            markerEnd="url(#proof-arrow)"
          >
            <title>{`${from.label} ${relationLabel[edge.relation]} ${to.label}: ${edge.label}`}</title>
          </path>;
        })}
      </svg>
      {data.versions.map((version) => {
        const selected = version.id === selectedId;
        return <button
          key={version.id}
          type="button"
          className={cx("proof-version-node", selected && "is-selected", version.trackId === "stronger-theorem" && "is-stronger")}
          style={{ left: version.layout.x, top: version.layout.y, width: VERSION_NODE_WIDTH, height: VERSION_NODE_HEIGHT }}
          aria-pressed={selected}
          aria-label={`${version.label}: ${version.pages} pages, ${version.method}, ${leanStatusLabel[version.lean.status]}`}
          onClick={() => onSelect(version.id)}
        >
          <span className="proof-version-node-top">
            <span className="proof-version-goal">{version.trackId === "stronger-theorem" ? "Stronger theorem" : goalLabel[version.goal]}</span>
            <span className="proof-version-pages">{version.pages} pp</span>
          </span>
          <strong className="proof-version-node-label">{version.label}</strong>
          <span className="proof-version-node-method">{version.method}</span>
          <span className="proof-version-node-foot">
            <span className={cx("proof-lean-dot", version.lean.status === "formalized_upstream" ? "is-formalized" : "is-missing")} aria-hidden="true" />
            <span>{version.lean.status === "formalized_upstream" ? "Lean" : "No Lean"}</span>
            <span>{formatDate(version.date)}</span>
          </span>
        </button>;
      })}
      </div>
    </div>
    <div className="proof-version-index" aria-label="Version index">
      {data.versions.map((version) => <button
        type="button"
        key={version.id}
        className={cx("proof-version-index-button", version.id === selectedId && "is-selected")}
        aria-pressed={version.id === selectedId}
        onClick={() => onSelect(version.id)}
      >
        <span>{version.label}</span>
        <small>{version.pages} pp · {goalLabel[version.goal]}</small>
      </button>)}
    </div>
  </>;
}

function versionEdgePath(from: ProofVersion, to: ProofVersion) {
  const x1 = from.layout.x + VERSION_NODE_WIDTH;
  const y1 = from.layout.y + VERSION_NODE_HEIGHT / 2;
  const x2 = to.layout.x;
  const y2 = to.layout.y + VERSION_NODE_HEIGHT / 2;
  const dx = Math.max(42, Math.abs(x2 - x1) * 0.38);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function VersionDetail({ version, data }: { version: ProofVersion; data: ProofEvolutionData }) {
  const track = trackById(data, version.trackId);
  return <Surface tone="card" className="proof-evolution-detail">
    <header className="proof-detail-header">
      <div className="proof-detail-heading">
        <p className="eyebrow">{track?.label ?? version.trackId}</p>
        <CardTitle as="h2">{version.label} · {version.title}</CardTitle>
        <p>{version.summary}</p>
      </div>
      <div className="proof-detail-badges">
        <Badge>{version.pages} pages</Badge>
        <Badge tone={leanTone(version.lean.status)}>{leanStatusLabel[version.lean.status]}</Badge>
        <Badge>{goalLabel[version.goal]}</Badge>
      </div>
    </header>

    <div className="proof-detail-layout">
      <div className="proof-detail-graph">
        <div className="proof-detail-subheading">
          <div>
            <span className="proof-detail-label">Internal proof map</span>
            <strong>{detailLevelLabel[version.proofDetail]}</strong>
          </div>
          <Badge tone="neutral">{version.proofSteps.length} nodes</Badge>
        </div>
        <InternalProofGraph version={version} />
        <p className="proof-detail-scroll-hint">Scroll the graph horizontally for the full map; the full step list follows.</p>
        <p className="proof-detail-note">{detailLevelNote[version.proofDetail]}</p>
      </div>

      <aside className="proof-detail-meta">
        <FieldList layout="stacked">
          <Field label="Authors">{version.authors.join(", ")}</Field>
          <Field label="Date">{formatDate(version.date)}{version.releaseDate ? ` · release ${formatDate(version.releaseDate)}` : ""}</Field>
          <Field label="Method">{version.method}</Field>
          <Field label="Field">{version.field}</Field>
          <Field label="Constant">{explicitConstantLabel[version.explicitConstant]}</Field>
          <Field label="AI / provenance">{version.aiAssistance}</Field>
          <Field label="Source"><a href={version.sourceUrl} target="_blank" rel="noreferrer">{version.sourceLabel} ↗</a></Field>
        </FieldList>
        <div className="proof-detail-change">
          <span>What changed</span>
          <p>{version.changeSummary}</p>
        </div>
        <div className={cx("proof-detail-lean", version.lean.status === "formalized_upstream" ? "is-formalized" : "is-missing")}>
          <span>Lean</span>
          <strong>{version.lean.label}</strong>
          <p>{version.lean.note}</p>
          {version.lean.url && <a href={version.lean.url} target="_blank" rel="noreferrer">Open Lean source ↗</a>}
        </div>
      </aside>
    </div>

    <div className="proof-step-list" aria-label={`Proof steps for ${version.label}`}>
      {version.proofSteps.map((step) => <article className="proof-step-card" key={step.id}>
        <div className="proof-step-card-top">
          <Badge>{step.kind}</Badge>
          <code>{step.source}</code>
        </div>
        <strong>{step.label}</strong>
        <p>{step.detail}</p>
        {step.dependsOn.length > 0 && <small>Depends on: {step.dependsOn.join(", ")}</small>}
      </article>)}
    </div>
  </Surface>;
}

function InternalProofGraph({ version }: { version: ProofVersion }) {
  const layout = layoutProofSteps(version.proofSteps);
  return <div className="proof-internal-graph-scroll" tabIndex={0} aria-label={`${version.label} internal proof graph; the full step list follows`}>
    <div className="proof-internal-graph" style={{ width: layout.width, height: layout.height }}>
      <svg className="proof-internal-edges" viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true">
        <defs>
          <marker id={`proof-step-arrow-${version.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#a8b0bd" />
          </marker>
        </defs>
        {version.proofSteps.flatMap((step) => step.dependsOn.flatMap((dependency) => {
          const from = layout.positions.get(dependency);
          const to = layout.positions.get(step.id);
          if (!from || !to) return [];
          return [<path
            key={`${dependency}-${step.id}`}
            d={stepEdgePath(from, to)}
            className="proof-step-edge"
            markerEnd={`url(#proof-step-arrow-${version.id})`}
          />];
        }))}
      </svg>
      {version.proofSteps.map((step) => {
        const position = layout.positions.get(step.id);
        if (!position) return null;
        return <div
          className={cx("proof-step-node", `kind-${step.kind}`)}
          key={step.id}
          style={{ left: position.x, top: position.y, width: STEP_NODE_WIDTH, height: STEP_NODE_HEIGHT }}
        >
          <span className="proof-step-node-kind">{step.kind}</span>
          <strong>{step.label}</strong>
          <small>{step.source}</small>
        </div>;
      })}
    </div>
  </div>;
}

function layoutProofSteps(steps: ProofStep[]) {
  const byId = new Map(steps.map((step) => [step.id, step]));
  const layers = new Map<string, number>();
  const resolve = (id: string, stack: Set<string>): number => {
    const known = layers.get(id);
    if (known !== undefined) return known;
    if (stack.has(id)) return 0;
    stack.add(id);
    const step = byId.get(id);
    const dependencies = step?.dependsOn ?? [];
    const layer = dependencies.length === 0 ? 0 : Math.max(...dependencies.map((dependency) => resolve(dependency, stack))) + 1;
    stack.delete(id);
    layers.set(id, layer);
    return layer;
  };
  for (const step of steps) resolve(step.id, new Set());
  const maxLayer = Math.max(0, ...steps.map((step) => layers.get(step.id) ?? 0));
  const groups: ProofStep[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const step of steps) groups[layers.get(step.id) ?? 0].push(step);
  const positions = new Map<string, { x: number; y: number }>();
  groups.forEach((group, layerIndex) => {
    group.forEach((step, rowIndex) => {
      positions.set(step.id, {
        x: 24 + layerIndex * STEP_COLUMN_WIDTH,
        y: 24 + rowIndex * STEP_ROW_HEIGHT,
      });
    });
  });
  const rows = Math.max(1, ...groups.map((group) => group.length));
  return {
    positions,
    width: 24 + (maxLayer + 1) * STEP_COLUMN_WIDTH,
    height: 24 + rows * STEP_ROW_HEIGHT,
  };
}

function stepEdgePath(from: { x: number; y: number }, to: { x: number; y: number }) {
  const x1 = from.x + STEP_NODE_WIDTH;
  const y1 = from.y + STEP_NODE_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + STEP_NODE_HEIGHT / 2;
  const dx = Math.max(36, Math.abs(x2 - x1) * 0.42);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function CompressionLedger({ data }: { data: ProofEvolutionData }) {
  const versions = data.ledger.columns
    .map((id) => versionById(data, id))
    .filter((version): version is ProofVersion => Boolean(version));
  return <Surface tone="card" className="proof-ledger-panel">
    <div className="proof-ledger-scroll" tabIndex={0} aria-label="Compression ledger">
      <table className="proof-ledger">
        <thead>
          <tr>
            <th scope="col">Machinery</th>
            {versions.map((version) => <th scope="col" key={version.id}>
              <span>{version.label}</span>
              <small>{version.pages} pp</small>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {data.ledger.rows.map((row) => <tr key={row.id}>
            <th scope="row">{row.label}</th>
            {versions.map((version) => {
              const status = row.cells[version.id];
              return <td key={`${row.id}-${version.id}`}>
                <Badge tone={ledgerTone(status)}>{ledgerStatusLabel[status]}</Badge>
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="proof-ledger-legend" aria-label="Ledger status legend">
      <span><Badge tone="positive">Used</Badge> present in this proof</span>
      <span><Badge tone="warning">Replaced</Badge> replaced by another tool</span>
      <span><Badge tone="negative">Removed</Badge> not used in this version</span>
      <span><Badge tone="neutral">Not used</Badge> never part of this route</span>
      <span><Badge tone="neutral">Existential</Badge> absolute but no numeric value</span>
      <span><Badge tone="positive">Explicit</Badge> numeric constant stated</span>
    </div>
  </Surface>;
}

function LeanCoveragePanel({ data }: { data: ProofEvolutionData }) {
  const sameTheorem = versionsForTrack(data, "same-theorem");
  const shortest = [...sameTheorem].sort((a, b) => a.pages - b.pages)[0];
  const formalizedSameTheorem = sameTheorem.find((version) => version.lean.status === "formalized_upstream");
  return <div className="proof-lean-panel">
    <div className="proof-lean-gap">
      <div className="proof-lean-gap-card is-human">
        <span>Shortest human proof</span>
        <strong>{shortest ? `${shortest.pages} pages` : "—"}</strong>
        <small>{shortest ? `${shortest.label} · ${shortest.lean.status === "formalized_upstream" ? "formalized" : "not formalized"}` : "No version"}</small>
      </div>
      <div className="proof-lean-gap-mark" aria-hidden="true">≠</div>
      <div className="proof-lean-gap-card is-machine">
        <span>Formalized same-theorem route</span>
        <strong>{formalizedSameTheorem ? `${formalizedSameTheorem.pages} pages` : "—"}</strong>
        <small>{formalizedSameTheorem ? `${formalizedSameTheorem.label} · upstream solution` : "No upstream solution found"}</small>
      </div>
    </div>
    <Surface tone="card" className="proof-lean-table-panel">
      <div className="proof-ledger-scroll" tabIndex={0} aria-label="Lean coverage by version">
        <table className="proof-lean-table">
          <thead>
            <tr><th scope="col">Version</th><th scope="col">Pages</th><th scope="col">Lean status</th><th scope="col">Evidence</th></tr>
          </thead>
          <tbody>
            {data.versions.map((version) => <tr key={version.id}>
              <th scope="row">{version.label}<small>{version.date}</small></th>
              <td>{version.pages}</td>
              <td><Badge tone={leanTone(version.lean.status)}>{leanStatusLabel[version.lean.status]}</Badge></td>
              <td className="proof-lean-evidence">
                <strong>{version.lean.label}</strong>
                <span>{version.lean.note}</span>
                {version.lean.url && <a href={version.lean.url} target="_blank" rel="noreferrer">Open Lean source ↗</a>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="proof-lean-note">
        <strong>Comparator caveat</strong>
        <p><code>SiegelZeros.lean</code> is a comparator challenge statement ending in <code>sorry</code>; the solution module <code>OAI.NumberTheory.SiegelZeros.Main</code> is the proof. Proofweave has not re-run the kernel or the comparator for this prototype.</p>
      </div>
    </Surface>
  </div>;
}

function SourcesPanel({ data }: { data: ProofEvolutionData }) {
  return <Surface tone="card" className="proof-sources-panel">
    <ul className="proof-sources-list">
      {data.sources.map((source) => <li key={source.url}>
        <span className="proof-source-kind">{source.kind}</span>
        <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
      </li>)}
    </ul>
    <p className="proof-sources-note">This prototype is curated from the sources above. It does not claim that any version has been peer-reviewed by Proofweave, replayed, or kernel-checked.</p>
  </Surface>;
}
