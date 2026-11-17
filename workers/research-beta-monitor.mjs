const fullNotificationWindowMs = 48 * 60 * 60 * 1_000;

export async function reportResearchBetaCapacity(env, fetcher = fetch, now = Date.now()) {
  const response = await fetcher(new URL("/v2/pipeline", env.TURSO_HTTPS_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.TURSO_BETA_READ_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requests: [
      { type: "execute", stmt: { sql: "SELECT admitted_at FROM research_beta_enrollments WHERE seat = 100" } },
      { type: "close" },
    ] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Research beta capacity check failed");
  const { results } = await response.json();
  const query = results?.[0];
  const rows = query?.response?.result?.rows;
  if (query?.type !== "ok" || !Array.isArray(rows) || rows.length > 1) {
    throw new Error("Research beta capacity check returned an invalid result");
  }
  if (rows.length === 0) return;

  const admittedAt = rows[0]?.[0];
  const age = now - Date.parse(admittedAt?.value);
  if (admittedAt?.type !== "text" || !Number.isFinite(age) || age < 0) {
    throw new Error("Research beta capacity check returned an invalid timestamp");
  }
  // Re-emit across evaluation windows so a transient outage after enrollment
  // cannot lose the signal. The monitor repeats only after this window ends.
  if (age < fullNotificationWindowMs) console.warn("proofweave_research_beta_full seats=100");
}

export default {
  async scheduled(_event, env) {
    await reportResearchBetaCapacity(env);
  },
};
