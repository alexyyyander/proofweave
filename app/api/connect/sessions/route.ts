import { MissingDatabaseBindingError, getD1 } from "@/db";
import { LocalCodexPairingError, createLocalCodexPairing } from "@/db/repositories/local-codex-pairing";
import { ControlPlaneReadOnlyError } from "@/services/database/control-plane-operation-mode.mjs";
import {
  D1RemoteMcpRateLimiter,
  RemoteMcpRequestRateLimitError,
} from "@/services/proofweave-mcp-gateway/d1-rate-limiter.mjs";

export const dynamic = "force-dynamic";

const maxPairingRequestBytes = 16_384;
const pairingRateLimitPolicies = Object.freeze({
  create_pairing_global: Object.freeze({ maxRequests: 120, windowSeconds: 60 }),
  create_pairing_client: Object.freeze({ maxRequests: 8, windowSeconds: 600 }),
});

export async function POST(request: Request) {
  try {
    await enforcePairingRateLimit(request);
    const body = await readBoundedJson(request);
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
  if (error instanceof RemoteMcpRequestRateLimitError) {
    return Response.json({
      error: { message: "Too many local Agent connection requests. Please wait before trying again." },
    }, {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": retryAfterSeconds(error.retryAt),
      },
    });
  }
  if (error instanceof PublicPairingRequestError) {
    return Response.json({ error: { message: error.message } }, {
      status: error.status,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const unavailable = error instanceof MissingDatabaseBindingError
    || error instanceof ControlPlaneReadOnlyError;
  const message = error instanceof MissingDatabaseBindingError
    ? "Proofweave connection storage is unavailable."
    : error instanceof ControlPlaneReadOnlyError
      ? "Proofweave is temporarily read-only for maintenance."
    : error instanceof LocalCodexPairingError
      ? error.message
      : "The local Codex connection could not be started.";
  return Response.json({ error: { message } }, {
    status: unavailable ? 503 : 400,
    headers: { "Cache-Control": "no-store" },
  });
}

async function enforcePairingRateLimit(request: Request) {
  const limiter = new D1RemoteMcpRateLimiter({
    database: getD1(),
    policies: pairingRateLimitPolicies,
    retentionSeconds: 3_600,
  });
  await limiter.enforce({ personId: "public-pairing:global" }, "create_pairing_global");
  await limiter.enforce({
    personId: `public-pairing:${clientAddress(request.headers.get("cf-connecting-ip"))}`,
  }, "create_pairing_client");
}

function clientAddress(value: string | null) {
  const normalized = value?.trim() ?? "";
  return normalized.length >= 3 && normalized.length <= 64 && /^[0-9A-Fa-f:.]+$/.test(normalized)
    ? normalized.toLowerCase()
    : "unknown";
}

async function readBoundedJson(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new PublicPairingRequestError("The local Agent connection request must use JSON.", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxPairingRequestBytes) {
    throw new PublicPairingRequestError("The local Agent connection request is too large.", 413);
  }
  const bytes = await readBoundedBody(request);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new PublicPairingRequestError("The local Agent connection request must contain valid JSON.", 400);
  }
}

async function readBoundedBody(request: Request) {
  if (!request.body) {
    return new Uint8Array();
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maxPairingRequestBytes) {
        await reader.cancel();
        throw new PublicPairingRequestError("The local Agent connection request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function retryAfterSeconds(retryAt: string) {
  const milliseconds = Date.parse(retryAt) - Date.now();
  return String(Math.max(1, Math.ceil(milliseconds / 1_000)));
}

class PublicPairingRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PublicPairingRequestError";
  }
}
