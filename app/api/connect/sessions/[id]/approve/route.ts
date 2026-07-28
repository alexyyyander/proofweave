import { currentDelegationIdentity } from "@/app/lib/delegation-api";
import { MissingDatabaseBindingError } from "@/db";
import { LocalCodexPairingError, approveLocalCodexPairing } from "@/db/repositories/local-codex-pairing";
import { proofweaveMcpResource } from "@/app/lib/remote-mcp-runtime";
import { ControlPlaneReadOnlyError } from "@/services/database/control-plane-operation-mode.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await currentDelegationIdentity();
  if (identity instanceof Response) return identity;
  try {
    const { id } = await context.params;
    const body = await request.json();
    const approved = await approveLocalCodexPairing({
      pairingId: id,
      browserSecret: typeof body?.secret === "string" ? body.secret : "",
      delegationCertificateId: typeof body?.delegationCertificateId === "string" ? body.delegationCertificateId : "",
      identity,
      resource: proofweaveMcpResource(request),
    });
    return Response.json(approved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const unavailable = error instanceof MissingDatabaseBindingError
      || error instanceof ControlPlaneReadOnlyError;
    const invalidRequest = error instanceof LocalCodexPairingError;
    const message = error instanceof MissingDatabaseBindingError
      ? "Proofweave connection storage is unavailable."
      : error instanceof ControlPlaneReadOnlyError
        ? "Proofweave is temporarily read-only for maintenance."
      : invalidRequest
        ? error.message
        : "The local Codex connection could not be approved because of an internal error.";
    return Response.json(
      { error: { message } },
      {
        status: unavailable ? 503 : invalidRequest ? 400 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
