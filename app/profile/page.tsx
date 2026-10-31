import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, Field, ActionLink, EmptyState, FieldList, SectionHeading, Surface } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getMcpRepository } from "@/db/repositories/mcp";
import { getPersonProfileRepository, type PublicPersonProfile } from "@/db/repositories/profiles";
import { getProvisionalContributionRepository, ProvisionalContributionSchemaUnavailableError } from "@/db/repositories/provisional-contributions";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";
import { type McpAttempt } from "@/packages/domain/mcp";
import { providerAwareSignOutPath, requireUser, toPersonIdentity, type AuthUser } from "../auth";

import { PersonalWorkspaceFrame } from "../PersonalWorkspaceFrame";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "../lib/read-only-personal-surface";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const readOnly = personalWritesPaused();
  const user = await requireUser("/profile");
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="profile"
      eyebrow="Personal profile · read-only maintenance"
      title="Your private contribution profile is temporarily paused."
      detail={`You are still signed in as ${user.displayName}. Public research and published verification records remain readable, but Proofweave will not load or change private identity, Agent, review, or contribution records until maintenance is complete.`}
    />;
  }
  const data = await loadProfile(user);
  if (!data) return <ProfileUnavailable />;
  const { delegation, publicProfile, attempts, reviews, provisionalBundleCount } = data;
  const activeDelegations = delegation.delegations.filter((item) => item.revokedAt === null).length;
  const activeAgents = delegation.agents.filter((agent) => agent.status === "active").length;
  const activeAttempts = attempts.filter((attempt) => attempt.status === "active").length;
  const activeReviews = reviews.filter((review) => review.status === "assigned" || review.status === "accepted").length;
  const completedReviews = reviews.filter((review) => review.status === "completed").length;
  const activities = recentActivity({ attempts, reviews, publicProfile });

  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main profile-main personal-workspace-main">
      <PersonalWorkspaceFrame active="profile">
      <Breadcrumb><Link href="/workbench">Workspace</Link><span> / </span><span>My profile</span></Breadcrumb>
      <SectionHeading as="section" className="profile-hero">
        <div className="profile-avatar" aria-hidden="true">{initials(user.displayName)}</div>
        <SectionHeading as="div" className="profile-hero-copy"><p className="eyebrow">Your Proofweave Person</p><PageTitle>{user.displayName}</PageTitle><p>{user.email}</p><code>{delegation.person.id}</code></SectionHeading>
        <div className="profile-hero-actions"><ActionLink className="button profile-public-button" href={`/people/${encodeURIComponent(delegation.person.id)}`}>View public contribution record <span>↗</span></ActionLink><Link className="text-link" href={providerAwareSignOutPath(user, "/")}>Sign out <span>→</span></Link></div>
      </SectionHeading>

      <section className="profile-assurance" aria-label="Identity assurance">
        <div><span>Authenticated as</span><strong>{user.providerLabel} account</strong><p>{user.provider === "proofweave" ? "This temporary Build Week identity is isolated from external accounts and is explicitly demo-only." : "Your verified email identifies this private session and is never shown on the public profile."}</p></div>
        <div><span>Attribution root</span><strong>Proofweave Person</strong><p>Agent work, reviews, and Receipts are credited to this stable Person ID.</p></div>
        <div><span>Member since</span><strong>{formatDate(publicProfile.person.joinedAt)}</strong><p>Public evidence remains independently inspectable even if an Agent is later revoked.</p></div>
      </section>

      <section className="profile-section" aria-labelledby="profile-overview-title">
        <SectionHeading as="div" className="profile-section-heading"><div><p className="eyebrow">Personal overview</p><SectionTitle id="profile-overview-title">Your research identity at a glance.</SectionTitle></div><Badge className="record-chip">Private view</Badge></SectionHeading>
        <div className="profile-stat-grid">
          <ProfileStat value={activeAttempts} label="Active Attempts" detail={`${attempts.length} total research attempts`} />
          <ProfileStat value={publicProfile.summary.sharedCheckpoints} label="Shared checkpoints" detail="Public, Agent-signed progress" />
          <ProfileStat value={publicProfile.summary.verifiedReceipts} label="Verified Receipts" detail="Issuer-signed contributions" />
          <ProfileStat value={publicProfile.credits.totalUnits} label="Proof Credit" detail={`${publicProfile.credits.settledReceipts} settled Receipt${publicProfile.credits.settledReceipts === 1 ? "" : "s"}`} />
          <ProfileStat value={completedReviews} label="Completed reviews" detail={`${activeReviews} currently active`} />
          <ProfileStat value={activeAgents} label="Active Agents" detail={`${activeDelegations} live delegations`} />
          <ProfileStat value={provisionalBundleCount} label="Staged Bundles" detail="Private provisional evidence" />
        </div>
      </section>

      <div className="profile-two-column">
        <section className="profile-section profile-activity" aria-labelledby="profile-activity-title">
          <SectionHeading as="div" className="profile-section-heading compact"><div><p className="eyebrow">Recent activity</p><SectionTitle id="profile-activity-title">What your Person and Agents did.</SectionTitle></div><Link className="text-link" href="/workbench">Open workspace <span>→</span></Link></SectionHeading>
          {activities.length === 0 ? <ProfileEmpty title="No recorded activity yet." detail="Choose a public target and start an accountable Attempt with your delegated Agent." action="Explore targets" href="/explore" /> : <ol className="profile-activity-list">{activities.map((activity) => <li key={activity.id}><span className={`profile-activity-mark is-${activity.tone}`} aria-hidden="true" /><div><strong>{activity.title}</strong><p>{activity.detail}</p></div><time dateTime={activity.occurredAt}>{formatDate(activity.occurredAt)}</time></li>)}</ol>}
        </section>

        <aside className="profile-control-card">
          <p className="eyebrow">Agent authority</p><SectionTitle>{activeAgents > 0 && activeDelegations > 0 ? "Your Agent authority is active." : "Finish connecting your research Agent."}</SectionTitle><p>{activeAgents > 0 ? `${activeAgents} active Agent${activeAgents === 1 ? "" : "s"} can act only within ${activeDelegations} recorded delegation${activeDelegations === 1 ? "" : "s"}.` : "Create a Person signing key, register an Agent, and issue a scoped delegation before attributable work can begin."}</p>
          <FieldList><Field label="Signing keys">{delegation.signingKeys.length}</Field><Field label="Connections">{delegation.agentInstallations.filter((item) => item.status === "active").length}</Field><Field label="Credit settlement">{publicProfile.credits.active ? `${publicProfile.credits.totalUnits} settled` : "Unavailable"}</Field></FieldList>
          <ActionLink className="button button-primary" href="/settings">Manage Agent and security <span>→</span></ActionLink>
        </aside>
      </div>

      <section className="profile-privacy-boundary"><div><p className="eyebrow">Public / private boundary</p><SectionTitle>Your contribution record is public. Your account is not.</SectionTitle></div><p>The public page contains only your display name, Person ID, public research checkpoints, signed Receipts, and aggregate review outcomes. Email, provider subject, private evidence, prompts, keys, connection credentials, and unshared workspace data remain private.</p></section>
      </PersonalWorkspaceFrame>
    </SiteFrame>;
}

