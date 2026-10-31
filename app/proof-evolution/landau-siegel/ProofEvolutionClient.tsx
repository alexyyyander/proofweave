"use client";

import { useState } from "react";
import { Badge, CardTitle, Field, FieldList, Surface, cx } from "@/app/components/ui";
import { useI18n } from "@/app/i18n/client";
import type { Locale } from "@/app/i18n/config";
import type { TranslationKey, Translator } from "@/app/i18n/translate";
import { LeanStructureView } from "./LeanStructureView";
import { ArgumentMapView } from "./ArgumentMapView";
import {
  trackById,
  versionById,
  versionsForTrack,
  type ArgumentMapData,
  type ExplicitConstant,
  type LeanStatus,
  type LeanStructureData,
  type LedgerStatus,
  type ProofDetailLevel,
  type ProofEvolutionData,
  type ProofEvolutionGoal,
  type ProofStep,
  type ProofStepKind,
  type ProofVersion,
  type VersionEdgeRelation,
} from "@/app/lib/proof-evolution";

const VERSION_NODE_WIDTH = 190;
const VERSION_NODE_HEIGHT = 104;
const STEP_NODE_WIDTH = 210;
const STEP_NODE_HEIGHT = 96;
const STEP_COLUMN_WIDTH = 250;
const STEP_ROW_HEIGHT = 118;

const goalKeys: Record<ProofEvolutionGoal, TranslationKey> = {
  origin: "proofMaps.label.goal.origin",
  simplify: "proofMaps.label.goal.simplify",
  explicitize: "proofMaps.label.goal.explicitize",
  elementary: "proofMaps.label.goal.elementary",
  recombine: "proofMaps.label.goal.recombine",
  stronger: "proofMaps.label.goal.stronger",
};

const explicitConstantKeys: Record<ExplicitConstant, TranslationKey> = {
  existential: "proofMaps.label.explicitConstant.existential",
  explicit: "proofMaps.label.explicitConstant.explicit",
  effective: "proofMaps.label.explicitConstant.effective",
  asymptotic: "proofMaps.label.explicitConstant.asymptotic",
};

const leanStatusKeys: Record<LeanStatus, TranslationKey> = {
  formalized_upstream: "proofMaps.label.leanStatus.formalized_upstream",
  not_formalized: "proofMaps.label.leanStatus.not_formalized",
  not_separately_formalized: "proofMaps.label.leanStatus.not_separately_formalized",
};

const relationKeys: Record<VersionEdgeRelation, TranslationKey> = {
  simplifies: "proofMaps.label.relation.simplifies",
  explicitizes: "proofMaps.label.relation.explicitizes",
  recombines: "proofMaps.label.relation.recombines",
  stronger: "proofMaps.label.relation.stronger",
};

const ledgerStatusKeys: Record<LedgerStatus, TranslationKey> = {
  used: "proofMaps.label.ledgerStatus.used",
  replaced: "proofMaps.label.ledgerStatus.replaced",
  removed: "proofMaps.label.ledgerStatus.removed",
  not_used: "proofMaps.label.ledgerStatus.not_used",
  explicit: "proofMaps.label.ledgerStatus.explicit",
  existential: "proofMaps.label.ledgerStatus.existential",
  effective: "proofMaps.label.ledgerStatus.effective",
};

const detailLevelKeys: Record<ProofDetailLevel, TranslationKey> = {
  lemma: "proofMaps.label.detailLevel.lemma",
  grouped: "proofMaps.label.detailLevel.grouped",
  summary: "proofMaps.label.detailLevel.summary",
  section: "proofMaps.label.detailLevel.section",
};

const detailLevelNoteKeys: Record<ProofDetailLevel, TranslationKey> = {
  lemma: "proofMaps.label.detailLevelNote.lemma",
  grouped: "proofMaps.label.detailLevelNote.grouped",
  summary: "proofMaps.label.detailLevelNote.summary",
  section: "proofMaps.label.detailLevelNote.section",
};

const stepKindKeys: Record<ProofStepKind, TranslationKey> = {
  theorem: "proofMaps.label.kind.theorem",
  lemma: "proofMaps.label.kind.lemma",
  corollary: "proofMaps.label.kind.corollary",
  construction: "proofMaps.label.kind.construction",
  bound: "proofMaps.label.kind.bound",
  assembly: "proofMaps.label.kind.assembly",
  external: "proofMaps.label.kind.external",
};

