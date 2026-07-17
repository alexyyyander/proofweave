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
    const installation = await getDelegationRepository().revokeAgentInstallation(identity, {
      installationId: id,
      reason: typeof body?.reason === "string" ? body.reason : "Owner revoked this Agent connection.",
      revokedAt: typeof body?.revokedAt === "string" ? body.revokedAt : new Date().toISOString(),
    });
    return Response.json({ installation });
  } catch (error) {
    return delegationFailure(error);
  }
}
