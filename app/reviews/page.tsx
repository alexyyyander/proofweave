import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, SectionTitle, Badge, ActionLink, EmptyState, SectionHeading } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getReviewAssignmentRepository, type ReviewAssignmentSummary } from "@/db/repositories/reviews";
import { getVerificationMarketRepository, type PublicVerificationJob, VerificationMarketSchemaUnavailableError } from "@/db/repositories/verification-market";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";
import { getCurrentUser, signInPath, toPersonIdentity, type AuthUser } from "../auth";

import { hasActiveReviewDelegation } from "../lib/review-authority";
import { ReviewQueueClient } from "./ReviewQueueClient";
import { VerificationMarketBoard } from "./VerificationMarketBoard";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "../lib/read-only-personal-surface";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="review"
      eyebrow="Verification market · read-only maintenance"
      title="Review assignments are temporarily paused."
      detail={user
        ? "Public questions and published verification records remain readable. Your private review queue is not loaded, and claiming, accepting, declining, or submitting a review is unavailable during maintenance."
        : "Public questions and published verification records remain readable. Claiming review work and opening a personal review queue will return after maintenance."}
    >
      <section className="workspace-onboarding-boundary" aria-label="Verification information">
        <strong>Verification remains inspectable.</strong>
        <p>Learn how Bundle evidence, independent ownership, and claim-specific decisions remain separate from a Lean execution result.</p>
        <Link href="/how-it-works/verification">How verification works <span aria-hidden="true">→</span></Link>
      </section>
    </ReadOnlyPersonalSurface>;
  }
  const result = await loadReviews(user);
  if (!result.storageAvailable) return <ReviewMessage unavailable />;

  const activeAssignments = result.assignments.filter((assignment) => assignment.status === "assigned" || assignment.status === "accepted").length;
  const hasReviewDelegation = hasActiveReviewDelegation(result.profile);
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main review-main">
      <Breadcrumb><Link href="/explore">Explore</Link><span> / </span><span>Verification market</span></Breadcrumb>
      <SectionHeading as="section" className="review-heading"><div><p className="eyebrow">Verification market · public work board</p><PageTitle>Verify evidence. Become eligible for review credit.</PageTitle><p>Choose a claim pinned to another Person’s staged Bundle. Your review Agent performs the check and signs the decision; eligibility becomes settled credit only if the target later closes through a valid Receipt.</p></div><Badge className="record-chip">{result.jobs.length} open</Badge></SectionHeading>
      <nav className="public-section-nav" aria-label="Verification page">
        <a href="#open-review-work"><span>Open work</span><b>{result.jobs.length}</b></a>
        <a href="#my-review-work"><span>My reviews</span><b>{user ? activeAssignments : "Sign in"}</b></a>
        <Link href="/how-it-works/verification"><span>How verification works</span><b aria-hidden="true">→</b></Link>
      </nav>
      <VerificationMarketBoard
        initialJobs={result.jobs}
        signedIn={Boolean(user)}
        hasReviewDelegation={hasReviewDelegation}
        signInPath={signInPath("/reviews")}
      />
      <SectionHeading as="section" className="personal-review-heading" id="my-review-work" aria-labelledby="personal-review-title">
        <div><p className="eyebrow">Personal workspace</p><SectionTitle id="personal-review-title">{user ? "Your accepted and assigned reviews." : "Sign in to claim and complete reviews."}</SectionTitle><p>{user ? "Assignments belong to your Person identity. Multiple Agents do not increase capacity or satisfy independent-owner rules." : "The public board is visible without an account. Signing in establishes the Person identity used for ownership separation, assignment history, and contribution attribution."}</p></div>
        <Badge className="record-chip">{user ? `${activeAssignments}/${closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active` : "Person-scoped"}</Badge>
      </SectionHeading>
      {user
        ? <ReviewQueueClient initialAssignments={result.assignments} hasReviewDelegation={hasReviewDelegation} />
        : <EmptyState as="section" className="review-empty review-sign-in-panel"><p className="eyebrow">Personal queue</p><SectionTitle>No anonymous assignments.</SectionTitle><p>Sign in first, then activate a review-scoped Agent delegation. Claiming a job creates an accepted assignment immediately, but never fabricates a mathematical attestation.</p><ActionLink className="button button-primary review-sign-in" href={signInPath("/reviews")}>Sign in to review <span aria-hidden="true">→</span></ActionLink></EmptyState>}
    </SiteFrame>;
}

async function loadReviews(user: AuthUser | null): Promise<{ profile: DelegationProfile | null; assignments: readonly ReviewAssignmentSummary[]; jobs: readonly PublicVerificationJob[]; storageAvailable: boolean }> {
  try {
    const jobsPromise = getVerificationMarketRepository().listOpenJobs();
    if (!user) return { profile: null, assignments: [], jobs: await jobsPromise, storageAvailable: true };
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    return {
      profile,
      assignments: await getReviewAssignmentRepository().listForPerson(profile.person.id),
      jobs: await jobsPromise,
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError || error instanceof VerificationMarketSchemaUnavailableError) {
      return { profile: null, assignments: [], jobs: [], storageAvailable: false };
    }
    throw error;
  }
}

function ReviewMessage({ unavailable }: { unavailable?: boolean }) {
  const title = "Verification work is temporarily unavailable.";
  const detail = "No market claim or review action was taken while the control plane was unavailable.";
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main review-main">
      <Breadcrumb><Link href="/explore">Explore</Link><span> / </span><span>Verification market</span></Breadcrumb>
      <SectionHeading as="section" className="review-heading"><div><p className="eyebrow">Verification queue</p><PageTitle>{title}</PageTitle><p>{detail}</p></div><Badge className="record-chip">{unavailable ? "Unavailable" : "Personal"}</Badge></SectionHeading>
    </SiteFrame>;
}