function formatDate(value: string, locale: Locale) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day || month < 1 || month > 12) return value;
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
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
  const { t, locale } = useI18n();
  const [selectedId, setSelectedId] = useState("barreto-2026-10-19");
  const selected = versionById(data, selectedId) ?? data.versions[0];
  if (!selected) return null;

  return <div className="proof-evolution-content">
    <CaveatPanel caveats={data.caveats} t={t} />

    <section id="evolution" className="proof-evolution-section" aria-labelledby="evolution-title">
      <SectionHeading
        id="evolution-title"
        eyebrow={t("proofMaps.evolution.evolutionEyebrow")}
        title={t("proofMaps.evolution.evolutionTitle")}
        description={t("proofMaps.evolution.evolutionDescription")}
      />
      <div className="proof-evolution-legend" aria-label={t("proofMaps.evolution.legendAria")}>
        <span><i className="proof-legend-line is-simplifies" aria-hidden="true" />{t("proofMaps.evolution.legendSimplifies")}</span>
        <span><i className="proof-legend-line is-explicitizes" aria-hidden="true" />{t("proofMaps.evolution.legendExplicitizes")}</span>
        <span><i className="proof-legend-line is-recombines" aria-hidden="true" />{t("proofMaps.evolution.legendRecombines")}</span>
        <span className="proof-evolution-legend-note">{t("proofMaps.evolution.legendNote")}</span>
      </div>
      <VersionGraph data={data} selectedId={selected.id} onSelect={setSelectedId} t={t} locale={locale} />
      <p className="proof-evolution-graph-note">{t("proofMaps.evolution.graphNote")}</p>
    </section>

    <section id="argument-map" className="proof-evolution-section" aria-labelledby="argument-map-title">
      <SectionHeading
        id="argument-map-title"
        eyebrow={t("proofMaps.evolution.argumentEyebrow")}
        title={t("proofMaps.evolution.argumentTitle")}
        description={t("proofMaps.evolution.argumentDescription")}
      />
      <ArgumentMapView data={data} argumentMap={argumentMap} lean={leanStructure} />
    </section>

    <section id="detail" className="proof-evolution-section" aria-labelledby="detail-title">
      <SectionHeading
        id="detail-title"
        eyebrow={t("proofMaps.evolution.detailEyebrow")}
        title={t("proofMaps.evolution.detailTitle")}
        description={t("proofMaps.evolution.detailDescription")}
      />
      <VersionDetail version={selected} data={data} t={t} locale={locale} />
    </section>

    <section id="ledger" className="proof-evolution-section" aria-labelledby="ledger-title">
      <SectionHeading
        id="ledger-title"
        eyebrow={t("proofMaps.evolution.ledgerEyebrow")}
        title={t("proofMaps.evolution.ledgerTitle")}
        description={t("proofMaps.evolution.ledgerDescription")}
      />
      <CompressionLedger data={data} t={t} />
    </section>

    <section id="lean" className="proof-evolution-section" aria-labelledby="lean-title">
      <SectionHeading
        id="lean-title"
        eyebrow={t("proofMaps.evolution.leanEyebrow")}
        title={t("proofMaps.evolution.leanTitle")}
        description={t("proofMaps.evolution.leanDescription")}
      />
      <LeanCoveragePanel data={data} t={t} />
    </section>

    <section id="lean-structure" className="proof-evolution-section" aria-labelledby="lean-structure-title">
      <SectionHeading
        id="lean-structure-title"
        eyebrow={t("proofMaps.evolution.leanStructureEyebrow")}
        title={t("proofMaps.evolution.leanStructureTitle")}
        description={t("proofMaps.evolution.leanStructureDescription", {
          modules: leanStructure.summary.oaiModules.toLocaleString(locale),
          lines: leanStructure.summary.totalLines.toLocaleString(locale),
          declarations: leanStructure.summary.declarations.toLocaleString(locale),
        })}
      />
      <LeanStructureView data={data} lean={leanStructure} selectedVersion={selected} onSelectVersion={setSelectedId} />
    </section>

    <section id="sources" className="proof-evolution-section" aria-labelledby="sources-title">
      <SectionHeading
        id="sources-title"
        eyebrow={t("proofMaps.evolution.sourcesEyebrow")}
        title={t("proofMaps.evolution.sourcesTitle")}
        description={t("proofMaps.evolution.sourcesDescription")}
      />
      <SourcesPanel data={data} t={t} />
    </section>
  </div>;
}

