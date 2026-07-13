import Link from "next/link";
import { notFound } from "next/navigation";
import { projects } from "../../lib/content";
import { Footer, Header, StatusStack } from "../../ui";

export default async function ConjecturePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = projects.find((item) => item.slug === slug);
  if (!project) notFound();

  return (
    <div className="site-shell app-shell">
      <Header active="explore" />
      <main className="page-main detail-main">
        <div className="breadcrumb"><Link href="/explore">Explore</Link><span> / </span><span>{project.domain}</span></div>
        <section className="detail-heading">
          <div><p className="eyebrow">{project.domain} · {project.source}</p><h1>{project.title}</h1><p>{project.summary}</p></div>
          <div className="detail-environment"><span>Environment</span><code>{project.environment}</code></div>
        </section>
        <StatusStack statuses={project.statuses} />
        <section className="detail-grid">
          <article className="detail-panel statement-panel"><div className="panel-heading"><span>Informal statement</span><span className="record-chip">Preview data</span></div><p>{project.informal}</p><div className="source-rail"><span>Source correspondence</span><strong>Awaiting curated source link</strong></div></article>
          <article className="detail-panel lean-panel"><div className="panel-heading"><span>Pinned Lean statement</span><span className="mono-label">Lean 4</span></div><pre><code>{project.lean}</code></pre></article>
          <article className="detail-panel dependency-panel"><div className="panel-heading"><span>Local dependency map</span><span className="mono-label">P-04</span></div><div className="dependency-chain"><div className="node node-open">Open target</div><span>←</span><div className="node">Auxiliary lemma</div><span>←</span><div className="node">Formal definitions</div></div><p>Full project DAGs stay collapsed until a contributor asks for local context.</p></article>
          <article className="detail-panel activity-panel"><div className="panel-heading"><span>Public activity</span><span className="mono-label">0 receipts</span></div><p>No production receipts are connected to this preview record. The future activity stream will list signed attempts and independent verification events, never private reasoning traces.</p><Link className="text-link" href="/receipt/abc-l1">Inspect receipt schema <span>→</span></Link></article>
        </section>
      </main>
      <Footer />
    </div>
  );
}
