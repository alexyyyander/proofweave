import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    return Response.json({ profile: await getDelegationRepository().getProfile(identity) });
  } catch (error) {
    return delegationFailure(error);
  }
}
