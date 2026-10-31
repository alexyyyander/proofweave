import {
  ResearchWriteGateUnconfiguredError,
  ResearchWriteNotAllowedError,
} from "@/services/database/research-write-allowlist.mjs";

/**
 * Map a research-write gate rejection to the participant HTTP surface without
 * exposing which Person, Agent, or Attempt was configured.
 */
export function researchWriteGateFailure(error: unknown): Response | null {
  if (error instanceof ResearchWriteGateUnconfiguredError) {
    return Response.json(
      {
        error: {
          code: "unavailable",
          message: "The research write window is not open.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  if (error instanceof ResearchWriteNotAllowedError) {
    return Response.json(
      {
        error: {
          code: "forbidden",
          message: "This identity is not in the current research write window.",
        },
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  return null;
}
