import { getCurrentUser, toPersonIdentity } from "@/app/auth";
import {
  anchorCoordinatorConfigFromSettings,
  buildAnchorAdapterRegistry,
  createVolatileManifestStorage,
  createWitnessAuthorityVerifier,
  resolveWitnessSubmissionTarget,
  witnessAuthorityCandidatesFromProfile,
  witnessRateLimitPolicies,
  witnessRejectionErrorCode,
  witnessRejectionHttpStatus,
  type AnchorManifestBucket,
  type WitnessAuthority,
} from "@/app/lib/anchor-routes";
import { MissingDatabaseBindingError, getD1 } from "@/db";
import { getDelegationRepository } from "@/db/repositories/delegation";
import { ControlPlaneReadOnlyError } from "@/services/database/control-plane-operation-mode.mjs";
import { createAnchorBatchBuilder } from "@/services/anchoring/anchor-batch-builder.mjs";
import { createAnchorCoordinator } from "@/services/anchoring/anchor-coordinator.mjs";
import { createManifestStorage } from "@/services/anchoring/anchor-manifest-storage.mjs";
import { D1AnchorStore } from "@/services/anchoring/d1-anchor-store.mjs";
import {
  D1RemoteMcpRateLimiter,
  RemoteMcpRequestRateLimitError,
} from "@/services/proofweave-mcp-gateway/d1-rate-limiter.mjs";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const maxWitnessRequestBytes = 16_384;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await params;
    const user = await getCurrentUser();
    if (!user) {
      return witnessError("unauthenticated", "Sign in to submit anchor witness evidence.", 401);
    }
    const body = await readWitnessBody(request);
    const settings = env as unknown as Record<string, unknown>;
    const registry = await buildAnchorAdapterRegistry(settings.ANCHOR_ADAPTERS_JSON);
    if (!registry) {
      return witnessError(
        "anchoring_disabled",
        "On-chain anchoring is not configured; witness submissions are refused.",
        409,
      );
    }
    const store = new D1AnchorStore(getD1());
    const target = await resolveWitnessSubmissionTarget({ store, registry, batchId });
    if (target.status === "unknown_batch") {
      return witnessError("unknown_batch", "Anchor batch not found.", 404);
    }
    if (target.status === "adapter_not_configured") {
      return witnessError(
        "anchoring_disabled",
        "No anchor adapter is configured for this batch's chain and network.",
        409,
      );
    }
    await enforceWitnessRateLimit(user.personId ?? user.subject);

    const profile = await getDelegationRepository().getProfile(toPersonIdentity(user));
    const candidates = witnessAuthorityCandidatesFromProfile({ profile });
    let verifiedAuthority: WitnessAuthority | null = null;
    const verifyWitnessAuthority = async (input: { payload: unknown; signature: unknown }) => {
      const authority = await createWitnessAuthorityVerifier({ candidates })(input);
      verifiedAuthority = authority;
      return authority;
    };
    const bucket = readManifestBucket(settings);
    const manifestStorage = bucket
      ? createManifestStorage({ bucket })
      : createVolatileManifestStorage();
    const coordinator = createAnchorCoordinator({
      store,
      builder: createAnchorBatchBuilder({ store, chain: target.batch.chain, network: target.batch.network }),
      manifestStorage,
      adapter: target.adapter,
      config: anchorCoordinatorConfigFromSettings(settings),
      verifyWitnessAuthority,
    });
    const result = await coordinator.submitWitness({
      batchId,
      payload: body.payload,
      signature: body.signature,
      txRef: body.txRef,
    });
    if (result.accepted) {
      const authority = verifiedAuthority as WitnessAuthority | null;
      return Response.json(
        {
          accepted: true,
          submitterId: authority?.submitterId ?? null,
          publicKey: authority?.publicKey ?? null,
          submissionId: result.submissionId,
          witnessCount: result.witnessCount,
        },
        { headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json(
      {
        accepted: false,
        error: {
          code: witnessRejectionErrorCode(result.reason),
          message: `The anchor witness submission was rejected: ${result.reason}.`,
        },
      },
      { status: witnessRejectionHttpStatus(result.reason), headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return witnessFailure(error);
  }
}

type WitnessBody = { payload: unknown; signature: unknown; txRef: unknown };

async function readWitnessBody(request: Request): Promise<WitnessBody> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new WitnessRequestError("The witness submission must use a JSON body.", 415);
  }
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxWitnessRequestBytes) {
    throw new WitnessRequestError("The witness submission is too large.", 413);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(await readBoundedBody(request)));
  } catch {
    throw new WitnessRequestError("The witness submission must contain valid JSON.", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new WitnessRequestError("The witness submission must be a JSON object.", 400);
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.payload !== "object" || body.payload === null || Array.isArray(body.payload)) {
    throw new WitnessRequestError("The witness payload must be a JSON object.", 400);
  }
  if (typeof body.signature !== "string" || body.signature.length === 0) {
    throw new WitnessRequestError("The witness signature must be a non-empty string.", 400);
  }
  if (typeof body.txRef !== "string" || body.txRef.length === 0) {
    throw new WitnessRequestError("The witness txRef must be a non-empty string.", 400);
  }
  return { payload: body.payload, signature: body.signature, txRef: body.txRef };
}

async function readBoundedBody(request: Request): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxWitnessRequestBytes) {
          await reader.cancel();
          throw new WitnessRequestError("The witness submission is too large.", 413);
        }
        chunks.push(value);
      }
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

async function enforceWitnessRateLimit(submitterKey: string) {
  const limiter = new D1RemoteMcpRateLimiter({
    database: getD1(),
    policies: witnessRateLimitPolicies,
    retentionSeconds: 3_600,
  });
  await limiter.enforce({ personId: submitterKey }, "submit_anchor_witness");
}

function readManifestBucket(settings: Record<string, unknown>): AnchorManifestBucket | undefined {
  const bucket = settings.ANCHOR_MANIFEST_BUCKET;
  return bucket && typeof bucket === "object" && typeof (bucket as { get?: unknown }).get === "function"
    ? (bucket as AnchorManifestBucket)
    : undefined;
}

class WitnessRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WitnessRequestError";
  }
}

function witnessError(code: string, message: string, status: number): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function witnessFailure(error: unknown): Response {
  if (error instanceof WitnessRequestError) {
    return witnessError("invalid_request", error.message, error.status);
  }
  if (error instanceof RemoteMcpRequestRateLimitError) {
    return Response.json(
      { error: { code: "rate_limited", message: "Too many anchor witness submissions. Please wait before trying again." } },
      {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": retryAfterSeconds(error.retryAt),
        },
      },
    );
  }
  if (error instanceof MissingDatabaseBindingError || error instanceof ControlPlaneReadOnlyError) {
    return witnessError("unavailable", "Anchor witness submission is temporarily unavailable.", 503);
  }
  if (error instanceof Error && error.name === "AnchorAdapterConfigurationError") {
    return witnessError("internal", "The anchor adapter configuration is invalid.", 500);
  }
  return witnessError("internal", "The anchor witness submission could not be processed.", 500);
}

function retryAfterSeconds(retryAt: string) {
  const milliseconds = Date.parse(retryAt) - Date.now();
  return String(Math.max(1, Math.ceil(milliseconds / 1_000)));
}
