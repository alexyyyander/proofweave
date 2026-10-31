import { currentReviewPersonId } from "@/app/lib/review-api";
import { researchWriteGateFailure } from "@/app/lib/research-write-gate";
import { MissingDatabaseBindingError } from "@/db";
import { EvidenceIntegrityError } from "@/db/repositories/evidence";
import { ControlPlaneReadOnlyError } from "@/services/database/control-plane-operation-mode.mjs";

export async function currentEvidencePersonId(): Promise<string | Response> {
  return currentReviewPersonId();
}

export function evidenceFailure(error: unknown): Response {
  const gate = researchWriteGateFailure(error);
  if (gate) return gate;
  if (
    error instanceof MissingDatabaseBindingError
    || error instanceof ControlPlaneReadOnlyError
  ) {
    return Response.json({ error: { code: "unavailable", message: "Evidence storage is temporarily unavailable." } }, { status: 503 });
  }
  if (error instanceof EvidenceIntegrityError) {
    return Response.json({ error: { code: "unavailable", message: "Stored evidence could not be verified against its immutable index." } }, { status: 503 });
  }
  if (error instanceof Error) {
    return Response.json({ error: { code: "invalid_input", message: error.message } }, { status: 400 });
  }
  return Response.json({ error: { code: "unavailable", message: "Evidence storage is temporarily unavailable." } }, { status: 503 });
}
