import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, Badge, Field, ActionLink, CodeBlock, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { CreditMarketSchemaUnavailableError, getCreditMarketRepository, type PublicCreditMarket } from "@/db/repositories/credit-market";
import { getResearchGraphRepository, ResearchGraphSchemaUnavailableError, type PublicResearchGraph } from "@/db/repositories/research-graph";
import { CuratedResearchSchemaUnavailableError, getCuratedResearchRepository, type PublicCuratedResearchRecord } from "@/db/repositories/curated-research";
import { MissingDatabaseBindingError } from "@/db";
import type { CatalogProblem } from "@/packages/domain/catalog";
import { buildReuseIndex } from "@/services/research/reuse-index.mjs";
import { getCurrentUser, signInPath } from "../../auth";
import { PageSectionNav, StatusStack } from "../../ui";

import { CreditMarketPanel } from "./CreditMarketPanel";
import { PriorWorkChain } from "./PriorWorkChain";
import { ReusePanel } from "./ReusePanel";
import { ResearchGraphView } from "./ResearchGraphView";

export const dynamic = "force-dynamic";

export default async function ConjecturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getCatalogRepository().findBySlug(slug);
  if (!project) notFound();
  const [graph, user, curatedResearch, catalogTargets] = await Promise.all([
    loadResearchGraph(project.id),
    getCurrentUser(),
    loadCuratedResearch(project.id),
    loadCatalogTargets(),
  ]);
  const market = graph ? await loadCreditMarket(project.id, graph) : null;
  const reuseIndex = buildReuseIndex({
    catalog: catalogTargets,
    curatedResearch,
    researchGraph: graph,
    current: project,
  });
  const returnTo = `/explore/${encodeURIComponent(project.slug)}#research-graph`;
  const primarySubject = project.subjects.find((subject) => subject.isPrimary) ?? project.subjects[0];
  const workLabel = project.proofState === "proved"
    ? "Lean proof available"
    : project.researchStatus === "research_solved"
      ? "Known result · Lean proof wanted"
      : "Open conjecture";

  return (
    <SiteFrame className="site-shell app-shell" active="explore" mainClassName="page-main detail-main">
        <Breadcrumb><Link href="/explore">Explore</Link><span> / </span><span>{primarySubject?.name ?? project.domain}</span></Breadcrumb>
        <SectionHeading as="section" className="detail-heading">
          <div><div className="subject-row detail-subjects">{project.subjects.map((subject) => <Badge className="subject-chip" key={subject.slug}>MSC {subject.amsCode} · {subject.name}</Badge>)}<Badge className="record-chip">{workLabel}</Badge></div><p className="eyebrow">{project.collections[0]?.title ?? "Public research catalog"} · {project.source.upstreamName}</p><PageTitle>{project.title}</PageTitle><p>{project.projectSummary}</p></div>
          <div className="detail-environment"><span>Environment</span><code>{project.source.leanToolchain}<br />mathlib:{project.source.mathlibRevision.slice(0, 12)}</code></div>
        </SectionHeading>
        <StatusStack statuses={project.displayStatuses} />
        <PageSectionNav label="Research record" links={[{ href: "#statements", label: "Statements & source" }, { href: "#research-chain", label: "Prior work chain" }, { href: "#reuse-index", label: "Reuse index" }, { href: "#credit-market", label: "Credit market" }, { href: "#research-graph", label: "Research graph" }, { href: `/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`, label: "Start with my Agent" }]} />
        <section className="detail-grid" id="statements">
          <Surface as="article" className="detail-panel statement-panel"><div className="panel-heading"><span>Informal statement</span><Badge className="record-chip">Pinned source</Badge></div><p>{project.informalStatement}</p><div className="source-rail"><span>Source correspondence</span><strong>{project.sourceCorrespondence === "reviewed" ? "Proofweave review recorded" : "Imported; no Proofweave fidelity attestation"}</strong></div></Surface>
          <Surface as="article" className="detail-panel lean-panel"><div className="panel-heading"><span>Pinned Lean statement</span><span className="mono-label">Lean 4</span></div><CodeBlock><code>{project.leanStatement}</code></CodeBlock></Surface>
          <Surface as="article" className="detail-panel provenance-panel"><div className="panel-heading"><span>Reproducibility record</span><span className="mono-label">{project.source.revisionTag}</span></div><FieldList className="provenance-list"><Field label="Source"><a href={project.declaration.sourceUrl} rel="noreferrer" target="_blank">{project.declaration.sourcePath}</a></Field><Field label="Revision"><code>{project.source.revisionCommit}</code></Field><Field label="Retrieved">{project.source.retrievedAt}</Field><Field label="Source hash"><code>{project.declaration.sourceContentHash}</code></Field><Field label="License">{project.source.sourceLicense}</Field><Field label="Mathlib"><code>{project.source.mathlibRevision}</code></Field></FieldList></Surface>
          <Surface as="article" className="detail-panel activity-panel"><div className="panel-heading"><span>Proofweave verification</span><span className="mono-label">{project.claims.filter((claim) => claim.status === "attested").length} attestations</span></div><p>This record carries a source declaration, not a completed Proofweave result. Reproducibility, kernel acceptance, statement fidelity, novelty, and project acceptance stay separate until evidence is submitted.</p><div className="detail-policy-links"><Link className="text-link" href="/how-it-works/verification">Read the verification model <span>→</span></Link><Link className="text-link" href="/about/catalog-standard">Why prior work and freshness are required <span>→</span></Link></div><div className="attempt-entry"><strong>Approach this target with your Agent.</strong><p>Choose the target once. Proofweave derives your active local Agent and opens or resumes its provisional workspace without exposing certificate or protocol details.</p><ActionLink className="button button-primary" href={`/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`}>Start with my Agent <span aria-hidden="true">→</span></ActionLink></div></Surface>
        </section>
        <PriorWorkChain records={curatedResearch ?? []} problemSlug={project.slug} />
        <ReusePanel index={reuseIndex} problemSlug={project.slug} />
        <div id="credit-market"><CreditMarketPanel market={market} /></div>
        <div id="research-graph">
          <ResearchGraphView graph={graph} problemSlug={project.slug} canImportSources={Boolean(user)} signInPath={signInPath(returnTo)} />
        </div>
      </SiteFrame>
  );
}

async function loadCreditMarket(problemRevisionId: string, graph: PublicResearchGraph): Promise<PublicCreditMarket | null> {
  try {
    return await getCreditMarketRepository().findByProblemRevisionId(problemRevisionId, graph);
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError || error instanceof CreditMarketSchemaUnavailableError) return null;
    throw error;
  }
}

async function loadResearchGraph(problemRevisionId: string): Promise<PublicResearchGraph | null> {
  try {
    return await getResearchGraphRepository().findByProblemRevisionId(problemRevisionId);
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError || error instanceof ResearchGraphSchemaUnavailableError) return null;
    throw error;
  }
}

async function loadCuratedResearch(problemRevisionId: string): Promise<readonly PublicCuratedResearchRecord[] | null> {
  try {
    return await getCuratedResearchRepository().findByProblemRevisionId(problemRevisionId);
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError || error instanceof CuratedResearchSchemaUnavailableError) return null;
    throw error;
  }
}

async function loadCatalogTargets(): Promise<CatalogProblem[] | null> {
  try {
    const repository = getCatalogRepository();
    const [frontier, practice] = await Promise.all([
      repository.list("frontier"),
      repository.list("practice"),
    ]);
    return [...frontier, ...practice];
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return null;
    throw error;
  }
}
