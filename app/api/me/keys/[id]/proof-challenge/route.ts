import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const { id } = await params;
    const challenge = await getDelegationRepository().issuePersonKeyProofChallenge(identity, id);
    return Response.json({ challenge }, { status: 201 });
  } catch (error) {
    return delegationFailure(error);
  }
}
