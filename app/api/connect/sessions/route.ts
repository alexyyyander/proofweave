import { MissingDatabaseBindingError } from "@/db";
import { LocalCodexPairingError, createLocalCodexPairing } from "@/db/repositories/local-codex-pairing";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const pairing = await createLocalCodexPairing({
      agentId: typeof body?.agentId === "string" ? body.agentId : "",
      agentLabel: typeof body?.agentLabel === "string" ? body.agentLabel : "",
      agentPublicKey: typeof body?.agentPublicKey === "string" ? body.agentPublicKey : "",
      oauthState: typeof body?.oauthState === "string" ? body.oauthState : "",
      codeChallenge: typeof body?.codeChallenge === "string" ? body.codeChallenge : "",
      connectionMode: typeof body?.connectionMode === "string" ? body.connectionMode : undefined,
    });
    const origin = new URL(request.url).origin;
    const connectionUrl = new URL("/connect/codex", origin);
    connectionUrl.searchParams.set("pairing", pairing.id);
    connectionUrl.searchParams.set("secret", pairing.browserSecret);
    return Response.json({
      clientId: pairing.clientId,
      connectionUrl: connectionUrl.toString(),
      expiresAt: pairing.expiresAt,
    }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return pairingFailure(error);
  }
}

function pairingFailure(error: unknown): Response {
  const message = error instanceof MissingDatabaseBindingError
    ? "Proofweave connection storage is unavailable."
    : error instanceof LocalCodexPairingError
      ? error.message
      : "The local Codex connection could not be started.";
  return Response.json({ error: { message } }, { status: error instanceof MissingDatabaseBindingError ? 503 : 400 });
}
