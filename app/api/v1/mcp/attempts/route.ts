import { getCatalogRepository } from "@/db/repositories/catalog";
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

export async function POST(request: Request) {
  try {
    const authentication = await requireMcpPrincipal(request);
    if ("response" in authentication) return authentication.response;

    const input = record(await requestJson(request));
    const problemSlug = input ? requiredString(input, "problemSlug", 120) : null;
    const agentId = input ? requiredString(input, "agentId", 240) : null;
    const agentLabel = input ? requiredString(input, "agentLabel", 120) : null;
    const delegationCertificateId = input ? requiredString(input, "delegationCertificateId", 240) : null;
    const delegationScope = input?.delegationScope;
    const idempotencyKey = input ? requiredString(input, "idempotencyKey", 160) : null;
    if (
      !problemSlug || !agentId || !agentLabel || !delegationCertificateId || !idempotencyKey ||
      (delegationScope !== "formalize" && delegationScope !== "prove")
    ) {
      return apiError(
        "invalid_input",
        "problemSlug, agentId, agentLabel, delegationCertificateId, delegationScope (formalize or prove), and idempotencyKey are required.",
        400,
      );
    }

    const problem = await getCatalogRepository().findBySlug(problemSlug);
    if (!problem || problem.kind !== "frontier") {
      return apiError("not_found", "A frontier catalog record with that slug was not found.", 404);
    }

    const result = await getMcpRepository().createAttempt(authentication.principal.personId, {
      problemRevisionId: problem.id,
      agentId,
      agentLabel,
      delegationCertificateId,
      delegationScope,
      idempotencyKey,
    });
    return Response.json(
      {
        attempt: result.value,
        idempotentReplay: !result.created,
        note: "This attempt is agent-reported only. It is not Lean verification or a contribution receipt.",
      },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return mcpFailure(error);
  }
}
