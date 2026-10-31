// Shared by hosted and CLI ticks. A stale owner cannot renew or release a new lease.
export async function withAnchorTickLease(database, work, { now = Date.now, ttlMs = 600_000 } = {}) {
  const owner = crypto.randomUUID();
  const acquired = await database.prepare(`INSERT INTO anchor_tick_leases (id, owner, expires_at)
    VALUES ('platform', ?, ?) ON CONFLICT(id) DO UPDATE SET owner = excluded.owner,
    expires_at = excluded.expires_at WHERE anchor_tick_leases.expires_at <= ?`)
    .bind(owner, now() + ttlMs, now()).run();
  if (Number(acquired.meta?.changes ?? acquired.changes ?? 0) !== 1) {
    return { summary: { status: "busy" }, exitCode: 0 };
  }
  async function renew() {
    const time = now();
    const result = await database.prepare(`UPDATE anchor_tick_leases SET expires_at = ?
      WHERE id = 'platform' AND owner = ? AND expires_at > ?`).bind(time + ttlMs, owner, time).run();
    if (Number(result.meta?.changes ?? result.changes ?? 0) !== 1) throw new Error("Anchor tick lease expired; refusing submission.");
  }
  try { return await work(renew); }
  finally {
    await database.prepare("DELETE FROM anchor_tick_leases WHERE id = 'platform' AND owner = ?").bind(owner).run();
  }
}
