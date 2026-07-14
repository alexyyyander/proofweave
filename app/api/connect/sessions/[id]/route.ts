import { MissingDatabaseBindingError } from "@/db";
import { LocalCodexPairingError, inspectLocalCodexPairing } from "@/db/repositories/local-codex-pairing";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const secret = new URL(request.url).searchParams.get("secret") ?? "";
    const pairing = await inspectLocalCodexPairing({ pairingId: id, browserSecret: secret });
    return Response.json({ pairing }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return pairingFailure(error);
  }
}

function pairingFailure(error: unknown): Response {
  const message = error instanceof MissingDatabaseBindingError
    ? "Proofweave connection storage is unavailable."
    : error instanceof LocalCodexPairingError
      ? error.message
      : "The local Codex connection could not be read.";
  return Response.json({ error: { message } }, { status: error instanceof MissingDatabaseBindingError ? 503 : 400 });
}
