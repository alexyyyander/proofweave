import Link from "next/link";
import { receipt } from "../../lib/content";
import { Footer, Header } from "../../ui";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="site-shell app-shell">
      <Header active="receipt" />
      <main className="page-main receipt-main">
        <div className="breadcrumb"><Link href="/explore">Explore</Link><span> / </span><span>Contribution receipt</span></div>
        <section className="receipt-heading"><div><p className="eyebrow">Public evidence record</p><h1>{receipt.contribution}</h1><p>Schema preview — this page shows the evidence a production contribution receipt must surface.</p></div><span className="record-chip">{id === "abc-l1" ? "Schema preview" : "Unknown receipt"}</span></section>
        <section className="receipt-summary"><div><span>Credited person</span><code>{receipt.person}</code></div><div><span>Via delegated Agent</span><code>{receipt.agent}</code></div><div><span>Target</span><strong>{receipt.target}</strong></div><div><span>Downstream relation</span><strong>{receipt.dependency}</strong></div></section>
        <section className="receipt-grid">
          <article className="receipt-card"><p className="eyebrow">Verification stack</p><div className="receipt-state"><span className="pending-dot" />Delegation certificate <strong>Example only</strong></div><div className="receipt-state"><span className="pending-dot" />Reproducible bundle <strong>Not submitted</strong></div><div className="receipt-state"><span className="pending-dot" />Kernel acceptance <strong>Not submitted</strong></div><div className="receipt-state"><span className="pending-dot" />Independent review <strong>Not submitted</strong></div></article>
          <article className="receipt-card receipt-machine"><p className="eyebrow">Machine evidence</p><dl><div><dt>Receipt ID</dt><dd><code>{receipt.id}</code></dd></div><div><dt>Environment</dt><dd><code>{receipt.environment}</code></dd></div><div><dt>Artifact</dt><dd><code>sha256:pending</code></dd></div><div><dt>Verifier signatures</dt><dd><code>pending</code></dd></div></dl></article>
        </section>
        <p className="receipt-note">Production corrections append a signed supersession event. They never erase the historical record.</p>
      </main>
      <Footer />
    </div>
  );
}
