import { currentConnectionIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getConnectionDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await currentConnectionIdentity();
  if (identity instanceof Response) return identity;

  try {
    const { id } = await params;
    const challenge = await getConnectionDelegationRepository().issuePersonKeyProofChallenge(identity, id);
    return Response.json({ challenge }, { status: 201 });
  } catch (error) {
    return delegationFailure(error);
  }
}
