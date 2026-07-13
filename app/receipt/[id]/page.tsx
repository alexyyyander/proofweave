import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import {
  getContributionReceiptReader,
  type PublicContributionReceiptRecord,
  type PublicContributionReceipt,
} from "@/db/repositories/receipts";
import { Footer, Header } from "../../ui";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let record: PublicContributionReceiptRecord | null = null;
  let unavailable: boolean | null = null;
  try {
    record = await getContributionReceiptReader().findById(id);
  } catch (error) {
    unavailable = error instanceof MissingDatabaseBindingError;
  }
  if (unavailable !== null) return <ReceiptUnavailable unavailable={unavailable} />;
  if (!record) return <ReceiptNotIssued id={id} />;
  return <IssuedReceipt receipt={record.receipt} receiptHash={record.receiptHash} />;
}

function IssuedReceipt({ receipt, receiptHash }: { receipt: PublicContributionReceipt; receiptHash: string }) {
  const independentReviewers = new Set(receipt.claims.map((claim) => claim.reviewerPersonId)).size;
  return (
    <div className="site-shell app-shell">
      <Header active="receipt" />
      <main className="page-main receipt-main">
        <div className="breadcrumb"><Link href="/explore">Explore</Link><span> / </span><span>Contribution receipt</span></div>
        <section className="receipt-heading"><div><p className="eyebrow">Public evidence record · signed</p><h1>{contributionKindLabel(receipt.kind)}</h1><p>This immutable receipt credits one verified contribution. Its evidence payload is available as canonical JSON.</p></div><span className="record-chip">Issued</span></section>
        <section className="receipt-summary"><div><span>Credited person</span><code>{receipt.beneficiary.personId}</code></div><div><span>Via delegated Agent</span><code>{receipt.beneficiary.agentId}</code></div><div><span>Target</span><strong>{receipt.target.declaration}</strong></div><div><span>Issued</span><strong>{receipt.issuedAt}</strong></div></section>
        <section className="receipt-grid">
          <article className="receipt-card"><p className="eyebrow">Verification stack</p><ReceiptGate label="Delegation certificate" detail={receipt.beneficiary.delegationCertificateId} /><ReceiptGate label="Reproducible bundle" detail="Attested" /><ReceiptGate label="Kernel acceptance" detail="Accepted" /><ReceiptGate label="Independent review" detail={`${receipt.claims.length} attestations · ${independentReviewers} Person${independentReviewers === 1 ? "" : "s"}`} /></article>
          <article className="receipt-card receipt-machine"><p className="eyebrow">Machine evidence</p><dl><div><dt>Receipt ID</dt><dd><code>{receipt.id}</code></dd></div><div><dt>Receipt hash</dt><dd><code>{receiptHash}</code></dd></div><div><dt>Payload hash</dt><dd><code>{receipt.payloadHash}</code></dd></div><div><dt>Artifact bundle</dt><dd><code>{receipt.artifactBundleHash}</code></dd></div><div><dt>Run result</dt><dd><code>{receipt.run.resultHash}</code></dd></div><div><dt>Issuer key</dt><dd><code>{receipt.issuerKeyId}</code></dd></div><div><dt>JSON evidence</dt><dd><Link className="text-link" href={`/api/receipts/${encodeURIComponent(receipt.id)}`}>Open verified JSON <span>→</span></Link></dd></div></dl></article>
        </section>
        <p className="receipt-note">This v1 record is immutable. Supersession, correction, retraction, and issuer-key rotation are not represented by this page yet.</p>
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
      <main className="page-main receipt-main">
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
