import { currentReviewPersonId } from "@/app/lib/review-api";
import { getD1 } from "@/db";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { D1PoolCreditSettlement } from "@/services/credits/d1-pool-credit-settlement.mjs";

export const dynamic = "force-dynamic";
const privateHeaders = { "cache-control": "private, no-store" };

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const personId = await currentReviewPersonId();
    if (personId instanceof Response) return personId;
    const { slug } = await params;
    const problem = await getCatalogRepository().findBySlug(slug);
    if (!problem || problem.kind !== "frontier") return Response.json({ error: { code: "not_found", message: "Frontier problem not found." } }, { status: 404, headers: privateHeaders });
    const pool = await getD1().prepare("SELECT id FROM problem_credit_pools WHERE problem_revision_id = ?").bind(problem.id).first<{ id: string }>();
    if (!pool) return Response.json({ state: "no_pool", entries: [] }, { headers: privateHeaders });
    const locked = await new D1PoolCreditSettlement(getD1()).readLocked(pool.id);
    if (!locked) return Response.json({ state: "not_locked", entries: [] }, { headers: privateHeaders });
    const entries = locked.allocation.entries.filter((entry: { personId: string }) => entry.personId === personId)
      .map((entry: { bucket: string; units: number; reasonId: string }) => ({ bucket: entry.bucket, units: entry.units, reasonId: entry.reasonId }));
    return Response.json({
      state: locked.state, lockedAt: locked.lockedAt, eventHash: locked.eventHash, finalityHash: locked.finalityHash,
      policyVersion: locked.allocation.protocolVersion, entries,
      totalUnits: entries.reduce((sum: number, entry: { units: number }) => sum + entry.units, 0),
      note: "These are non-transferable pool allocations frozen at lock, separate from Receipt-fact credits. Held reserves are not allocated.",
    }, { headers: privateHeaders });
  } catch {
    return Response.json({ error: { code: "unavailable", message: "Pool allocation evidence is temporarily unavailable or failed verification." } }, { status: 503, headers: privateHeaders });
  }
}
