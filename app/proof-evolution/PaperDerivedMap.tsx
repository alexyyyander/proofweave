import Link from "next/link";
import { Badge, Surface } from "@/app/components/ui";
import type { PaperStructure, ProofMapIndexEntry } from "@/app/lib/proof-map";
import type { Translator } from "@/app/i18n/translate";
import { PaperGraphView } from "./PaperGraphView";

/**
 * A paper-derived structure: the paper's own theorem-like statements as nodes,
 * and explicit references inside proof environments as edges. The component
 * never claims those references are verified proof dependencies.
 */
export function PaperDerivedMap({ structure, entry, t }: {
  structure: PaperStructure;
  entry: ProofMapIndexEntry;
  t: Translator;
}) {
  const nodeById = new Map(structure.nodes.map((node) => [node.id, node]));
  const cites = new Map<string, string[]>();
  const citedBy = new Map<string, string[]>();
  for (const edge of structure.edges) {
    if (!nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
    cites.set(edge.to, [...(cites.get(edge.to) ?? []), edge.from]);
    citedBy.set(edge.from, [...(citedBy.get(edge.from) ?? []), edge.to]);
  }
  const sectionsFor = (nodes: PaperStructure["nodes"]) => [
    ...structure.sections
      .map((section) => ({ title: section, nodes: nodes.filter((node) => node.section === section) }))
      .filter((section) => section.nodes.length > 0),
    { title: null, nodes: nodes.filter((node) => !node.section) },
  ].filter((section) => section.nodes.length > 0);
  // Several papers can share section titles ("Introduction"); group by paper
  // first so nodes from different manuscripts never merge into one section.
  const manuscriptGroups = structure.manuscripts.length > 1
    ? structure.manuscripts.map((manuscript) => ({
      title: manuscript.title,
      sections: sectionsFor(structure.nodes.filter((node) => node.manuscript === manuscript.title)),
    })).filter((group) => group.sections.length > 0)
    : [{ title: null, sections: sectionsFor(structure.nodes) }];
  const sectionCount = manuscriptGroups.reduce((total, group) => total + group.sections.length, 0);

  return <section id="paper-derived-map" className="paper-derived-map" aria-labelledby="paper-derived-map-title">
    <div className="proof-map-family-section-heading">
      <div>
        <p className="eyebrow">{t("proofMaps.paper.eyebrow")}</p>
        <h2 id="paper-derived-map-title">{t("proofMaps.paper.title")}</h2>
      </div>
      <span>{t("proofMaps.paper.meta", {
        statements: t(structure.nodes.length === 1 ? "proofMaps.paper.statementsOne" : "proofMaps.paper.statementsOther", { count: structure.nodes.length }),
        edges: t(structure.edges.length === 1 ? "proofMaps.paper.edgesOne" : "proofMaps.paper.edgesOther", { count: structure.edges.length }),
        sections: t(sectionCount === 1 ? "proofMaps.paper.sectionsOne" : "proofMaps.paper.sectionsOther", { count: sectionCount }),
      })}</span>
    </div>
    <p className="paper-derived-intro">{t("proofMaps.paper.body")}</p>

    <Surface tone="inset" className="paper-derived-claim">
      <span>{t("proofMaps.paper.claimLabel")}</span>
      <p>{entry.claimSnippet}</p>
      <Link href={entry.publicationRoute}>{t("proofMaps.paper.claimSource")}</Link>
    </Surface>

    <div className="paper-derived-papers">
      <span>{t("proofMaps.paper.sourcesLabel")}</span>
      <div>{structure.manuscripts.map((manuscript) => <a href={manuscript.pdfUrl} target="_blank" rel="noreferrer" key={manuscript.id}>{manuscript.title} ↗</a>)}</div>
    </div>

    <section className="paper-derived-graph" aria-labelledby="paper-graph-title">
      <div className="proof-map-family-section-heading">
        <div>
          <p className="eyebrow">{t("proofMaps.paper.graphEyebrow")}</p>
          <h3 className="paper-derived-graph-title" id="paper-graph-title">{t("proofMaps.paper.graphTitle")}</h3>
        </div>
      </div>
      <p className="paper-derived-intro">{t("proofMaps.paper.graphBody")}</p>
      <PaperGraphView structure={structure} claim={entry.claimSnippet} />
    </section>

    <ol className="paper-derived-manuscripts">
      {manuscriptGroups.map((group) => <li key={group.title ?? "family"}>
        {group.title && <h3 className="paper-derived-manuscript-title">{group.title}</h3>}
        <ol className="paper-derived-sections">
      {group.sections.map((section, sectionIndex) => <li key={section.title ?? "document"}>
        <h4 className="paper-derived-section-title">
          <span>{String(sectionIndex + 1).padStart(2, "0")}</span>
          {section.title ?? t("proofMaps.paper.noSection")}
        </h4>
        <div className="paper-derived-nodes">
          {section.nodes.map((node) => {
            const nodeCites = (cites.get(node.id) ?? []).map((id) => nodeById.get(id)).filter((entry) => entry !== undefined);
            const nodeCitedBy = (citedBy.get(node.id) ?? []).map((id) => nodeById.get(id)).filter((entry) => entry !== undefined);
            return <article className={`paper-derived-node kind-${node.kind}`} id={`paper-node-${node.id}`} key={node.id}>
              <div className="paper-derived-node-top">
                <Badge>{node.kind}</Badge>
                <strong>{node.id}</strong>
              </div>
              <p>{t("proofMaps.paper.exactStatement")}</p>
              {nodeCites.length > 0 && <div className="paper-derived-links">
                <span>{t("proofMaps.paper.cites")}</span>
                {nodeCites.map((target) => <a href={`#paper-node-${target.id}`} key={target.id}>{target.id}</a>)}
              </div>}
              {nodeCitedBy.length > 0 && <div className="paper-derived-links is-inbound">
                <span>{t("proofMaps.paper.citedBy")}</span>
                {nodeCitedBy.map((target) => <a href={`#paper-node-${target.id}`} key={target.id}>{target.id}</a>)}
              </div>}
            </article>;
          })}
        </div>
      </li>)}
        </ol>
      </li>)}
    </ol>

    <p className="paper-derived-note">{t("proofMaps.paper.boundary")}</p>
  </section>;
}
