/** Return bounded delivery metadata without messages, lease identities, or credentials. */
export function runnerDeliverySummary(row) {
  if (!row || !["queued", "leased", "acknowledged", "cancelled", "dead_letter"].includes(row.delivery_state)) return null;
  if (!Number.isSafeInteger(row.delivery_attempts) || row.delivery_attempts < 0) return null;
  return Object.freeze({
    state: row.delivery_state,
    attempts: row.delivery_attempts,
    errorCode: typeof row.last_error_code === "string" && /^[a-z][a-z0-9_]{2,63}$/.test(row.last_error_code) ? row.last_error_code : null,
    ...(row.delivery_state === "leased" && Number.isFinite(Date.parse(row.lease_expires_at))
      ? { leaseExpiresAt: row.lease_expires_at } : {}),
  });
}

/** Project the last durable delivery without changing the signed Run lifecycle or blocking redrive. */
export function runnerExecutionState(state, delivery, now = Date.now()) {
  if (!["queued", "preparing", "running", "cancel_requested"].includes(state)) return state;
  if (delivery?.state === "dead_letter") return "delivery_failed";
  if (delivery?.state === "leased" && Date.parse(delivery.leaseExpiresAt) <= now) return "retrying";
  if (delivery?.state === "queued" && (state !== "queued" || delivery.errorCode)) return "retrying";
  return state;
}
