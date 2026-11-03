import Link from "../ui/NavigationLink";
import { type CatalogDisplayStatus, type CatalogProblemSummary } from "@/packages/domain/catalog";
import { CardTitle, Surface, FieldList, Field, Badge, ActionLink } from "../ui";
import { StatusStack } from "../evidence/Status";

export type ResearchCardCopy = {
  pinnedSource: string;
  verificationStates: string;
  statuses: Record<CatalogDisplayStatus, string>;
  viewOpportunity: string;
  nextAction: string;
  scope: string;
  source: string;
  publicRecord: string;
  startInWorkspace: string;
  openRecord: string;
  inspectProof: string;
  needs: { proved: string; solved: string; open: string };
  scopes: { bounded: string; longHorizon: string; program: string };
  works: { proved: string; solved: string; open: string };
};

export const englishResearchCardCopy: ResearchCardCopy = {
  pinnedSource: "Pinned source",
  verificationStates: "Verification states",
  statuses: {
    "Formalized statement": "Formalized statement",
    "Open proof branch": "Open proof branch",
    "Kernel accepted": "Kernel accepted",
    "Statement fidelity reviewed": "Statement fidelity reviewed",
    "Independent review": "Independent review",
    "No Proofweave attestation": "No Proofweave attestation",
  },
  viewOpportunity: "View opportunity",
  nextAction: "Next action",
  scope: "Scope",
  source: "Source",
  publicRecord: "Public record",
  startInWorkspace: "Start in workspace",
  openRecord: "Open record",
  inspectProof: "Inspect proof",
  needs: {
    proved: "Inspect the checked proof and evidence",
    solved: "Formalize the established result",
    open: "Advance an open formal proof branch",
  },
  scopes: {
    bounded: "Bounded milestone",
    longHorizon: "Long-horizon program",
    program: "Open research program",
  },
  works: {
    proved: "Lean proof available",
    solved: "Known result · proof wanted",
    open: "Open conjecture",
  },
};

export function ResearchCard({ project, copy, variant = "detail" }: {
  project: CatalogProblemSummary;
  variant?: "summary" | "detail";
  copy: ResearchCardCopy;
}) {
  if (variant === "summary") return <Surface as="article" className="project-card">
    <div className="card-topline"><span className="micro-label">{project.domain}</span><Badge className="record-chip">{copy.pinnedSource}</Badge></div>
    <CardTitle>{project.title}</CardTitle><p>{project.informalStatement}</p><StatusStack statuses={project.displayStatuses} compact labels={copy.statuses} ariaLabel={copy.verificationStates} />
    <div className="card-footer"><span>{project.source.revisionTag}</span><Link href={"/explore/" + project.slug}>{copy.viewOpportunity} <span aria-hidden="true">→</span></Link></div>
  </Surface>;
  const canStart = project.proofState === "admitted";
  return <Surface as="article" className="research-result-card">
    <div className="research-result-card-top"><div className="subject-row">{project.subjects.map((subject) => <Badge className="subject-chip" key={subject.slug}>MSC {subject.amsCode} · {subject.name}</Badge>)}</div><Badge className="record-chip">{workLabel(project, copy)}</Badge></div>
    <Link className="research-result-title" href={`/explore/${project.slug}`}><CardTitle>{project.title}</CardTitle></Link>
    <p className="research-result-statement">{project.informalStatement}</p>
    <FieldList className="research-result-signals"><Field label={copy.nextAction}>{neededNow(project, copy)}</Field><Field label={copy.scope}>{scopeLabel(project, copy)}</Field><Field label={copy.source}>{project.source.upstreamName} · {project.source.revisionTag}</Field></FieldList>
    <div className="research-result-verification"><span>{copy.publicRecord}</span><StatusStack statuses={project.displayStatuses} compact labels={copy.statuses} ariaLabel={copy.verificationStates} /></div>
    <footer className="research-result-footer"><code>{project.declaration.qualifiedName}</code><div>{canStart && <ActionLink className="button button-primary" href={`/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`}>{copy.startInWorkspace}</ActionLink>}<ActionLink className={canStart ? "button button-secondary" : "button button-primary"} href={`/explore/${project.slug}`}>{canStart ? copy.openRecord : copy.inspectProof}<span aria-hidden="true">→</span></ActionLink></div></footer>
  </Surface>;
}

export function opportunityKind(project: CatalogProblemSummary): "verified" | "formalize" | "advance" {
  if (project.proofState === "proved") return "verified";
  if (project.researchStatus === "research_solved") return "formalize";
  return "advance";
}

export function scopeKind(project: CatalogProblemSummary): "bounded" | "long-horizon" | "program" {
  if (project.collections.some((collection) => collection.role === "milestone")) return "bounded";
  if (project.collections.some((collection) => collection.tier === "grand" && collection.role === "headline")) return "long-horizon";
  return "program";
}

function neededNow(project: CatalogProblemSummary, copy: ResearchCardCopy) {
  if (project.proofState === "proved") return copy.needs.proved;
  if (project.researchStatus === "research_solved") return copy.needs.solved;
  return copy.needs.open;
}

function scopeLabel(project: CatalogProblemSummary, copy: ResearchCardCopy) {
  const kind = scopeKind(project);
  if (kind === "bounded") return copy.scopes.bounded;
  if (kind === "long-horizon") return copy.scopes.longHorizon;
  return copy.scopes.program;
}

function workLabel(project: CatalogProblemSummary, copy: ResearchCardCopy) {
  if (project.proofState === "proved") return copy.works.proved;
  if (project.researchStatus === "research_solved") return copy.works.solved;
  return copy.works.open;
}
