import { currentReviewPersonId, reviewFailure } from "@/app/lib/review-api";
import { getReviewAssignmentRepository } from "@/db/repositories/reviews";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const personId = await currentReviewPersonId();
    if (personId instanceof Response) return personId;
    const { id } = await params;
    const review = await getReviewAssignmentRepository().getForPerson(personId, id);
    if (!review) {
      return Response.json(
        { error: { code: "not_found", message: "Review assignment not found." } },
        { status: 404 },
      );
    }
    return Response.json({ review });
  } catch (error) {
    return reviewFailure(error);
  }
}
