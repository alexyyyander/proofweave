import { getMcpRepository } from "@/db/repositories/mcp";
import {
  apiError,
  mcpFailure,
  record,
  requestJson,
  requiredString,
  requireMcpPrincipal,
} from "@/app/lib/mcp-api";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authentication = await requireMcpPrincipal(request);
    if ("response" in authentication) return authentication.response;

    const input = record(await requestJson(request));
    const message = input ? requiredString(input, "message", 2_000) : null;
    const idempotencyKey = input ? requiredString(input, "idempotencyKey", 160) : null;
    const progressPercent = input?.progressPercent;
    const validProgress =
      typeof progressPercent === "number" &&
      Number.isInteger(progressPercent) &&
      progressPercent >= 0 &&
      progressPercent <= 100;
    if (!message || !idempotencyKey || !validProgress) {
      return apiError(
        "invalid_input",
        "message, idempotencyKey, and an integer progressPercent from 0 to 100 are required.",
        400,
      );
    }

    const progress = typeof progressPercent === "number" ? progressPercent : 0;

    const { id } = await params;
    const result = await getMcpRepository().appendProgress(authentication.principal.personId, {
      attemptId: id,
      message,
      progressPercent: progress,
      idempotencyKey,
    });
    if (!result) return apiError("not_found", "Attempt not found.", 404);
    return Response.json(
      {
        event: result.value,
        idempotentReplay: !result.created,
        verificationState: "agent_reported_only",
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return mcpFailure(error);
  }
}
