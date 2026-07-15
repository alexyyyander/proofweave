import Link from "next/link";
import { notFound } from "next/navigation";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { Footer, Header, StatusStack } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ConjecturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getCatalogRepository().findBySlug(slug);
  if (!project) notFound();

  return (
    <div className="site-shell app-shell">
      <Header active="explore" />
      <main id="main-content" tabIndex={-1} className="page-main detail-main">
        <div className="breadcrumb"><Link href="/explore">Explore</Link><span> / </span><span>{project.domain}</span></div>
        <section className="detail-heading">
          <div><p className="eyebrow">{project.domain} · {project.source.upstreamName}</p><h1>{project.title}</h1><p>{project.projectSummary}</p></div>
          <div className="detail-environment"><span>Environment</span><code>{project.source.leanToolchain}<br />mathlib:{project.source.mathlibRevision.slice(0, 12)}</code></div>
        </section>
        <StatusStack statuses={project.displayStatuses} />
        <section className="detail-grid">
          <article className="detail-panel statement-panel"><div className="panel-heading"><span>Informal statement</span><span className="record-chip">Pinned source</span></div><p>{project.informalStatement}</p><div className="source-rail"><span>Source correspondence</span><strong>{project.sourceCorrespondence === "reviewed" ? "Proofweave review recorded" : "Imported; no Proofweave fidelity attestation"}</strong></div></article>
          <article className="detail-panel lean-panel"><div className="panel-heading"><span>Pinned Lean statement</span><span className="mono-label">Lean 4</span></div><pre><code>{project.leanStatement}</code></pre></article>
          <article className="detail-panel provenance-panel"><div className="panel-heading"><span>Reproducibility record</span><span className="mono-label">{project.source.revisionTag}</span></div><dl className="provenance-list"><div><dt>Source</dt><dd><a href={project.declaration.sourceUrl} rel="noreferrer" target="_blank">{project.declaration.sourcePath}</a></dd></div><div><dt>Revision</dt><dd><code>{project.source.revisionCommit}</code></dd></div><div><dt>Retrieved</dt><dd>{project.source.retrievedAt}</dd></div><div><dt>Source hash</dt><dd><code>{project.declaration.sourceContentHash}</code></dd></div><div><dt>License</dt><dd>{project.source.sourceLicense}</dd></div><div><dt>Mathlib</dt><dd><code>{project.source.mathlibRevision}</code></dd></div></dl></article>
          <article className="detail-panel activity-panel"><div className="panel-heading"><span>Proofweave verification</span><span className="mono-label">{project.claims.filter((claim) => claim.status === "attested").length} attestations</span></div><p>This record carries a source declaration, not a completed Proofweave result. Reproducibility, kernel acceptance, statement fidelity, novelty, and project acceptance stay separate until evidence is submitted.</p><Link className="text-link" href="/how-it-works">Read the verification model <span>→</span></Link><div className="attempt-entry"><strong>Approach this target with your Agent.</strong><p>Choose the target once. Proofweave derives your active local Agent and opens or resumes its provisional workspace without exposing certificate or protocol details.</p><Link className="button button-primary" href={`/workbench?target=${encodeURIComponent(project.slug)}#research-launcher`}>Start with my Agent <span aria-hidden="true">→</span></Link></div></article>
        </section>
      </main>
      <Footer />
    </div>
  );
}
