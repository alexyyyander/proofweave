import { currentReviewPersonId, reviewFailure } from "@/app/lib/review-api";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const personId = await currentReviewPersonId();
    if (personId instanceof Response) return personId;
    const { id } = await params;
    const review = await getReviewAssignmentRepository().acceptForPerson(
      personId,
      id,
      new Date().toISOString(),
    );
    return Response.json({ review });
  } catch (error) {
    return reviewFailure(error);
  }
}
