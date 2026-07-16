import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { apiError, mcpFailure } from "@/app/lib/mcp-api";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getMcpRepository, McpAttemptNotActiveError } from "@/db/repositories/mcp";

export const dynamic = "force-dynamic";

/**
 * Closing is an owner action, not an Agent-authored mathematical event. It
 * makes the Attempt terminal while retaining every durable evidence record.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const body = await request.json().catch(() => null);
    if (body?.action !== "cancel") {
      return apiError("invalid_input", "The supported Attempt lifecycle action is cancel.", 400);
    }
    const profile = await getDelegationRepository().getProfile(identity);
    const { id } = await params;
    const result = await getMcpRepository().cancelAttempt(profile.person.id, id);
    if (!result) return apiError("not_found", "Attempt not found.", 404);
    return Response.json({
      attempt: result.value,
      idempotentReplay: !result.changed,
      note: "The Attempt is closed and retained in history. Existing evidence remains inspectable; closing does not verify, reject, or delete mathematical work.",
    });
  } catch (error) {
    if (error instanceof McpAttemptNotActiveError) return mcpFailure(error);
    return delegationFailure(error);
  }
}
