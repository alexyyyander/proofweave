import { currentReviewPersonId, reviewFailure } from "@/app/lib/review-api";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const personId = await currentReviewPersonId();
    if (personId instanceof Response) return personId;
    const assignments = await getReviewAssignmentRepository().listForPerson(personId);
    return Response.json({ assignments });
  } catch (error) {
    return reviewFailure(error);
  }
}
