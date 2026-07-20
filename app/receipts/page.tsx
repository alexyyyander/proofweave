import Link from "next/link";
import {
  getContributionReceiptReader,
  type PublicContributionReceiptIndexItem,
} from "@/db/repositories/receipts";
import { Footer } from "../ui";
import { Header } from "../header";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  let receipts: readonly PublicContributionReceiptIndexItem[] = [];
  let unavailable = false;
  try {
    receipts = await getContributionReceiptReader().listRecent();
  } catch {
    unavailable = true;
  }
  return <div className="site-shell app-shell">
    <Header active="receipt" />
    <main id="main-content" tabIndex={-1} className="page-main receipts-main">
      <div className="breadcrumb"><Link href="/explore">Explore</Link><span> / </span><span>Contribution receipts</span></div>
      <section className="receipt-heading"><div><p className="eyebrow">Public evidence index</p><h1>Verified contributions, not activity counts.</h1><p>Every entry is independently hash-checked, issuer-signed, and classified as a public research record before it appears here. Smoke tests and demos remain auditable without becoming mathematical contributions.</p></div><span className="record-chip">{unavailable ? "Unavailable" : `${receipts.length} records`}</span></section>
      <nav className="public-section-nav" aria-label="Contribution records">
        <a href="#receipt-index"><span>Recent receipts</span><b>{unavailable ? "—" : receipts.length}</b></a>
        <Link href="/how-it-works/contribution-records"><span>How records work</span><b aria-hidden="true">→</b></Link>
        <Link href="/explore"><span>Explore research</span><b aria-hidden="true">→</b></Link>
      </nav>
      <div id="receipt-index">
        {unavailable ? <section className="receipt-message"><p className="eyebrow">Index unavailable</p><p>Contribution receipt storage is temporarily unavailable. No unverified fallback data is shown.</p></section> : receipts.length === 0 ? <section className="receipt-message receipt-empty-state"><div><p className="eyebrow">No issued public research records yet</p><h2>See the complete evidence shape before the first eligible Receipt arrives.</h2><p>Public Receipts require kernel evidence, signed independent attestations, and an explicit research classification. Infrastructure smoke tests and the reference demo remain outside this index.</p></div><Link className="button button-primary" href="/demo#verification-console">Inspect the reference Receipt <span aria-hidden="true">→</span></Link></section> : <section className="receipt-index-list" aria-label="Verified Contribution Receipts">{receipts.map((receipt) => <ReceiptIndexCard receipt={receipt} key={receipt.id} />)}</section>}
      </div>
    </main>
    <Footer />
  </div>;
}

function ReceiptIndexCard({ receipt }: { receipt: PublicContributionReceiptIndexItem }) {
  return <article className="receipt-index-card">
    <div className="receipt-index-card-top"><span className="micro-label">{kindLabel(receipt.kind)}</span><span className={`receipt-index-status is-${receipt.lifecycleStatus}`}>{statusLabel(receipt.lifecycleStatus)}</span></div>
    <Link className="receipt-index-title" href={`/receipt/${encodeURIComponent(receipt.id)}`}>{receipt.target.declaration}</Link>
    <dl><div><dt>Credited Person</dt><dd><Link className="person-record-link" href={`/people/${encodeURIComponent(receipt.beneficiaryPersonId)}`}><code>{receipt.beneficiaryPersonId}</code></Link></dd></div><div><dt>Issued</dt><dd>{receipt.issuedAt}</dd></div><div><dt>Upstream evidence</dt><dd>{receipt.dependencyCount === 0 ? "No receipt dependencies" : `${receipt.dependencyCount} receipt ${receipt.dependencyCount === 1 ? "dependency" : "dependencies"}`}</dd></div><div><dt>Receipt hash</dt><dd><code>{receipt.receiptHash}</code></dd></div></dl>
    <Link className="text-link" href={`/receipt/${encodeURIComponent(receipt.id)}`}>Inspect evidence <span>→</span></Link>
  </article>;
}

function kindLabel(kind: PublicContributionReceiptIndexItem["kind"]) {
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

function statusLabel(status: PublicContributionReceiptIndexItem["lifecycleStatus"]) {
  return {
    issued: "Issued",
    corrected: "Corrected",
    superseded: "Superseded",
    retracted: "Retracted",
  }[status];
}