function CaveatPanel({ caveats, t }: { caveats: string[]; t: Translator }) {
  return <Surface tone="inset" className="proof-evolution-caveat">
    <div className="proof-evolution-caveat-heading">
      <Badge tone="warning">{t("proofMaps.evolution.caveatBadge")}</Badge>
      <strong>{t("proofMaps.evolution.caveatTitle")}</strong>
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

function VersionGraph({ data, selectedId, onSelect, t, locale }: {
  data: ProofEvolutionData;
  selectedId: string;
  onSelect: (id: string) => void;
  t: Translator;
  locale: Locale;
}) {
  const byId = new Map(data.versions.map((version) => [version.id, version]));
  const width = 1200;
  const height = 640;
  return <>
    <div className="proof-evolution-graph-scroll" tabIndex={0} aria-label={t("proofMaps.evolution.graphScrollAria")}>
    <div className="proof-evolution-graph" style={{ width, height }}>
      <div className="proof-track-band proof-track-band-stronger" style={{ left: 20, top: 0, width: width - 40, height: 140 }}>
        <span>{t("proofMaps.evolution.bandStronger")}</span>
      </div>
      <div className="proof-track-band proof-track-band-same" style={{ left: 20, top: 160, width: width - 40, height: 460 }}>
        <span>{t("proofMaps.evolution.bandSame")}</span>
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
            <title>{`${from.label} ${t(relationKeys[edge.relation])} ${to.label}: ${edge.label}`}</title>
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
          aria-label={t("proofMaps.evolution.versionAria", { label: version.label, pages: version.pages, method: version.method, leanStatus: t(leanStatusKeys[version.lean.status]) })}
          onClick={() => onSelect(version.id)}
        >
          <span className="proof-version-node-top">
            <span className="proof-version-goal">{version.trackId === "stronger-theorem" ? t("proofMaps.evolution.strongerTheorem") : t(goalKeys[version.goal])}</span>
            <span className="proof-version-pages">{t("proofMaps.evolution.pages", { count: version.pages })}</span>
          </span>
          <strong className="proof-version-node-label">{version.label}</strong>
          <span className="proof-version-node-method">{version.method}</span>
          <span className="proof-version-node-foot">
            <span className={cx("proof-lean-dot", version.lean.status === "formalized_upstream" ? "is-formalized" : "is-missing")} aria-hidden="true" />
            <span>{version.lean.status === "formalized_upstream" ? t("proofMaps.evolution.lean") : t("proofMaps.evolution.noLean")}</span>
            <span>{formatDate(version.date, locale)}</span>
          </span>
        </button>;
      })}
      </div>
    </div>
    <div className="proof-version-index" aria-label={t("proofMaps.evolution.versionIndexAria")}>
      {data.versions.map((version) => <button
        type="button"
        key={version.id}
        className={cx("proof-version-index-button", version.id === selectedId && "is-selected")}
        aria-pressed={version.id === selectedId}
        onClick={() => onSelect(version.id)}
      >
        <span>{version.label}</span>
        <small>{t("proofMaps.evolution.pages", { count: version.pages })} · {t(goalKeys[version.goal])}</small>
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

function VersionDetail({ version, data, t, locale }: { version: ProofVersion; data: ProofEvolutionData; t: Translator; locale: Locale }) {
  const track = trackById(data, version.trackId);
  return <Surface tone="card" className="proof-evolution-detail">
    <header className="proof-detail-header">
      <div className="proof-detail-heading">
        <p className="eyebrow">{track?.label ?? version.trackId}</p>
        <CardTitle as="h2">{version.label} · {version.title}</CardTitle>
        <p>{version.summary}</p>
      </div>
      <div className="proof-detail-badges">
        <Badge>{t("proofMaps.evolution.pagesBadge", { count: version.pages })}</Badge>
        <Badge tone={leanTone(version.lean.status)}>{t(leanStatusKeys[version.lean.status])}</Badge>
        <Badge>{t(goalKeys[version.goal])}</Badge>
      </div>
    </header>

    <div className="proof-detail-layout">
      <div className="proof-detail-graph">
        <div className="proof-detail-subheading">
          <div>
            <span className="proof-detail-label">{t("proofMaps.evolution.internalProofMap")}</span>
            <strong>{t(detailLevelKeys[version.proofDetail])}</strong>
          </div>
          <Badge tone="neutral">{t("proofMaps.evolution.nodesBadge", { count: version.proofSteps.length })}</Badge>
        </div>
        <InternalProofGraph version={version} t={t} />
        <p className="proof-detail-scroll-hint">{t("proofMaps.evolution.scrollHint")}</p>
        <p className="proof-detail-note">{t(detailLevelNoteKeys[version.proofDetail])}</p>
      </div>

      <aside className="proof-detail-meta">
        <FieldList layout="stacked">
          <Field label={t("proofMaps.evolution.fieldAuthors")}>{version.authors.join(", ")}</Field>
          <Field label={t("proofMaps.evolution.fieldDate")}>{formatDate(version.date, locale)}{version.releaseDate ? t("proofMaps.evolution.release", { date: formatDate(version.releaseDate, locale) }) : ""}</Field>
          <Field label={t("proofMaps.evolution.fieldMethod")}>{version.method}</Field>
          <Field label={t("proofMaps.evolution.fieldField")}>{version.field}</Field>
          <Field label={t("proofMaps.evolution.fieldConstant")}>{t(explicitConstantKeys[version.explicitConstant])}</Field>
          <Field label={t("proofMaps.evolution.fieldProvenance")}>{version.aiAssistance}</Field>
          <Field label={t("proofMaps.evolution.fieldSource")}><a href={version.sourceUrl} target="_blank" rel="noreferrer">{version.sourceLabel} ↗</a></Field>
        </FieldList>
        <div className="proof-detail-change">
          <span>{t("proofMaps.evolution.whatChanged")}</span>
          <p>{version.changeSummary}</p>
        </div>
        <div className={cx("proof-detail-lean", version.lean.status === "formalized_upstream" ? "is-formalized" : "is-missing")}>
          <span>{t("proofMaps.evolution.leanSection")}</span>
          <strong>{version.lean.label}</strong>
          <p>{version.lean.note}</p>
          {version.lean.url && <a href={version.lean.url} target="_blank" rel="noreferrer">{t("proofMaps.evolution.openLeanSource")}</a>}
        </div>
      </aside>
    </div>

    <div className="proof-step-list" aria-label={t("proofMaps.evolution.stepListAria", { label: version.label })}>
      {version.proofSteps.map((step) => <article className="proof-step-card" key={step.id}>
        <div className="proof-step-card-top">
          <Badge>{t(stepKindKeys[step.kind])}</Badge>
          <code>{step.source}</code>
        </div>
        <strong>{step.label}</strong>
        <p>{step.detail}</p>
        {step.dependsOn.length > 0 && <small>{t("proofMaps.evolution.dependsOn", { items: step.dependsOn.join(", ") })}</small>}
      </article>)}
    </div>
  </Surface>;
}

function InternalProofGraph({ version, t }: { version: ProofVersion; t: Translator }) {
  const layout = layoutProofSteps(version.proofSteps);
  return <div className="proof-internal-graph-scroll" tabIndex={0} aria-label={t("proofMaps.evolution.graphAria", { label: version.label })}>
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
          <span className="proof-step-node-kind">{t(stepKindKeys[step.kind])}</span>
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

function CompressionLedger({ data, t }: { data: ProofEvolutionData; t: Translator }) {
  const versions = data.ledger.columns
    .map((id) => versionById(data, id))
    .filter((version): version is ProofVersion => Boolean(version));
  return <Surface tone="card" className="proof-ledger-panel">
    <div className="proof-ledger-scroll" tabIndex={0} aria-label={t("proofMaps.evolution.ledgerAria")}>
      <table className="proof-ledger">
        <thead>
          <tr>
            <th scope="col">{t("proofMaps.evolution.machinery")}</th>
            {versions.map((version) => <th scope="col" key={version.id}>
              <span>{version.label}</span>
              <small>{t("proofMaps.evolution.pages", { count: version.pages })}</small>
            </th>)}
          </tr>
        </thead>
        <tbody>
          {data.ledger.rows.map((row) => <tr key={row.id}>
            <th scope="row">{row.label}</th>
            {versions.map((version) => {
              const status = row.cells[version.id];
              return <td key={`${row.id}-${version.id}`}>
                <Badge tone={ledgerTone(status)}>{t(ledgerStatusKeys[status])}</Badge>
              </td>;
            })}
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="proof-ledger-legend" aria-label={t("proofMaps.evolution.ledgerLegendAria")}>
      <span><Badge tone="positive">{t("proofMaps.evolution.ledgerUsed")}</Badge> {t("proofMaps.evolution.ledgerUsedNote")}</span>
      <span><Badge tone="warning">{t("proofMaps.evolution.ledgerReplaced")}</Badge> {t("proofMaps.evolution.ledgerReplacedNote")}</span>
      <span><Badge tone="negative">{t("proofMaps.evolution.ledgerRemoved")}</Badge> {t("proofMaps.evolution.ledgerRemovedNote")}</span>
      <span><Badge tone="neutral">{t("proofMaps.evolution.ledgerNotUsed")}</Badge> {t("proofMaps.evolution.ledgerNotUsedNote")}</span>
      <span><Badge tone="neutral">{t("proofMaps.evolution.ledgerExistential")}</Badge> {t("proofMaps.evolution.ledgerExistentialNote")}</span>
      <span><Badge tone="positive">{t("proofMaps.evolution.ledgerExplicit")}</Badge> {t("proofMaps.evolution.ledgerExplicitNote")}</span>
    </div>
  </Surface>;
}

function LeanCoveragePanel({ data, t }: { data: ProofEvolutionData; t: Translator }) {
  const sameTheorem = versionsForTrack(data, "same-theorem");
  const shortest = [...sameTheorem].sort((a, b) => a.pages - b.pages)[0];
  const formalizedSameTheorem = sameTheorem.find((version) => version.lean.status === "formalized_upstream");
  return <div className="proof-lean-panel">
    <div className="proof-lean-gap">
      <div className="proof-lean-gap-card is-human">
        <span>{t("proofMaps.evolution.shortestHuman")}</span>
        <strong>{shortest ? t("proofMaps.evolution.pagesValue", { count: shortest.pages }) : "—"}</strong>
        <small>{shortest ? `${shortest.label} · ${shortest.lean.status === "formalized_upstream" ? t("proofMaps.evolution.formalized") : t("proofMaps.evolution.notFormalized")}` : t("proofMaps.evolution.noVersion")}</small>
      </div>
      <div className="proof-lean-gap-mark" aria-hidden="true">≠</div>
      <div className="proof-lean-gap-card is-machine">
        <span>{t("proofMaps.evolution.formalizedRoute")}</span>
        <strong>{formalizedSameTheorem ? t("proofMaps.evolution.pagesValue", { count: formalizedSameTheorem.pages }) : "—"}</strong>
        <small>{formalizedSameTheorem ? `${formalizedSameTheorem.label} · ${t("proofMaps.evolution.upstreamSolution")}` : t("proofMaps.evolution.noUpstream")}</small>
      </div>
    </div>
    <Surface tone="card" className="proof-lean-table-panel">
      <div className="proof-ledger-scroll" tabIndex={0} aria-label={t("proofMaps.evolution.leanTableAria")}>
        <table className="proof-lean-table">
          <thead>
            <tr><th scope="col">{t("proofMaps.evolution.colVersion")}</th><th scope="col">{t("proofMaps.evolution.colPages")}</th><th scope="col">{t("proofMaps.evolution.colLeanStatus")}</th><th scope="col">{t("proofMaps.evolution.colEvidence")}</th></tr>
          </thead>
          <tbody>
            {data.versions.map((version) => <tr key={version.id}>
              <th scope="row">{version.label}<small>{version.date}</small></th>
              <td>{version.pages}</td>
              <td><Badge tone={leanTone(version.lean.status)}>{t(leanStatusKeys[version.lean.status])}</Badge></td>
              <td className="proof-lean-evidence">
                <strong>{version.lean.label}</strong>
                <span>{version.lean.note}</span>
                {version.lean.url && <a href={version.lean.url} target="_blank" rel="noreferrer">{t("proofMaps.evolution.openLeanSource")}</a>}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="proof-lean-note">
        <strong>{t("proofMaps.evolution.comparatorCaveat")}</strong>
        <p><code>SiegelZeros.lean</code>{t("proofMaps.evolution.comparatorBodyA")}<code>sorry</code>{t("proofMaps.evolution.comparatorBodyB")}<code>OAI.NumberTheory.SiegelZeros.Main</code>{t("proofMaps.evolution.comparatorBodyC")}</p>
      </div>
    </Surface>
  </div>;
}

function SourcesPanel({ data, t }: { data: ProofEvolutionData; t: Translator }) {
  return <Surface tone="card" className="proof-sources-panel">
    <ul className="proof-sources-list">
      {data.sources.map((source) => <li key={source.url}>
        <span className="proof-source-kind">{source.kind}</span>
        <a href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>
      </li>)}
    </ul>
    <p className="proof-sources-note">{t("proofMaps.evolution.sourcesNote")}</p>
  </Surface>;
}
