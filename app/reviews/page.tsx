import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getReviewAssignmentRepository, type ReviewAssignmentSummary } from "@/db/repositories/reviews";
import {
  getVerificationMarketRepository,
  type PublicVerificationJob,
  VerificationMarketSchemaUnavailableError,
} from "@/db/repositories/verification-market";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";
import { chatGPTSignInPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { Footer, Header } from "../ui";
import { ReviewQueueClient } from "./ReviewQueueClient";
import { VerificationMarketBoard } from "./VerificationMarketBoard";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await getChatGPTUser();
  const result = await loadReviews(user);
  if (!result.storageAvailable) return <ReviewMessage unavailable />;

  const activeAssignments = result.assignments.filter((assignment) => assignment.status === "assigned" || assignment.status === "accepted").length;
  const hasReviewDelegation = hasActiveReviewDelegation(result.profile);
  return <div className="site-shell app-shell">
    <Header active="review" />
    <main id="main-content" tabIndex={-1} className="page-main review-main">
      <div className="breadcrumb"><Link href="/explore">Research frontier</Link><span> / </span><span>Verification market</span></div>
      <section className="review-heading"><div><p className="eyebrow">Verification market · public work board</p><h1>Verify evidence. Become eligible for review credit.</h1><p>Choose a claim pinned to another Person’s staged Bundle. Your review Agent performs the check and signs the decision; eligibility becomes settled credit only if the target later closes through a valid Receipt.</p></div><span className="record-chip">{result.jobs.length} open</span></section>
      <VerificationMarketBoard
        initialJobs={result.jobs}
        signedIn={Boolean(user)}
        hasReviewDelegation={hasReviewDelegation}
        signInPath={chatGPTSignInPath("/reviews")}
      />
      <section className="personal-review-heading" aria-labelledby="personal-review-title">
        <div><p className="eyebrow">Personal workspace</p><h2 id="personal-review-title">{user ? "Your accepted and assigned reviews." : "Sign in to claim and complete reviews."}</h2><p>{user ? "Assignments belong to your Person identity. Multiple Agents do not increase capacity or satisfy independent-owner rules." : "The public board is visible without an account. Signing in establishes the Person identity used for ownership separation, assignment history, and contribution attribution."}</p></div>
        <span className="record-chip">{user ? `${activeAssignments}/${closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active` : "Person-scoped"}</span>
      </section>
      {user
        ? <ReviewQueueClient initialAssignments={result.assignments} hasReviewDelegation={hasReviewDelegation} />
        : <section className="review-empty review-sign-in-panel"><p className="eyebrow">Personal queue</p><h2>No anonymous assignments.</h2><p>Sign in first, then activate a review-scoped Agent delegation. Claiming a job creates an accepted assignment immediately, but never fabricates a mathematical attestation.</p><Link className="button button-primary review-sign-in" href={chatGPTSignInPath("/reviews")}>Sign in to review <span aria-hidden="true">→</span></Link></section>}
    </main>
    <Footer />
  </div>;
}

async function loadReviews(user: ChatGPTUser | null): Promise<{ profile: DelegationProfile | null; assignments: readonly ReviewAssignmentSummary[]; jobs: readonly PublicVerificationJob[]; storageAvailable: boolean }> {
  try {
    const jobsPromise = getVerificationMarketRepository().listOpenJobs();
    if (!user) return { profile: null, assignments: [], jobs: await jobsPromise, storageAvailable: true };
    const profile = await getDelegationRepository().getProfile({
      provider: "chatgpt",
      subject: user.email,
      displayName: user.displayName,
    });
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

function hasActiveReviewDelegation(profile: DelegationProfile | null) {
  const now = Date.now();
  return Boolean(profile?.delegations.some((delegation) =>
    delegation.revokedAt === null &&
    delegation.scopes.includes("review") &&
    Date.parse(delegation.validFrom) <= now &&
    now < Date.parse(delegation.validUntil),
  ));
}

function ReviewMessage({ unavailable }: { unavailable?: boolean }) {
  const title = "Verification work is temporarily unavailable.";
  const detail = "No market claim or review action was taken while the control plane was unavailable.";
  return <div className="site-shell app-shell">
    <Header active="review" />
    <main id="main-content" tabIndex={-1} className="page-main review-main">
      <div className="breadcrumb"><Link href="/how-it-works">Protocol</Link><span> / </span><span>Independent review</span></div>
      <section className="review-heading"><div><p className="eyebrow">Verification queue</p><h1>{title}</h1><p>{detail}</p></div><span className="record-chip">{unavailable ? "Unavailable" : "Personal"}</span></section>
    </main>
    <Footer />
  </div>;
}
