import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { getContributionReceiptReader, type PublicContributionReceiptIndexItem } from "@/db/repositories/receipts";

export const dynamic = "force-dynamic";

export default async function ReceiptsPage() {
  let receipts: readonly PublicContributionReceiptIndexItem[] = [];
  let unavailable = false;
  try {
    receipts = await getContributionReceiptReader().listRecent();
  } catch {
    unavailable = true;
  }
  return <SiteFrame className="site-shell app-shell" active="receipt" mainClassName="page-main receipts-main">
      <Breadcrumb><Link href="/explore">Explore</Link><span> / </span><span>Contribution receipts</span></Breadcrumb>
      <SectionHeading as="section" className="receipt-heading"><div><p className="eyebrow">Public evidence index</p><PageTitle>Verified contributions, not activity counts.</PageTitle><p>Every entry is independently hash-checked, issuer-signed, and classified as a public research record before it appears here. Smoke tests and demos remain auditable without becoming mathematical contributions.</p></div><Badge className="record-chip">{unavailable ? "Unavailable" : `${receipts.length} records`}</Badge></SectionHeading>
      <nav className="public-section-nav" aria-label="Contribution records">
        <a href="#receipt-index"><span>Recent receipts</span><b>{unavailable ? "—" : receipts.length}</b></a>
        <Link href="/how-it-works/contribution-records"><span>How records work</span><b aria-hidden="true">→</b></Link>
        <Link href="/explore"><span>Explore research</span><b aria-hidden="true">→</b></Link>
      </nav>
      <div id="receipt-index">
        {unavailable ? <EmptyState as="section" className="receipt-message"><p className="eyebrow">Index unavailable</p><p>Contribution receipt storage is temporarily unavailable. No unverified fallback data is shown.</p></EmptyState> : receipts.length === 0 ? <EmptyState as="section" className="receipt-message receipt-empty-state"><div><p className="eyebrow">No issued public research records yet</p><SectionTitle>See the complete evidence shape before the first eligible Receipt arrives.</SectionTitle><p>Public Receipts require kernel evidence, signed independent attestations, and an explicit research classification. Infrastructure smoke tests and the reference demo remain outside this index.</p></div><ActionLink className="button button-primary" href="/demo#verification-console">Inspect the reference Receipt <span aria-hidden="true">→</span></ActionLink></EmptyState> : <section className="receipt-index-list" aria-label="Verified Contribution Receipts">{receipts.map((receipt) => <ReceiptIndexCard receipt={receipt} key={receipt.id} />)}</section>}
      </div>
    </SiteFrame>;
}

function ReceiptIndexCard({ receipt }: { receipt: PublicContributionReceiptIndexItem }) {
  return <Surface as="article" className="receipt-index-card">
    <div className="receipt-index-card-top"><span className="micro-label">{kindLabel(receipt.kind)}</span><span className={`receipt-index-status is-${receipt.lifecycleStatus}`}>{statusLabel(receipt.lifecycleStatus)}</span></div>
    <Link className="receipt-index-title" href={`/receipt/${encodeURIComponent(receipt.id)}`}>{receipt.target.declaration}</Link>
    <FieldList><Field label="Credited Person"><Link className="person-record-link" href={`/people/${encodeURIComponent(receipt.beneficiaryPersonId)}`}><code>{receipt.beneficiaryPersonId}</code></Link></Field><Field label="Issued">{receipt.issuedAt}</Field><Field label="Upstream evidence">{receipt.dependencyCount === 0 ? "No receipt dependencies" : `${receipt.dependencyCount} receipt ${receipt.dependencyCount === 1 ? "dependency" : "dependencies"}`}</Field><Field label="Receipt hash"><code>{receipt.receiptHash}</code></Field></FieldList>
    <Link className="text-link" href={`/receipt/${encodeURIComponent(receipt.id)}`}>Inspect evidence <span>→</span></Link>
  </Surface>;
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
