export type ErrorCode =
  | "invalid_input"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "unavailable"
  | "internal";

export type AppError = Readonly<{
  code: ErrorCode;
  message: string;
  details?: Readonly<Record<string, string>>;
}>;

export type Result<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: AppError }>;

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(
  code: ErrorCode,
  message: string,
  details?: Readonly<Record<string, string>>,
): Result<never> {
  return { ok: false, error: { code, message, details } };
}
