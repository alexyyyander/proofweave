import { currentDelegationIdentity } from "@/app/lib/delegation-api";
import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import {
  ReviewAssignmentConflictError,
  ReviewAssignmentNotFoundError,
  isReviewAssignmentFailure,
} from "@/db/repositories/reviews";

export async function currentReviewPersonId(): Promise<string | Response> {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;
  const profile = await getDelegationRepository().getProfile(identity);
  return profile.person.id;
}

export function reviewFailure(error: unknown): Response {
  if (error instanceof MissingDatabaseBindingError) {
    return Response.json(
      { error: { code: "unavailable", message: "Review assignments are temporarily unavailable." } },
      { status: 503 },
    );
  }
  if (error instanceof ReviewAssignmentNotFoundError) {
    return Response.json(
      { error: { code: "not_found", message: "Review assignment not found." } },
      { status: 404 },
    );
  }
  if (error instanceof ReviewAssignmentConflictError || isReviewAssignmentFailure(error)) {
    return Response.json(
      { error: { code: "conflict", message: error instanceof Error ? error.message : "Review assignment cannot make that transition." } },
      { status: 409 },
    );
  }
  return Response.json(
    { error: { code: "unavailable", message: "Review assignments are temporarily unavailable." } },
    { status: 503 },
  );
}
