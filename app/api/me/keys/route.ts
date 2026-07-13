import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const body = await request.json();
    const publicKey = typeof body?.publicKey === "string" ? body.publicKey : "";
    const result = await getDelegationRepository().registerPersonKey(identity, publicKey);
    return Response.json({ key: result.key, idempotentReplay: !result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return delegationFailure(error);
  }
}
