import Link from "next/link";
import { Badge, Surface } from "@/app/components/ui";
import { adaptDeepProofMap, type DeepProofMapData } from "@/app/lib/deep-proof-map";
import { MathText } from "../publications/MathText";
import { ArgumentMapView } from "./landau-siegel/ArgumentMapView";
import "./landau-siegel/proof-evolution.css";

export function DeepProofMapView({ deep, subject, revision }: {
  deep: DeepProofMapData;
  subject: string;
  revision: string;
}) {
  const adapted = adaptDeepProofMap(deep, revision, subject);
  const strategyById = new Map(deep.strategies.map((strategy) => [strategy.id, strategy]));
  const nodeById = new Map(deep.strategies.flatMap((strategy) => strategy.nodes.map((node) => [`${strategy.id}:${node.id}`, node] as const)));
  return <>
    <section id="argument-map" className="deep-proof-map-section" aria-labelledby="deep-argument-map-title">
      <div className="proof-map-family-section-heading">
        <div><p className="eyebrow">Theorem dependencies · deep map</p><h2 id="deep-argument-map-title">How the argument reaches the result.</h2></div>
        <span><Badge tone="warning">Deep · unreviewed</Badge></span>
      </div>
      <p className="deep-proof-map-intro">
        Matrix groups the argument by proof strategy and mathematical role; Network lays the same nodes out as a force-directed graph. Solid edges are dependencies stated or directly indicated in the paper; dotted and dashed edges compare roles across strategies. Select a node in either view to read its proof detail, dependencies, and any Lean alignment.
      </p>
      <Surface tone="card" className="deep-proof-map-result">
        <span>Shared result</span>
        <strong>{deep.result.label}</strong>
        <p>{deep.result.statement}</p>
        {deep.result.detail && <small>{deep.result.detail}</small>}
      </Surface>
      <ArgumentMapView data={adapted.proof} argumentMap={adapted.argumentMap} lean={adapted.lean} />
    </section>

    <section className="deep-proof-map-boundaries" aria-labelledby="deep-boundaries-title">
      <div className="proof-map-family-section-heading">
        <div><p className="eyebrow">Curation boundary</p><h2 id="deep-boundaries-title">What this deep map does not claim.</h2></div>
        <span>Unreviewed · no replay</span>
      </div>
      <Surface tone="inset" className="deep-proof-map-caveats">
        <ul>{deep.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}</ul>
      </Surface>
      <div className="deep-proof-map-sources">
        <span>Sources</span>
        <div>{deep.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={`${source.kind}-${source.url}`}>{source.label} ↗</a>)}</div>
      </div>
    </section>

    <section className="deep-proof-map-lean" aria-labelledby="deep-lean-title">
      <div className="proof-map-family-section-heading">
        <div><p className="eyebrow">Paper-to-Lean alignment</p><h2 id="deep-lean-title">What is aligned, and what is not.</h2></div>
        <span>{deep.leanAlignments.length} {deep.leanAlignments.length === 1 ? "alignment" : "alignments"}</span>
      </div>
      {deep.leanAlignments.length === 0 ? <Surface tone="card" className="deep-proof-map-align-empty">
        <strong>No Lean comparator is linked for this family.</strong>
        <p>That absence is not evidence that no Lean code exists. It means this pinned snapshot does not connect a comparator or scope document to the family’s theorem-level spine.</p>
      </Surface> : <div className="deep-proof-map-align-list">
        {deep.leanAlignments.map((alignment) => {
          const strategy = strategyById.get(alignment.strategyId);
          const node = nodeById.get(`${alignment.strategyId}:${alignment.nodeId}`);
          return <Surface tone="card" className="deep-proof-map-align" key={`${alignment.strategyId}-${alignment.nodeId}-${alignment.solutionModule}`}>
            <div className="deep-proof-map-align-heading">
              <div><span>{strategy?.label ?? alignment.strategyId}</span><strong>{node?.fullLabel ?? alignment.nodeId}</strong></div>
              <Badge tone={alignment.confidence === "source-anchored" ? "positive" : "warning"}>{alignment.confidence}</Badge>
            </div>
            <div className="deep-proof-map-align-row"><span>Theorem names</span><div>{alignment.theoremNames.map((name) => <code key={name}>{name}</code>)}</div></div>
            <div className="deep-proof-map-align-row"><span>Solution module</span><code>{alignment.solutionModule}</code></div>
            <p>{alignment.note}</p>
            <a href={alignment.solutionUrl} target="_blank" rel="noreferrer">Open the Lean module ↗</a>
          </Surface>;
        })}
      </div>}
    </section>

    {deep.relatedManuscripts.length > 0 && <section className="deep-proof-map-related" aria-labelledby="deep-related-title">
      <div className="proof-map-family-section-heading">
        <div><p className="eyebrow">Related work, not proof nodes</p><h2 id="deep-related-title">Companion manuscripts</h2></div>
        <span>{deep.relatedManuscripts.length} papers</span>
      </div>
      <div className="deep-proof-map-related-list">
        {deep.relatedManuscripts.map((manuscript) => <article key={manuscript.pdfUrl}>
          <div><span>{manuscript.date}</span><Badge>{manuscript.relation}</Badge></div>
          <h3><MathText text={manuscript.title} /></h3>
          <p>{manuscript.note}</p>
          <div><a href={manuscript.pdfUrl} target="_blank" rel="noreferrer">Open PDF ↗</a><a href={manuscript.readmeUrl} target="_blank" rel="noreferrer">Source & version notes ↗</a></div>
        </article>)}
      </div>
      <p className="deep-proof-map-related-note">These papers are related work in the release. They are not represented as dependencies of the selected theorem unless a node above explicitly says so.</p>
      <Link href={`/publications/openai-math/${deep.familyNumber}`}>Open the full publication record →</Link>
    </section>}
  </>;
}
