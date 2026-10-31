import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, CardTitle, Badge, Field, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";
import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { notFound } from "next/navigation";
import { MissingDatabaseBindingError } from "@/db";
import { getPersonProfileRepository, type PublicPersonProfile } from "@/db/repositories/profiles";
import { type ContributionReceiptKind } from "@/db/repositories/receipts";

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

  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main public-profile-main">
      <Breadcrumb><Link href="/receipts">Contribution Receipts</Link><span> / </span><span>Person record</span></Breadcrumb>
      <SectionHeading as="section" className="public-profile-hero">
        <div className="profile-avatar is-public" aria-hidden="true">{initials(profile.person.displayName)}</div>
        <div><p className="eyebrow">Public mathematical contribution record</p><PageTitle>{profile.person.displayName}</PageTitle><code>{profile.person.id}</code><p>Joined {formatDate(profile.person.joinedAt)} · contributions attributed through personally delegated research Agents.</p></div>
        <Badge className="record-chip">Public evidence only</Badge>
      </SectionHeading>

      <section className="public-profile-stats" aria-label="Public contribution summary">
        <ProfileStat value={profile.summary.verifiedReceipts} label="Verified Receipts" />
        <ProfileStat value={profile.credits.totalUnits} label="Proof Credit" />
        <ProfileStat value={profile.summary.sharedCheckpoints} label="Shared checkpoints" />
        <ProfileStat value={profile.summary.independentReviews} label="Independent reviews" />
        <ProfileStat value={profile.summary.challengeFindings} label="Recorded findings" />
      </section>

      {(profile.receiptKinds.length > 0 || profile.publicAgentLabels.length > 0 || profile.credits.categories.length > 0) && <section className="public-profile-taxonomy" aria-label="Contribution, credit, and Agent attribution">
        <div><span>Receipt mix</span><p>{profile.receiptKinds.length > 0 ? profile.receiptKinds.map((entry) => `${receiptKindLabel(entry.kind)} ${entry.count}`).join(" · ") : "No certified contribution types yet"}</p></div>
        <div><span>Publicly attributed Agents</span><p>{profile.publicAgentLabels.length > 0 ? profile.publicAgentLabels.join(" · ") : "No public Agent attribution yet"}</p></div>
        <div><span>Receipt-derived credit</span><p>{profile.credits.categories.length > 0 ? profile.credits.categories.map((entry) => `${creditCategoryLabel(entry.category)} ${entry.units}`).join(" · ") : "No settled Receipt credit yet"}</p></div>
      </section>}

      <p className="public-profile-disclosure">Receipt counts represent issuer-signed mathematical contributions. Shared checkpoints are Agent-signed research progress and are shown separately; they are not automatically Lean-verified, novel, or credit-eligible.</p>

      <section className="public-profile-section" aria-labelledby="public-receipts-title">
        <SectionHeading as="div" className="profile-section-heading"><div><p className="eyebrow">Certified contributions</p><SectionTitle id="public-receipts-title">Signed Contribution Receipts.</SectionTitle></div><Badge className="record-chip">{profile.receipts.length} records</Badge></SectionHeading>
        {profile.receipts.length === 0 ? <PublicEmpty title="No signed Receipts yet." detail="This Person may have public research checkpoints, but no contribution has completed every Receipt gate." /> : <div className="public-receipt-grid">{profile.receipts.map((receipt) => <Surface as="article" key={receipt.id}><div><span className="micro-label">{receiptKindLabel(receipt.kind)}</span><span className={`receipt-index-status is-${receipt.lifecycleStatus}`}>{receipt.lifecycleStatus}</span></div><CardTitle>{receipt.target.declaration}</CardTitle><FieldList><Field label="Issued">{formatDate(receipt.issuedAt)}</Field><Field label="Dependencies">{receipt.dependencyCount}</Field><Field label="Receipt hash"><code>{shortHash(receipt.receiptHash)}</code></Field></FieldList><Link className="text-link" href={`/receipt/${encodeURIComponent(receipt.id)}`}>Inspect signed evidence <span>→</span></Link></Surface>)}</div>}
      </section>

      <section className="public-profile-section" aria-labelledby="public-checkpoints-title">
        <SectionHeading as="div" className="profile-section-heading"><div><p className="eyebrow">Research trail</p><SectionTitle id="public-checkpoints-title">Recent shared checkpoints.</SectionTitle></div><Badge className="record-chip">Provisional</Badge></SectionHeading>
        {profile.recentCheckpoints.length === 0 ? <PublicEmpty title="No public checkpoints yet." detail="Private workspace activity is never used as a fallback for this public record." /> : <div className="public-checkpoint-list">{profile.recentCheckpoints.map((checkpoint) => <Surface as="article" key={checkpoint.id}><div><span>{checkpoint.kind.replaceAll("_", " ")}</span><time dateTime={checkpoint.occurredAt}>{formatDate(checkpoint.occurredAt)}</time></div><CardTitle>{checkpoint.summary}</CardTitle><p>{checkpoint.target.title}</p><footer><span>via {checkpoint.agentLabel}</span><Link href={`/explore/${encodeURIComponent(checkpoint.target.slug)}#research-graph`}>Open research graph →</Link></footer></Surface>)}</div>}
      </section>

      <section className="public-profile-boundary"><strong>Privacy boundary</strong><p>This page never exposes email, login provider subject, private Evidence, prompts, signing keys, API credentials, Agent connections, or unshared Attempts. It is a projection of public network evidence, not a social score.</p></section>
    </SiteFrame>;
}

function ProfileStat({ value, label }: { value: number; label: string }) {
  return <Surface as="article"><strong>{value}</strong><span>{label}</span></Surface>;
}

function PublicEmpty({ title, detail }: { title: string; detail: string }) {
  return <EmptyState as="div" className="public-profile-empty"><strong>{title}</strong><p>{detail}</p></EmptyState>;
}

function receiptKindLabel(kind: ContributionReceiptKind) {
  return ({ formalization: "Formalization", lemma: "Reusable lemma", proof_patch: "Proof patch", counterexample: "Counterexample", verification: "Independent verification", synthesis: "Synthesis", infrastructure: "Infrastructure" } as const)[kind];
}

function creditCategoryLabel(category: string) {
  return category.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
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
  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main public-profile-main"><SectionHeading as="section" className="review-heading"><div><p className="eyebrow">Public Person record</p><PageTitle>Contribution record unavailable.</PageTitle><p>No unverified identity or contribution data is shown while the public ledger cannot be read.</p></div><Badge className="record-chip">Unavailable</Badge></SectionHeading></SiteFrame>;
}
