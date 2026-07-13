import Link from "next/link";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository, type DelegationProfile } from "@/db/repositories/delegation";
import { getReviewAssignmentRepository, type ReviewAssignmentSummary } from "@/db/repositories/reviews";
import { closedAlphaReviewLimits } from "@/packages/domain/attempt-policy.mjs";
import { chatGPTSignInPath, getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { Footer, Header } from "../ui";
import { ReviewQueueClient } from "./ReviewQueueClient";

export const dynamic = "force-dynamic";

export default async function ReviewsPage() {
  const user = await getChatGPTUser();
  const result = await loadReviews(user);
  if (!user) return <ReviewMessage unauthenticated />;
  if (!result.storageAvailable) return <ReviewMessage unavailable />;

  const activeAssignments = result.assignments.filter((assignment) => assignment.status === "assigned" || assignment.status === "accepted").length;
  return <div className="site-shell app-shell">
    <Header active="review" />
    <main className="page-main review-main">
      <div className="breadcrumb"><Link href="/workbench">Workbench</Link><span> / </span><span>Independent review</span></div>
      <section className="review-heading"><div><p className="eyebrow">Verification queue · closed alpha</p><h1>Review another person’s evidence.</h1><p>Assignments are addressed to a Person. A different owner’s review-scoped Agent must supply the signed attestation through the separately deployed remote connection; accepting a task alone never verifies a theorem.</p></div><span className="record-chip">{activeAssignments}/{closedAlphaReviewLimits.maximumActiveAssignmentsPerPerson} active</span></section>
      <ReviewQueueClient initialAssignments={result.assignments} hasReviewDelegation={hasActiveReviewDelegation(result.profile)} />
    </main>
    <Footer />
  </div>;
}

async function loadReviews(user: ChatGPTUser | null): Promise<{ profile: DelegationProfile | null; assignments: readonly ReviewAssignmentSummary[]; storageAvailable: boolean }> {
  if (!user) return { profile: null, assignments: [], storageAvailable: true };
  try {
    const profile = await getDelegationRepository().getProfile({
      provider: "chatgpt",
      subject: user.email,
      displayName: user.displayName,
    });
    return {
      profile,
      assignments: await getReviewAssignmentRepository().listForPerson(profile.person.id),
      storageAvailable: true,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { profile: null, assignments: [], storageAvailable: false };
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

function ReviewMessage({ unauthenticated, unavailable }: { unauthenticated?: boolean; unavailable?: boolean }) {
  const title = unauthenticated ? "Sign in to view your review queue." : "Review assignments are temporarily unavailable.";
  const detail = unauthenticated
    ? "Independent review work is addressed to a Person and appears only in that Person’s closed-alpha queue."
    : "No review action was taken while the control plane was unavailable.";
  return <div className="site-shell app-shell">
    <Header active="review" />
    <main className="page-main review-main">
      <div className="breadcrumb"><Link href="/how-it-works">Protocol</Link><span> / </span><span>Independent review</span></div>
      <section className="review-heading"><div><p className="eyebrow">Verification queue</p><h1>{title}</h1><p>{detail}</p></div><span className="record-chip">{unavailable ? "Unavailable" : "Personal"}</span></section>
      {unauthenticated && <Link className="button button-primary review-sign-in" href={chatGPTSignInPath("/reviews")}>Sign in to review <span aria-hidden="true">→</span></Link>}
    </main>
    <Footer />
  </div>;
}
