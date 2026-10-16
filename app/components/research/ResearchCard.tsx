import Link from "next/link";
import { type CatalogProblemSummary } from "@/packages/domain/catalog";
import { CardTitle, Surface, FieldList, Field, Badge, ActionLink } from "../ui";
import { StatusStack } from "../evidence/Status";

export function ResearchCard({ project, variant = "detail" }: { project: CatalogProblemSummary; variant?: "summary" | "detail" }) {
  if (variant === "summary") return <Surface as="article" className="project-card">
    <div className="card-topline"><span className="micro-label">{project.domain}</span><Badge className="record-chip">Pinned source</Badge></div>
    <CardTitle>{project.title}</CardTitle><p>{project.informalStatement}</p><StatusStack statuses={project.displayStatuses} compact />
    <div className="card-footer"><span>{project.source.revisionTag}</span><Link href={"/explore/" + project.slug}>View opportunity <span aria-hidden="true">→</span></Link></div>
  </Surface>;
  const canStart = project.proofState === "admitted";
  return <Surface as="article" className="research-result-card">
    <div className="research-result-card-top"><div className="subject-row">{project.subjects.map((subject) => <Badge className="subject-chip" key={subject.slug}>MSC {subject.amsCode} · {subject.name}</Badge>)}</div><Badge className="record-chip">{workLabel(project)}</Badge></div>
    <Link className="research-result-title" href={`/explore/${project.slug}`}><CardTitle>{project.title}</CardTitle></Link>
    <p className="research-result-statement">{project.informalStatement}</p>
    <FieldList className="research-result-signals"><Field label="Next action">{neededNow(project)}</Field><Field label="Scope">{scopeLabel(project)}</Field><Field label="Source">{project.source.upstreamName} · {project.source.revisionTag}</Field></FieldList>
    <div className="research-result-verification"><span>Public record</span><StatusStack statuses={project.displayStatuses} compact /></div>
    <footer className="research-result-footer"><code>{project.declaration.qualifiedName}</code><div>{canStart && <ActionLink className="button button-primary" href={`/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`}>Start in workspace</ActionLink>}<ActionLink className={canStart ? "button button-secondary" : "button button-primary"} href={`/explore/${project.slug}`}>{canStart ? "Open record" : "Inspect proof"}<span aria-hidden="true">→</span></ActionLink></div></footer>
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

function neededNow(project: CatalogProblemSummary) {
  if (project.proofState === "proved") return "Inspect the checked proof and evidence";
  if (project.researchStatus === "research_solved") return "Formalize the established result";
  return "Advance an open formal proof branch";
}

function scopeLabel(project: CatalogProblemSummary) {
  const kind = scopeKind(project);
  if (kind === "bounded") return "Bounded milestone";
  if (kind === "long-horizon") return "Long-horizon program";
  return "Open research program";
}

function workLabel(project: CatalogProblemSummary) {
  if (project.proofState === "proved") return "Lean proof available";
  if (project.researchStatus === "research_solved") return "Known result · proof wanted";
  return "Open conjecture";
}
