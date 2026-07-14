import { currentDelegationIdentity } from "@/app/lib/delegation-api";
import { MissingDatabaseBindingError } from "@/db";
import { LocalCodexPairingError, approveLocalCodexPairing } from "@/db/repositories/local-codex-pairing";

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
      resource: `${new URL(request.url).origin}/mcp`,
    });
    return Response.json(approved, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof MissingDatabaseBindingError
      ? "Proofweave connection storage is unavailable."
      : error instanceof LocalCodexPairingError
        ? error.message
        : "The local Codex connection could not be approved.";
    return Response.json({ error: { message } }, { status: error instanceof MissingDatabaseBindingError ? 503 : 400 });
  }
}
