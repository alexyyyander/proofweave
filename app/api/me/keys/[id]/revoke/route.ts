import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const body = await request.json();
    const { id } = await params;
    const result = await getDelegationRepository().revokePersonKey(identity, {
      keyId: id,
      reason: typeof body?.reason === "string" ? body.reason : "",
      emergency: body?.emergency === true,
    });
    return Response.json(
      { revocation: result.revocation, idempotentReplay: !result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return delegationFailure(error);
  }
}
