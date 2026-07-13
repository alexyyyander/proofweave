import { MissingDatabaseBindingError } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const delegation = await getDelegationRepository().getPublicDelegation(id);
    if (!delegation) {
      return Response.json(
        { error: { code: "not_found", message: "Delegation certificate not found." } },
        { status: 404 },
      );
    }

    // Revocation is a later append-only event, so this representation must not
    // be cached as immutable even though its signed certificate is immutable.
    return Response.json(
      { delegation },
      { headers: { "cache-control": "public, max-age=300, s-maxage=300" } },
    );
  } catch (error) {
    const status = error instanceof MissingDatabaseBindingError ? 503 : 500;
    return Response.json(
      { error: { code: "unavailable", message: "Delegation evidence is temporarily unavailable." } },
      { status },
    );
  }
}
