import { currentConnectionIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { getConnectionDelegationRepository } from "@/db/repositories/delegation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const identity = await currentConnectionIdentity();
  if (identity instanceof Response) return identity;

  try {
    const body = await request.json();
    const result = await getConnectionDelegationRepository().registerAgent(identity, {
      agentId: typeof body?.agentId === "string" ? body.agentId : "",
      label: typeof body?.label === "string" ? body.label : "",
      publicKey: typeof body?.publicKey === "string" ? body.publicKey : "",
    });
    return Response.json({ agent: result.agent, idempotentReplay: !result.created }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return delegationFailure(error);
  }
}
