import { currentConnectionIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getConnectionDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await currentConnectionIdentity();
  if (identity instanceof Response) return identity;

  try {
    const body = await request.json();
    const { id } = await params;
    const delegation = await getConnectionDelegationRepository().revokeDelegation(identity, {
      delegationId: id,
      reason: typeof body?.reason === "string" ? body.reason : "",
      revokedAt: typeof body?.revokedAt === "string" ? body.revokedAt : new Date().toISOString(),
    });
    return Response.json({ delegation });
  } catch (error) {
    return delegationFailure(error);
  }
}
