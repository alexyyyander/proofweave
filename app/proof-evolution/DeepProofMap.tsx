import Link from "next/link";
import { Badge, Surface } from "@/app/components/ui";
import { adaptDeepProofMap, type DeepProofMapData } from "@/app/lib/deep-proof-map";
import { getI18n } from "@/app/i18n/server";
import { MathText } from "../publications/MathText";
import { ArgumentMapView } from "./landau-siegel/ArgumentMapView";
import "./landau-siegel/proof-evolution.css";

export async function DeepProofMapView({ deep, subject, revision }: {
  deep: DeepProofMapData;
  subject: string;
  revision: string;
}) {
  const { t } = await getI18n();
  const adapted = adaptDeepProofMap(deep, revision, subject);
  const strategyById = new Map(deep.strategies.map((strategy) => [strategy.id, strategy]));
  const nodeById = new Map(deep.strategies.flatMap((strategy) => strategy.nodes.map((node) => [`${strategy.id}:${node.id}`, node] as const)));
  return <>
    <section id="argument-map" className="deep-proof-map-section" aria-labelledby="deep-argument-map-title">
      <div className="proof-map-family-section-heading">
        <div><p className="eyebrow">{t("proofMaps.deep.eyebrow")}</p><h2 id="deep-argument-map-title">{t("proofMaps.deep.title")}</h2></div>
        <span><Badge tone="warning">{t("proofMaps.deep.badge")}</Badge></span>
      </div>
      <p className="deep-proof-map-intro">
        {t("proofMaps.deep.intro")}
      </p>
      <Surface tone="card" className="deep-proof-map-result">
        <span>{t("proofMaps.deep.sharedResult")}</span>
        <strong>{deep.result.label}</strong>
        <p>{deep.result.statement}</p>
        {deep.result.detail && <small>{deep.result.detail}</small>}
      </Surface>
      <ArgumentMapView data={adapted.proof} argumentMap={adapted.argumentMap} lean={adapted.lean} />
    </section>

    <section className="deep-proof-map-boundaries" aria-labelledby="deep-boundaries-title">
      <div className="proof-map-family-section-heading">
        <div><p className="eyebrow">{t("proofMaps.deep.boundariesEyebrow")}</p><h2 id="deep-boundaries-title">{t("proofMaps.deep.boundariesTitle")}</h2></div>
        <span>{t("proofMaps.deep.boundariesMeta")}</span>
      </div>
      <Surface tone="inset" className="deep-proof-map-caveats">
        <ul>{deep.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
      </Surface>
      <div className="deep-proof-map-sources">
        <span>{t("proofMaps.deep.sources")}</span>
        <div>{deep.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.kind}-${source.url}`}>{source.label} ↗</a>)}</div>
      </div>
    </section>

    <section className="deep-proof-map-lean" aria-labelledby="deep-lean-title">
      <div className="proof-map-family-section-heading">
        <div><p className="eyebrow">{t("proofMaps.deep.leanEyebrow")}</p><h2 id="deep-lean-title">{t("proofMaps.deep.leanTitle")}</h2></div>
        <span>{deep.leanAlignments.length === 1 ? t("proofMaps.deep.alignmentOne", { count: deep.leanAlignments.length }) : t("proofMaps.deep.alignmentOther", { count: deep.leanAlignments.length })}</span>
      </div>
      {deep.leanAlignments.length === 0 ? <Surface tone="card" className="deep-proof-map-align-empty">
        <strong>{t("proofMaps.deep.noLeanTitle")}</strong>
        <p>{t("proofMaps.deep.noLeanBody")}</p>
      </Surface> : <div className="deep-proof-map-align-list">
        {deep.leanAlignments.map((alignment) => {
          const strategy = strategyById.get(alignment.strategyId);
          const node = nodeById.get(`${alignment.strategyId}:${alignment.nodeId}`);
          return <Surface tone="card" className="deep-proof-map-align" key={`${alignment.strategyId}-${alignment.nodeId}-${alignment.solutionModule}`}>
            <div className="deep-proof-map-align-heading">
              <div><span>{strategy?.label ?? alignment.strategyId}</span><strong>{node?.fullLabel ?? alignment.nodeId}</strong></div>
              <Badge tone={alignment.confidence === "source-anchored" ? "positive" : "warning"}>{alignment.confidence}</Badge>
            </div>
            <div className="deep-proof-map-align-row"><span>{t("proofMaps.deep.theoremNames")}</span><div>{alignment.theoremNames.map((name) => <code key={name}>{name}</code>)}</div></div>
            <div className="deep-proof-map-align-row"><span>{t("proofMaps.deep.solutionModule")}</span><code>{alignment.solutionModule}</code></div>
            <p>{alignment.note}</p>
            <a href={alignment.solutionUrl} target="_blank" rel="noreferrer">{t("proofMaps.deep.openLeanModule")}</a>
          </Surface>;
        })}
      </div>}
    </section>

    {deep.relatedManuscripts.length > 0 && <section className="deep-proof-map-related" aria-labelledby="deep-related-title">
      <div className="proof-map-family-section-heading">
        <div><p className="eyebrow">{t("proofMaps.deep.relatedEyebrow")}</p><h2 id="deep-related-title">{t("proofMaps.deep.relatedTitle")}</h2></div>
        <span>{t("proofMaps.deep.relatedCount", { count: deep.relatedManuscripts.length })}</span>
      </div>
      <div className="deep-proof-map-related-list">
        {deep.relatedManuscripts.map((manuscript) => <article key={manuscript.pdfUrl}>
          <div><span>{manuscript.date}</span><Badge>{manuscript.relation}</Badge></div>
          <h3><MathText text={manuscript.title} /></h3>
          <p>{manuscript.note}</p>
          <div><a href={manuscript.pdfUrl} target="_blank" rel="noreferrer">{t("proofMaps.deep.openPdf")}</a><a href={manuscript.readmeUrl} target="_blank" rel="noreferrer">{t("proofMaps.deep.sourceNotes")}</a></div>
        </article>)}
      </div>
      <p className="deep-proof-map-related-note">{t("proofMaps.deep.relatedNote")}</p>
      <Link href={`/publications/openai-math/${deep.familyNumber}`}>{t("proofMaps.deep.openPublication")}</Link>
    </section>}
  </>;
}
