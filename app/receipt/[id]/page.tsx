import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import {
  getContributionReceiptReader,
  type PublicContributionReceiptRecord,
  type PublicContributionReceipt,
  type PublicContributionReceiptDependency,
  type PublicContributionReceiptLifecycleEvent,
} from "@/db/repositories/receipts";
import { Footer, Header } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let record: PublicContributionReceiptRecord | null = null;
  let dependencies: readonly PublicContributionReceiptDependency[] | null = null;
  let lifecycle: readonly PublicContributionReceiptLifecycleEvent[] | null = null;
  let unavailable: boolean | null = null;
  try {
    const reader = getContributionReceiptReader();
    record = await reader.findById(id);
    if (record) {
      [dependencies, lifecycle] = await Promise.all([
        reader.findDependenciesById(id),
        reader.findLifecycleById(id),
      ]);
    }
  } catch (error) {
    unavailable = error instanceof MissingDatabaseBindingError;
  }
  if (unavailable !== null) return <ReceiptUnavailable unavailable={unavailable} />;
  if (!record) return <ReceiptNotIssued id={id} />;
  if (!dependencies || !lifecycle) return <ReceiptUnavailable unavailable={false} />;
  return <IssuedReceipt receipt={record.receipt} receiptHash={record.receiptHash} dependencies={dependencies} lifecycle={lifecycle} />;
}

function IssuedReceipt({ receipt, receiptHash, dependencies, lifecycle }: { receipt: PublicContributionReceipt; receiptHash: string; dependencies: readonly PublicContributionReceiptDependency[]; lifecycle: readonly PublicContributionReceiptLifecycleEvent[] }) {
  const independentReviewers = new Set(receipt.claims.map((claim) => claim.reviewerPersonId)).size;
  const latestLifecycleEvent = lifecycle.at(-1) ?? null;
  return (
    <div className="site-shell app-shell">
      <Header active="receipt" />
      <main id="main-content" tabIndex={-1} className="page-main receipt-main">
        <div className="breadcrumb"><Link href="/explore">Explore</Link><span> / </span><span>Contribution receipt</span></div>
        <section className="receipt-heading"><div><p className="eyebrow">Public evidence record · signed</p><h1>{contributionKindLabel(receipt.kind)}</h1><p>This immutable receipt credits one verified contribution. Its signed evidence can be inspected as JSON or downloaded as a portable verification bundle.</p></div><span className="record-chip">Issued</span></section>
        <section className="receipt-summary"><div><span>Credited person</span><code>{receipt.beneficiary.personId}</code></div><div><span>Via delegated Agent</span><code>{receipt.beneficiary.agentId}</code></div><div><span>Target</span><strong>{receipt.target.declaration}</strong></div><div><span>Issued</span><strong>{receipt.issuedAt}</strong></div></section>
        <section className="receipt-grid">
          <article className="receipt-card"><p className="eyebrow">Verification stack</p><ReceiptGate label="Delegation certificate" detail={receipt.beneficiary.delegationCertificateId} /><ReceiptGate label="Reproducible bundle" detail="Attested" /><ReceiptGate label="Kernel acceptance" detail="Accepted" /><ReceiptGate label="Independent review" detail={`${receipt.claims.length} attestations · ${independentReviewers} Person${independentReviewers === 1 ? "" : "s"}`} /></article>
          <article className="receipt-card receipt-machine"><p className="eyebrow">Machine evidence</p><dl><div><dt>Receipt ID</dt><dd><code>{receipt.id}</code></dd></div><div><dt>Receipt hash</dt><dd><code>{receiptHash}</code></dd></div><div><dt>Payload hash</dt><dd><code>{receipt.payloadHash}</code></dd></div><div><dt>Artifact bundle</dt><dd><code>{receipt.artifactBundleHash}</code></dd></div><div><dt>Run result</dt><dd><code>{receipt.run.resultHash}</code></dd></div><div><dt>Issuer key</dt><dd><code>{receipt.issuerKeyId}</code></dd></div><div><dt>JSON evidence</dt><dd><Link className="text-link" href={`/api/receipts/${encodeURIComponent(receipt.id)}`}>Open verified JSON <span>→</span></Link></dd></div><div><dt>Portable evidence</dt><dd><Link className="text-link" href={`/api/receipts/${encodeURIComponent(receipt.id)}/verification-bundle`}>Download verification bundle <span>→</span></Link></dd></div><div><dt>Current issuer keys</dt><dd><Link className="text-link" href="/api/receipts/issuer-keys">Open current keyset <span>→</span></Link></dd></div></dl></article>
        </section>
        <section className="receipt-dependencies" aria-labelledby="receipt-dependencies-heading"><div><p className="eyebrow">Dependency trace</p><h2 id="receipt-dependencies-heading">Upstream evidence used by this contribution.</h2><p>Every listed edge was declared in the signed Artifact Bundle and rechecked against the upstream signed receipt.</p></div>{dependencies.length === 0 ? <p className="receipt-dependency-empty">No upstream Contribution Receipts were declared for this bundle.</p> : <ol>{dependencies.map((dependency) => <li key={dependency.receiptId}><div><span>{contributionKindLabel(dependency.kind)}</span><Link href={`/receipt/${encodeURIComponent(dependency.receiptId)}`}>{dependency.target.declaration}</Link><small>Issued {dependency.issuedAt}</small></div><div><code>{dependency.receiptId}</code><code>{dependency.receiptHash}</code></div></li>)}</ol>}<Link className="text-link receipt-dependency-json" href={`/api/receipts/${encodeURIComponent(receipt.id)}/dependencies`}>Open dependency JSON <span>→</span></Link></section>
        <section className={`receipt-lifecycle${latestLifecycleEvent ? ` is-${latestLifecycleEvent.eventType}` : ""}`} aria-labelledby="receipt-lifecycle-heading"><div><p className="eyebrow">Evidence lifecycle</p><h2 id="receipt-lifecycle-heading">{latestLifecycleEvent ? lifecycleHeading(latestLifecycleEvent) : "No later correction or retraction."}</h2><p>{latestLifecycleEvent ? lifecycleDetail(latestLifecycleEvent) : "This receipt remains exactly as issued. Later changes must appear as a separately signed event; the original evidence cannot be edited."}</p></div>{lifecycle.length > 0 && <ol>{lifecycle.map((event) => <li key={event.id}><span>{lifecycleLabel(event.eventType)}</span><div><strong>{event.occurredAt}</strong><code>{event.reasonHash}</code></div>{event.replacementReceiptId ? <Link className="text-link" href={`/receipt/${encodeURIComponent(event.replacementReceiptId)}`}>Open replacement <span>→</span></Link> : <small>Original receipt retained</small>}</li>)}</ol>}<Link className="text-link receipt-lifecycle-json" href={`/api/receipts/${encodeURIComponent(receipt.id)}/lifecycle`}>Open lifecycle JSON <span>→</span></Link></section>
        <p className="receipt-note">This v1 record, its dependency edges, and its lifecycle events are immutable. For a current revocation check, pair the downloaded bundle with the current public issuer keyset.</p>
      </main>
      <Footer />
    </div>
  );
}

