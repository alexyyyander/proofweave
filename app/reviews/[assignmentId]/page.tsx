import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";
import { hasActiveReviewDelegation } from "@/app/lib/review-authority";
import { Footer } from "@/app/ui";
import { Header } from "@/app/header";
import { PersonalWorkspaceFrame } from "@/app/PersonalWorkspaceFrame";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";
import { ReviewAssignmentWorkspace } from "../ReviewAssignmentWorkspace";

export const dynamic = "force-dynamic";

export default async function ReviewAssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const user = await getCurrentUser();
  if (!user) return <ReviewAssignmentMessage signInPath={signInPath(`/reviews/${encodeURIComponent(assignmentId)}`)} />;
  const result = await loadReviewAssignment(user, assignmentId);
  if (result.unavailable) return <ReviewAssignmentMessage unavailable />;
  if (!result.review) notFound();
  return <div className="site-shell app-shell">
    <Header active="review" />
    <main id="main-content" tabIndex={-1} className="page-main review-main review-workspace-main personal-workspace-main">
      <PersonalWorkspaceFrame active="reviews">
        <div className="breadcrumb"><Link href="/reviews">Verification market</Link><span> / </span><span>Review workspace</span></div>
        <ReviewAssignmentWorkspace initialReview={result.review} hasReviewDelegation={result.hasReviewDelegation} />
      </PersonalWorkspaceFrame>
    </main>
    <Footer />
  </div>;
}

async function loadReviewAssignment(user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>, assignmentId: string) {
  try {
    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    return {
      review: await getReviewAssignmentRepository().getForPerson(profile.person.id, assignmentId),
      hasReviewDelegation: hasActiveReviewDelegation(profile),
      unavailable: false,
    };
  } catch (error) {
    if (error instanceof MissingDatabaseBindingError) return { review: null, hasReviewDelegation: false, unavailable: true };
    throw error;
  }
}

function ReviewAssignmentMessage({ signInPath: loginPath, unavailable }: { signInPath?: string; unavailable?: boolean }) {
  return <div className="site-shell app-shell">
    <Header active="review" />
    <main id="main-content" tabIndex={-1} className="page-main review-main personal-workspace-main">
      <PersonalWorkspaceFrame active="reviews">
        <div className="breadcrumb"><Link href="/reviews">Verification market</Link><span> / </span><span>Controlled review</span></div>
        <section className="review-heading"><div><p className="eyebrow">Person-addressed review</p><h1>{unavailable ? "Review work is temporarily unavailable." : "Sign in to open this review workspace."}</h1><p>{unavailable ? "No unverified fallback assignment is shown while storage is unavailable." : "Only the Person assigned to this independent review can inspect its Bundle, replay state, and immutable decision history."}</p></div><span className="record-chip">{unavailable ? "Unavailable" : "Personal"}</span></section>
        {loginPath && <Link className="button button-primary review-sign-in" href={loginPath}>Sign in to continue <span aria-hidden="true">→</span></Link>}
      </PersonalWorkspaceFrame>
    </main>
    <Footer />
  </div>;
}