async function loadProfile(user: AuthUser) {
  try {
    const delegation = await getDelegationRepository().getProfile(toPersonIdentity(user));
    const [publicProfile, attempts, reviews, provisional] = await Promise.all([
      getPersonProfileRepository().findPublicByPersonId(delegation.person.id),
      getMcpRepository().listAttempts(delegation.person.id),
      getReviewAssignmentRepository().listForPerson(delegation.person.id),
      getProvisionalContributionRepository().listForPerson(delegation.person.id),
    ]);
    if (!publicProfile) return null;
    return { delegation, publicProfile, attempts, reviews, provisionalBundleCount: provisional.length };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError || error instanceof ProvisionalContributionSchemaUnavailableError) return null;
    throw error;
  }
}

function ProfileStat({ value, label, detail }: { value: number; label: string; detail: string }) {
  return <Surface as="article"><strong>{value}</strong><span>{label}</span><p>{detail}</p></Surface>;
}

function ProfileEmpty({ title, detail, action, href }: { title: string; detail: string; action: string; href: string }) {
  return <EmptyState as="div" className="profile-empty"><strong>{title}</strong><p>{detail}</p><Link className="text-link" href={href}>{action} <span>→</span></Link></EmptyState>;
}

function recentActivity({ attempts, reviews, publicProfile }: {
  attempts: readonly McpAttempt[];
  reviews: readonly { id: string; target: { title: string }; status: string; assignedAt: string; completedAt: string | null }[];
  publicProfile: PublicPersonProfile;
}) {
  const items = [
    ...attempts.map((attempt) => ({ id: `attempt:${attempt.id}`, tone: "attempt", title: attempt.problemTitle, detail: `${attempt.agentLabel} · Attempt ${attempt.status}`, occurredAt: attempt.updatedAt })),
    ...reviews.map((review) => ({ id: `review:${review.id}`, tone: "review", title: review.target.title, detail: `Independent review · ${review.status}`, occurredAt: review.completedAt ?? review.assignedAt })),
    ...publicProfile.receipts.map((receipt) => ({ id: `receipt:${receipt.id}`, tone: "receipt", title: receipt.target.declaration, detail: `${kindLabel(receipt.kind)} Receipt · ${receipt.lifecycleStatus}`, occurredAt: receipt.issuedAt })),
  ];
  return items.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)).slice(0, 8);
}

function kindLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`.toUpperCase() : (parts[0]?.slice(0, 2).toUpperCase() ?? "PW");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(new Date(value));
}

function ProfileUnavailable() {
  return <SiteFrame className="site-shell app-shell" active="profile" mainClassName="page-main profile-main personal-workspace-main"><PersonalWorkspaceFrame active="profile"><SectionHeading as="section" className="review-heading"><div><p className="eyebrow">Personal profile</p><PageTitle>Your profile is temporarily unavailable.</PageTitle><p>No identity, contribution, or Agent record was changed. Please try again when the account control plane is available.</p></div><Badge className="record-chip">Unavailable</Badge></SectionHeading></PersonalWorkspaceFrame></SiteFrame>;
}
