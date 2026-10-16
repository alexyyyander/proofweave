import { Breadcrumb } from "@/app/components/navigation/Breadcrumb";
import { PageTitle, Badge, ActionLink, SectionHeading } from "@/app/components/ui";

import { SiteFrame } from "@/app/components/shell/SiteFrame";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, signInPath, toPersonIdentity } from "@/app/auth";
import { hasActiveReviewDelegation } from "@/app/lib/review-authority";

import { PersonalWorkspaceFrame } from "@/app/PersonalWorkspaceFrame";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";
import { ReviewAssignmentWorkspace } from "../ReviewAssignmentWorkspace";
import { personalWritesPaused, ReadOnlyPersonalSurface } from "@/app/lib/read-only-personal-surface";

export const dynamic = "force-dynamic";

export default async function ReviewAssignmentPage({ params }: { params: Promise<{ assignmentId: string }> }) {
  const { assignmentId } = await params;
  const readOnly = personalWritesPaused();
  const user = await getCurrentUser();
  if (!user) return <ReviewAssignmentMessage signInPath={signInPath(`/reviews/${encodeURIComponent(assignmentId)}`)} />;
  if (readOnly) {
    return <ReadOnlyPersonalSurface
      active="review"
      eyebrow="Review workspace · read-only maintenance"
      title="This private review workspace is temporarily paused."
      detail="The assignment and its controlled evidence are not loaded during maintenance. Assignment decisions, replay requests, and signed review submissions are unavailable, and no placeholder review record is shown."
    />;
  }
  const result = await loadReviewAssignment(user, assignmentId);
  if (result.unavailable) return <ReviewAssignmentMessage unavailable />;
  if (!result.review) notFound();
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main review-main review-workspace-main personal-workspace-main">
      <PersonalWorkspaceFrame active="reviews">
        <Breadcrumb><Link href="/reviews">Verification market</Link><span> / </span><span>Review workspace</span></Breadcrumb>
        <ReviewAssignmentWorkspace initialReview={result.review} hasReviewDelegation={result.hasReviewDelegation} />
      </PersonalWorkspaceFrame>
    </SiteFrame>;
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
  return <SiteFrame className="site-shell app-shell" active="review" mainClassName="page-main review-main personal-workspace-main">
      <PersonalWorkspaceFrame active="reviews">
        <Breadcrumb><Link href="/reviews">Verification market</Link><span> / </span><span>Controlled review</span></Breadcrumb>
        <SectionHeading as="section" className="review-heading"><div><p className="eyebrow">Person-addressed review</p><PageTitle>{unavailable ? "Review work is temporarily unavailable." : "Sign in to open this review workspace."}</PageTitle><p>{unavailable ? "No unverified fallback assignment is shown while storage is unavailable." : "Only the Person assigned to this independent review can inspect its Bundle, replay state, and immutable decision history."}</p></div><Badge className="record-chip">{unavailable ? "Unavailable" : "Personal"}</Badge></SectionHeading>
        {loginPath && <ActionLink className="button button-primary review-sign-in" href={loginPath}>Sign in to continue <span aria-hidden="true">→</span></ActionLink>}
      </PersonalWorkspaceFrame>
    </SiteFrame>;
}
