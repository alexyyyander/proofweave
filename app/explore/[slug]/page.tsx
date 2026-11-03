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
import { targetRunnerAvailability } from "../../lib/runner-availability.server";
import { PageSectionNav, StatusStack } from "../../ui";
import { getI18n } from "@/app/i18n/server";
import { researchCardCopy } from "@/app/lib/research-card-copy";
import type { RunnerAvailabilityReason } from "@/app/lib/runner-availability";

import { CreditMarketPanel } from "./CreditMarketPanel";
import { PriorWorkChain } from "./PriorWorkChain";
import { ReusePanel } from "./ReusePanel";
import { ResearchGraphView } from "./ResearchGraphView";

export const dynamic = "force-dynamic";

const runnerReasonKeys: Record<RunnerAvailabilityReason, { label: `explore.runner.${RunnerAvailabilityReason}.label`; detail: `explore.runner.${RunnerAvailabilityReason}.detail` }> = {
  invalid_configuration: { label: "explore.runner.invalid_configuration.label", detail: "explore.runner.invalid_configuration.detail" },
  not_configured: { label: "explore.runner.not_configured.label", detail: "explore.runner.not_configured.detail" },
  no_image: { label: "explore.runner.no_image.label", detail: "explore.runner.no_image.detail" },
  executable: { label: "explore.runner.executable.label", detail: "explore.runner.executable.detail" },
  paused: { label: "explore.runner.paused.label", detail: "explore.runner.paused.detail" },
  not_deployed: { label: "explore.runner.not_deployed.label", detail: "explore.runner.not_deployed.detail" },
  approved: { label: "explore.runner.approved.label", detail: "explore.runner.approved.detail" },
};

export default async function ConjecturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { t } = await getI18n();
  const { slug } = await params;
  const project = await getCatalogRepository().findBySlug(slug);
  if (!project) notFound();
  const runnerAvailability = targetRunnerAvailability(project.source);
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
    ? t("explore.detail.work.proved")
    : project.researchStatus === "research_solved"
      ? t("explore.detail.work.solved")
      : t("explore.detail.work.open");
  const runnerKeys = runnerReasonKeys[runnerAvailability.reason];
  const statusCopy = researchCardCopy(t);

  return (
    <SiteFrame className="site-shell app-shell" active="explore" mainClassName="page-main detail-main">
        <Breadcrumb aria-label={t("common.breadcrumb")}><Link href="/explore">{t("explore.breadcrumb")}</Link><span> / </span><span>{primarySubject?.name ?? project.domain}</span></Breadcrumb>
        <SectionHeading as="section" className="detail-heading">
          <div><div className="subject-row detail-subjects">{project.subjects.map((subject) => <Badge className="subject-chip" key={subject.slug}>MSC {subject.amsCode} · {subject.name}</Badge>)}<Badge className="record-chip">{workLabel}</Badge></div><p className="eyebrow">{project.collections[0]?.title ?? t("explore.detail.catalogFallback")} · {project.source.upstreamName}</p><PageTitle>{project.title}</PageTitle><p>{project.projectSummary}</p></div>
          <div className="detail-environment"><span>{t("explore.detail.environment")}</span><code>{project.source.leanToolchain}<br />mathlib:{project.source.mathlibRevision.slice(0, 12)}</code><span className={`runner-availability is-${runnerAvailability.status}`} title={t(runnerKeys.detail)}>{t(runnerKeys.label)}</span></div>
        </SectionHeading>
        <StatusStack statuses={project.displayStatuses} labels={statusCopy.statuses} ariaLabel={statusCopy.verificationStates} />
        <PageSectionNav label={t("explore.detail.navAria")} links={[{ href: "#statements", label: t("explore.detail.nav.statements") }, { href: "#research-chain", label: t("explore.detail.nav.chain") }, { href: "#reuse-index", label: t("explore.detail.nav.reuse") }, { href: "#credit-market", label: t("explore.detail.nav.market") }, { href: "#research-graph", label: t("explore.detail.nav.graph") }, { href: `/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`, label: t("explore.detail.nav.start") }]} />
        <section className="detail-grid" id="statements">
          <Surface as="article" className="detail-panel statement-panel"><div className="panel-heading"><span>{t("explore.detail.informalStatement")}</span><Badge className="record-chip">{t("explore.detail.pinnedSource")}</Badge></div><p>{project.informalStatement}</p><div className="source-rail"><span>{t("explore.detail.sourceCorrespondence")}</span><strong>{project.sourceCorrespondence === "reviewed" ? t("explore.detail.sourceReviewed") : t("explore.detail.sourceImported")}</strong></div></Surface>
          <Surface as="article" className="detail-panel lean-panel"><div className="panel-heading"><span>{t("explore.detail.leanStatement")}</span><span className="mono-label">Lean 4</span></div><CodeBlock><code>{project.leanStatement}</code></CodeBlock></Surface>
          <Surface as="article" className="detail-panel provenance-panel"><div className="panel-heading"><span>{t("explore.detail.reproducibility")}</span><span className="mono-label">{project.source.revisionTag}</span></div><FieldList className="provenance-list"><Field label={t("explore.detail.source")}><a href={project.declaration.sourceUrl} rel="noreferrer" target="_blank">{project.declaration.sourcePath}</a></Field><Field label={t("explore.detail.revision")}><code>{project.source.revisionCommit}</code></Field><Field label={t("explore.detail.retrieved")}>{project.source.retrievedAt}</Field><Field label={t("explore.detail.sourceHash")}><code>{project.declaration.sourceContentHash}</code></Field><Field label={t("explore.detail.license")}>{project.source.sourceLicense}</Field><Field label={t("explore.detail.mathlib")}><code>{project.source.mathlibRevision}</code></Field></FieldList></Surface>
          <Surface as="article" className="detail-panel activity-panel"><div className="panel-heading"><span>{t("explore.detail.verification")}</span><span className="mono-label">{t("explore.detail.attestations", { count: project.claims.filter((claim) => claim.status === "attested").length })}</span></div><p>{t("explore.detail.verificationBody")}</p><div className="detail-policy-links"><Link className="text-link" href="/how-it-works#verification">{t("explore.detail.readVerificationModel")} <span>→</span></Link><Link className="text-link" href="/about#catalog-standard">{t("explore.detail.whyPriorWork")} <span>→</span></Link></div><div className="attempt-entry"><strong>{t("explore.detail.approachTitle")}</strong><p>{t("explore.detail.approachBody")}</p><ActionLink className="button button-primary" href={`/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`}>{t("explore.detail.startWithAgent")} <span aria-hidden="true">→</span></ActionLink></div></Surface>
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
