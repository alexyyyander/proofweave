import { currentConnectionIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getConnectionDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentConnectionIdentity();
  if (identity instanceof Response) return identity;

  try {
    return Response.json({ profile: await getConnectionDelegationRepository().getProfile(identity) });
  } catch (error) {
    return delegationFailure(error);
  }
}
