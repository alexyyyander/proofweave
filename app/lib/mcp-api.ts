import { MissingDatabaseBindingError } from "@/db";
import {
  getMcpRepository,
  McpAttemptNotActiveError,
  McpIdempotencyConflictError,
  type McpPrincipal,
} from "@/db/repositories/mcp";
import type { ErrorCode } from "./result";

export function apiError(
  code: ErrorCode,
  message: string,
  status: number,
  details?: Record<string, string>,
): Response {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status });
}

export async function requireMcpPrincipal(
  request: Request,
): Promise<{ principal: McpPrincipal } | { response: Response }> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return {
      response: apiError(
        "unauthenticated",
        "A Proofweave MCP bearer token is required.",
        401,
      ),
    };
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    return {
      response: apiError(
        "unauthenticated",
        "A Proofweave MCP bearer token is required.",
        401,
      ),
    };
  }

  const principal = await getMcpRepository().authenticate(token);
  return principal
    ? { principal }
    : {
        response: apiError(
          "unauthenticated",
          "The Proofweave MCP token is invalid, expired, or revoked.",
          401,
        ),
      };
}

export function mcpFailure(error: unknown): Response {
  if (error instanceof MissingDatabaseBindingError) {
    return apiError("unavailable", "The Proofweave control plane is temporarily unavailable.", 503);
  }
  if (error instanceof McpIdempotencyConflictError) {
    return apiError("conflict", error.message, 409);
  }
  if (error instanceof McpAttemptNotActiveError) {
    return apiError("precondition_failed", error.message, 412);
  }
  return apiError("internal", "The Proofweave control plane could not complete the request.", 500);
}

export async function requestJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function requiredString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = input[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}
