import Link from "next/link";
import { notFound } from "next/navigation";
import { MissingDatabaseBindingError } from "@/db";
import { getPersonProfileRepository, type PublicPersonProfile } from "@/db/repositories/profiles";
import type { ContributionReceiptKind } from "@/db/repositories/receipts";
import { Footer } from "../../ui";
import { Header } from "../../header";

export const dynamic = "force-dynamic";

export default async function PublicPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let profile: PublicPersonProfile | null = null;
  try {
    profile = await getPersonProfileRepository().findPublicByPersonId(id);
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return <PublicProfileUnavailable />;
    throw error;
  }
  if (!profile) notFound();

  return <div className="site-shell app-shell">
    <Header active="profile" />
    <main id="main-content" tabIndex={-1} className="page-main public-profile-main">
      <div className="breadcrumb"><Link href="/receipts">Contribution Receipts</Link><span> / </span><span>Person record</span></div>
      <section className="public-profile-hero">
        <div className="profile-avatar is-public" aria-hidden="true">{initials(profile.person.displayName)}</div>
        <div><p className="eyebrow">Public mathematical contribution record</p><h1>{profile.person.displayName}</h1><code>{profile.person.id}</code><p>Joined {formatDate(profile.person.joinedAt)} · contributions attributed through personally delegated research Agents.</p></div>
        <span className="record-chip">Public evidence only</span>
      </section>

      <section className="public-profile-stats" aria-label="Public contribution summary">
        <ProfileStat value={profile.summary.verifiedReceipts} label="Verified Receipts" />
        <ProfileStat value={profile.summary.sharedCheckpoints} label="Shared checkpoints" />
        <ProfileStat value={profile.summary.independentReviews} label="Independent reviews" />
        <ProfileStat value={profile.summary.challengeFindings} label="Recorded findings" />
      </section>

      {(profile.receiptKinds.length > 0 || profile.publicAgentLabels.length > 0) && <section className="public-profile-taxonomy" aria-label="Contribution and Agent attribution">
        <div><span>Receipt mix</span><p>{profile.receiptKinds.length > 0 ? profile.receiptKinds.map((entry) => `${receiptKindLabel(entry.kind)} ${entry.count}`).join(" · ") : "No certified contribution types yet"}</p></div>
        <div><span>Publicly attributed Agents</span><p>{profile.publicAgentLabels.length > 0 ? profile.publicAgentLabels.join(" · ") : "No public Agent attribution yet"}</p></div>
      </section>}

      <p className="public-profile-disclosure">Receipt counts represent issuer-signed mathematical contributions. Shared checkpoints are Agent-signed research progress and are shown separately; they are not automatically Lean-verified, novel, or credit-eligible.</p>

      <section className="public-profile-section" aria-labelledby="public-receipts-title">
        <div className="profile-section-heading"><div><p className="eyebrow">Certified contributions</p><h2 id="public-receipts-title">Signed Contribution Receipts.</h2></div><span className="record-chip">{profile.receipts.length} records</span></div>
        {profile.receipts.length === 0 ? <PublicEmpty title="No signed Receipts yet." detail="This Person may have public research checkpoints, but no contribution has completed every Receipt gate." /> : <div className="public-receipt-grid">{profile.receipts.map((receipt) => <article key={receipt.id}><div><span className="micro-label">{receiptKindLabel(receipt.kind)}</span><span className={`receipt-index-status is-${receipt.lifecycleStatus}`}>{receipt.lifecycleStatus}</span></div><h3>{receipt.target.declaration}</h3><dl><div><dt>Issued</dt><dd>{formatDate(receipt.issuedAt)}</dd></div><div><dt>Dependencies</dt><dd>{receipt.dependencyCount}</dd></div><div><dt>Receipt hash</dt><dd><code>{shortHash(receipt.receiptHash)}</code></dd></div></dl><Link className="text-link" href={`/receipt/${encodeURIComponent(receipt.id)}`}>Inspect signed evidence <span>→</span></Link></article>)}</div>}
      </section>

      <section className="public-profile-section" aria-labelledby="public-checkpoints-title">
        <div className="profile-section-heading"><div><p className="eyebrow">Research trail</p><h2 id="public-checkpoints-title">Recent shared checkpoints.</h2></div><span className="record-chip">Provisional</span></div>
        {profile.recentCheckpoints.length === 0 ? <PublicEmpty title="No public checkpoints yet." detail="Private workspace activity is never used as a fallback for this public record." /> : <div className="public-checkpoint-list">{profile.recentCheckpoints.map((checkpoint) => <article key={checkpoint.id}><div><span>{checkpoint.kind.replaceAll("_", " ")}</span><time dateTime={checkpoint.occurredAt}>{formatDate(checkpoint.occurredAt)}</time></div><h3>{checkpoint.summary}</h3><p>{checkpoint.target.title}</p><footer><span>via {checkpoint.agentLabel}</span><Link href={`/explore/${encodeURIComponent(checkpoint.target.slug)}#research-graph`}>Open research graph →</Link></footer></article>)}</div>}
      </section>

      <section className="public-profile-boundary"><strong>Privacy boundary</strong><p>This page never exposes email, login provider subject, private Evidence, prompts, signing keys, API credentials, Agent connections, or unshared Attempts. It is a projection of public network evidence, not a social score.</p></section>
    </main>
    <Footer />
  </div>;
}

function ProfileStat({ value, label }: { value: number; label: string }) {
  return <article><strong>{value}</strong><span>{label}</span></article>;
}

function PublicEmpty({ title, detail }: { title: string; detail: string }) {
  return <div className="public-profile-empty"><strong>{title}</strong><p>{detail}</p></div>;
}

function receiptKindLabel(kind: ContributionReceiptKind) {
  return ({ formalization: "Formalization", lemma: "Reusable lemma", proof_patch: "Proof patch", counterexample: "Counterexample", verification: "Independent verification", synthesis: "Synthesis", infrastructure: "Infrastructure" } as const)[kind];
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase() : (parts[0]?.slice(0, 2).toUpperCase() ?? "PW");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function shortHash(value: string) {
  return `${value.slice(0, 16)}…${value.slice(-8)}`;
}

function PublicProfileUnavailable() {
  return <div className="site-shell app-shell"><Header active="profile" /><main id="main-content" tabIndex={-1} className="page-main public-profile-main"><section className="review-heading"><div><p className="eyebrow">Public Person record</p><h1>Contribution record unavailable.</h1><p>No unverified identity or contribution data is shown while the public ledger cannot be read.</p></div><span className="record-chip">Unavailable</span></section></main><Footer /></div>;
}
