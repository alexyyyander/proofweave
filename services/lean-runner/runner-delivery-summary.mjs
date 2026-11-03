/** Return only bounded delivery metadata, never messages, leases, or secrets. */
export function runnerDeliverySummary(row) {
  if (!row || !["queued", "leased", "acknowledged", "cancelled", "dead_letter"].includes(row.delivery_state)) return null;
  if (!Number.isSafeInteger(row.delivery_attempts) || row.delivery_attempts < 0) return null;
  return Object.freeze({
    state: row.delivery_state,
    attempts: row.delivery_attempts,
    errorCode: typeof row.last_error_code === "string" && /^[a-z][a-z0-9_]{2,63}$/.test(row.last_error_code) ? row.last_error_code : null,
  });
}
