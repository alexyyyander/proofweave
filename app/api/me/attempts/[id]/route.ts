import { currentDelegationIdentity, delegationFailure } from "@/app/lib/delegation-api";
import { apiError, mcpFailure } from "@/app/lib/mcp-api";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { getMcpRepository, McpAttemptNotActiveError, McpAttemptQuotaExceededError } from "@/db/repositories/mcp";
import { activeAttemptDelegation } from "@/app/lib/local-agent-journey";

export const dynamic = "force-dynamic";

/**
 * Lifecycle transitions are owner actions, not Agent-authored mathematical
 * events. Pause/resume preserves the stable Attempt id; abandon is terminal.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;

  try {
    const body = await request.json().catch(() => null);
    const action = body?.action;
    if (action !== "pause" && action !== "resume" && action !== "abandon" && action !== "cancel") {
      return apiError("invalid_input", "Attempt action must be pause, resume, or abandon.", 400);
    }
    const profile = await getDelegationRepository().getProfile(identity);
    const { id } = await params;
    const mcp = getMcpRepository();
    const current = await mcp.findAttempt(profile.person.id, id);
    if (!current) return apiError("not_found", "Attempt not found.", 404);
    if (action === "resume" && !activeAttemptDelegation(profile, current)) {
      return apiError(
        "precondition_failed",
        "Resume requires active delegated authority for the same Agent and work scope. Reconnect that Agent first.",
        412,
      );
    }
    const result = action === "cancel"
      ? await mcp.cancelAttempt(profile.person.id, id)
      : await mcp.transitionAttempt(profile.person.id, id, action);
    if (!result) return apiError("not_found", "Attempt not found.", 404);
    return Response.json({
      attempt: result.value,
      idempotentReplay: !result.changed,
      note: lifecycleNote(action),
    });
  } catch (error) {
    if (error instanceof McpAttemptNotActiveError || error instanceof McpAttemptQuotaExceededError) return mcpFailure(error);
    return delegationFailure(error);
  }
}

function lifecycleNote(action: "pause" | "resume" | "abandon" | "cancel"): string {
  if (action === "pause") return "The Attempt is paused. Its stable id and records remain, while new Agent writes are blocked.";
  if (action === "resume") return "The same Attempt is active again under current same-Agent authority; no duplicate workspace was created.";
  return "The Attempt is terminal and retained in history. Existing evidence remains inspectable; this does not verify, reject, or delete mathematical work.";
}
