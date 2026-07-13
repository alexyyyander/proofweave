import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const body = await request.json();
    const result = await getDelegationRepository().issueDelegation(identity, {
      personKeyId: typeof body?.personKeyId === "string" ? body.personKeyId : "",
      certificate: body?.certificate,
      personSignature: typeof body?.personSignature === "string" ? body.personSignature : "",
    });
    return Response.json(
      { delegation: result.delegation, idempotentReplay: !result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return delegationFailure(error);
  }
}
