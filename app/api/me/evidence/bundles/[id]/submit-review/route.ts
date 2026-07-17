import { currentEvidencePersonId, evidenceFailure } from "@/app/lib/evidence-api";
import { hasAcceptedLeanEvidence } from "@/app/lib/evidence-eligibility";
import { MissingDatabaseBindingError } from "@/db";
import { getEvidenceRepository } from "@/db/repositories/evidence";
import {
  getVerificationMarketRepository,
  VerificationMarketSchemaUnavailableError,
  VerificationMarketValidationError,
} from "@/db/repositories/verification-market";

export const dynamic = "force-dynamic";

const privateHeaders = { "cache-control": "private, no-store" };

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const personId = await currentEvidencePersonId();
    if (personId instanceof Response) return personId;
    const { id } = await params;
    const evidence = await getEvidenceRepository().getForPerson(personId, id);
    if (!evidence) return jsonError(404, "not_found", "Evidence record not found.");
    if (evidence.summary.accessRole !== "attempt_owner") {
      return jsonError(403, "forbidden", "Only the recorded Attempt owner can open this Bundle for independent review.");
    }
    if (!hasAcceptedLeanEvidence(evidence)) {
      return jsonError(409, "lean_not_accepted", "A complete isolated Lean Runner acceptance is required before independent review can open.");
    }

    const reviewMarket = await getVerificationMarketRepository().publishForBundle(
      evidence.bundle.manifestHash,
      new Date().toISOString(),
    );
    if (!reviewMarket.published) {
      const message = reviewMarket.reason === "no_pool"
        ? "This pinned problem revision does not have an active review pool."
        : reviewMarket.reason === "lean_not_accepted"
          ? "The stored Lean Runner evidence is not eligible for independent review."
          : "The review pool is not active for new independent review work.";
      return Response.json(
        { error: { code: reviewMarket.reason ?? "review_not_available", message }, reviewMarket },
        { status: 409, headers: privateHeaders },
      );
    }
    return Response.json({ reviewMarket }, { headers: privateHeaders });
  } catch (error) {
    if (
      error instanceof MissingDatabaseBindingError ||
      error instanceof VerificationMarketSchemaUnavailableError
    ) {
      return jsonError(503, "unavailable", "The independent review market is temporarily unavailable.");
    }
    if (error instanceof VerificationMarketValidationError) {
      return jsonError(409, "evidence_invalid", "The stored evidence could not satisfy the independent review integrity gate.");
    }
    const response = evidenceFailure(error);
    response.headers.set("cache-control", "private, no-store");
    return response;
  }
}

function jsonError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: privateHeaders });
}