function ReceiptGate({ label, detail }: { label: string; detail: string }) {
  return <div className="receipt-state"><span className="accepted-dot" /><span>{label}</span><strong className="receipt-state-detail">{detail}</strong></div>;
}

function ReceiptNotIssued({ id }: { id: string }) {
  return <ReceiptMessage title="Receipt not issued" detail="No signed Contribution Receipt exists for this identifier. A valid attempt, kernel-accepted run, and independent evidence are required before issuance." id={id} />;
}

function ReceiptUnavailable({ unavailable }: { unavailable: boolean }) {
  return <ReceiptMessage title="Receipt record unavailable" detail={unavailable ? "Receipt storage is not configured in this environment." : "The stored record could not be verified for display. Please try again later."} />;
}

function ReceiptMessage({ title, detail, id }: { title: string; detail: string; id?: string }) {
  return (
    <div className="site-shell app-shell">
      <Header active="receipt" />
      <main id="main-content" tabIndex={-1} className="page-main receipt-main">
        <div className="breadcrumb"><Link href="/explore">Explore</Link><span> / </span><span>Contribution receipt</span></div>
        <section className="receipt-heading"><div><p className="eyebrow">Public evidence record</p><h1>{title}</h1><p>{detail}</p></div><span className="record-chip">{id ? "Not issued" : "Unavailable"}</span></section>
        {id && <section className="receipt-card receipt-message"><p className="eyebrow">Requested receipt ID</p><code>{id}</code><Link className="text-link" href="/how-it-works">Read the issuance requirements <span>→</span></Link></section>}
      </main>
      <Footer />
    </div>
  );
}

function contributionKindLabel(kind: PublicContributionReceipt["kind"]) {
  return {
    formalization: "Formalization",
    lemma: "Reusable lemma",
    proof_patch: "Proof patch",
    counterexample: "Counterexample",
    verification: "Independent verification",
    synthesis: "Synthesis",
    infrastructure: "Research infrastructure",
  }[kind];
}

function lifecycleLabel(eventType: PublicContributionReceiptLifecycleEvent["eventType"]) {
  return {
    corrected: "Corrected",
    superseded: "Superseded",
    retracted: "Retracted",
  }[eventType];
}

function lifecycleHeading(event: PublicContributionReceiptLifecycleEvent) {
  if (event.eventType === "retracted") return "This receipt was retracted; the original evidence remains inspectable.";
  if (event.eventType === "superseded") return "A later receipt supersedes this evidence.";
  return "A signed correction points to later evidence.";
}

function lifecycleDetail(event: PublicContributionReceiptLifecycleEvent) {
  if (event.eventType === "retracted") return `Recorded ${event.occurredAt}. Retraction does not erase the original receipt or its audit trail.`;
  return `Recorded ${event.occurredAt}. The original receipt stays immutable while the replacement is linked separately.`;
}
