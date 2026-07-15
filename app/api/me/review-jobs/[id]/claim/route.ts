import { currentReviewPersonId } from "@/app/lib/review-api";
import { MissingDatabaseBindingError } from "@/db";
import {
  getVerificationMarketRepository,
  VerificationMarketConflictError,
  VerificationMarketNotFoundError,
  VerificationMarketSchemaUnavailableError,
  VerificationMarketValidationError,
} from "@/db/repositories/verification-market";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const personId = await currentReviewPersonId();
    if (personId instanceof Response) return personId;
    const { id } = await context.params;
    const claim = await getVerificationMarketRepository().claimForPerson(
      personId,
      decodeURIComponent(id),
      new Date().toISOString(),
    );
    return Response.json({ claim });
  } catch (error) {
    if (error instanceof VerificationMarketNotFoundError) {
      return Response.json(
        { error: { code: "not_found", message: "Verification job not found." } },
        { status: 404 },
      );
    }
    if (error instanceof VerificationMarketConflictError || error instanceof VerificationMarketValidationError) {
      return Response.json(
        { error: { code: "conflict", message: error.message } },
        { status: 409 },
      );
    }
    if (
      error instanceof MissingDatabaseBindingError ||
      error instanceof VerificationMarketSchemaUnavailableError
    ) {
      return Response.json(
        { error: { code: "unavailable", message: "The verification market is temporarily unavailable." } },
        { status: 503 },
      );
    }
    return Response.json(
      { error: { code: "unavailable", message: "The verification job could not be claimed." } },
      { status: 503 },
    );
  }
}
