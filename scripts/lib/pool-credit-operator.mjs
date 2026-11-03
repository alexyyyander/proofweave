import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { tursoDatabaseFingerprint } from "../../db/control-plane-authority.mjs";
import { createRemoteLibsqlD1Database } from "../../services/database/libsql-d1-adapter.mjs";
import { D1PoolCreditSettlement } from "../../services/credits/d1-pool-credit-settlement.mjs";
import { normalizePoolFinalityAdjudication } from "../../packages/protocol/pool-finality-adjudication.mjs";
import { projectCreditPoolState } from "../../packages/protocol/credit-market.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sha = /^sha256:[0-9a-f]{64}$/;
const identifier = /^[A-Za-z0-9][A-Za-z0-9:._-]{2,239}$/;

export class PoolCreditOperatorError extends Error {
  constructor(code) { super(code); this.name = "PoolCreditOperatorError"; this.code = code; }
}

/** Local operator entrypoint. The database credential is never accepted as an
 * argument or included in output. The store independently enforces finality. */
export async function executePoolCreditOperator({ args, environment, readSourceState = sourceState, loadAdjudication = readAdjudication, openDatabase = createRemoteLibsqlD1Database, createSettlement = (db) => new D1PoolCreditSettlement(db) }) {
  const input = parseArgs(args);
  const url = environment.TURSO_DATABASE_URL;
  const token = environment.TURSO_AUTH_TOKEN;
  let fingerprint;
  try { fingerprint = tursoDatabaseFingerprint(url); } catch { throw new PoolCreditOperatorError("DATABASE_URL_INVALID"); }
  if (fingerprint !== input.databaseFingerprint) throw new PoolCreditOperatorError("DATABASE_FINGERPRINT_MISMATCH");
  if (typeof token !== "string" || token.length < 16 || token.length > 16_384 || /\s/.test(token)) throw new PoolCreditOperatorError("DATABASE_CREDENTIAL_INVALID");
  const source = readSourceState();
  if (source.revision !== input.sourceRevision || source.dirty !== false) throw new PoolCreditOperatorError("SOURCE_REVISION_OR_CLEANLINESS_MISMATCH");
  let adjudication;
  if (input.mode === "lock") {
    try { adjudication = normalizePoolFinalityAdjudication(await loadAdjudication(input.adjudicationFile)); } catch { throw new PoolCreditOperatorError("FINALITY_ADJUDICATION_INVALID"); }
  }

  const database = openDatabase({ url, authToken: token });
  try {
    const settlement = createSettlement(database);
    if (input.mode === "status") {
      const poolState = projectCreditPoolState(await settlement.poolHistory(input.poolId));
      const locked = await settlement.readLocked(input.poolId);
      const rows = await database.prepare(`SELECT job.id, job.claim_type, assignment.status AS assignment_status, claim.id AS claim_id, attestation.decision AS review_decision
        FROM verification_market_jobs AS job LEFT JOIN verification_market_job_claims AS claim ON claim.job_id = job.id
        LEFT JOIN verification_assignments AS assignment ON assignment.id = claim.assignment_id
        LEFT JOIN verification_attestations AS attestation ON attestation.assignment_id = assignment.id
        WHERE job.pool_id = ? ORDER BY job.id LIMIT 101`).bind(input.poolId).all();
      const jobs = (rows.results ?? []).slice(0, 100).map((row) => ({ id: row.id, claimType: row.claim_type, projection: row.claim_id ? row.assignment_status ?? "unknown" : "open", decision: row.review_decision ?? null }));
      return Object.freeze({ mode: "status", databaseFingerprint: fingerprint, sourceRevision: source.revision, poolId: input.poolId, poolState,
        finalResultCredits: locked ? "locked_with_verified_finality" : "not_allocated",
        reviewCredits: locked ? "included_in_verified_allocation" : "pending_eligible_final_result_and_closure_lock",
        jobsAreUnverifiedProjections: true, truncated: (rows.results ?? []).length > 100, jobs });
    }
    if (input.mode === "preview") {
      const preview = await settlement.preview(input.poolId, input.receiptId);
      return Object.freeze({ mode: "preview", provisional: true, finality: "unverified", finalResultCredits: "not_allocated", reviewCredits: "pending_eligible_final_result_and_closure_lock", completedMarketReviews: preview.plan.reviews.length, reviewCutoff: preview.cutoff, databaseFingerprint: fingerprint, sourceRevision: source.revision, plan: preview.plan });
    }
    const locked = await settlement.lock(input.poolId, input.receiptId, { expectedPlanHash: input.planHash, finalityAdjudication: adjudication });
    return Object.freeze({ mode: "lock", databaseFingerprint: fingerprint, sourceRevision: source.revision, result: locked });
  } finally { await database.close(); }
}

function parseArgs(args) {
  if (!Array.isArray(args) || !["status", "preview", "lock"].includes(args[0])) throw new PoolCreditOperatorError("USAGE_INVALID");
  const values = new Map();
  for (let i = 1; i < args.length; i += 2) {
    const name = args[i], value = args[i + 1];
    if (!["--pool-id", "--receipt-id", "--database-fingerprint", "--source-revision", "--expected-plan-hash", "--adjudication-file"].includes(name) || values.has(name) || typeof value !== "string" || !value || value.startsWith("--")) throw new PoolCreditOperatorError("USAGE_INVALID");
    values.set(name, value);
  }
  const mode = args[0], poolId = values.get("--pool-id"), receiptId = values.get("--receipt-id");
  const databaseFingerprint = values.get("--database-fingerprint"), sourceRevision = values.get("--source-revision"), planHash = values.get("--expected-plan-hash"), adjudicationFile = values.get("--adjudication-file");
  if (!identifier.test(poolId ?? "") || (mode === "status" ? receiptId !== undefined : !identifier.test(receiptId ?? "")) || !/^[0-9a-f]{16}$/.test(databaseFingerprint ?? "") || !/^[0-9a-f]{40}$/.test(sourceRevision ?? "")
      || (mode === "lock" ? !sha.test(planHash ?? "") || typeof adjudicationFile !== "string" || adjudicationFile.length > 4096 : planHash !== undefined || adjudicationFile !== undefined)) throw new PoolCreditOperatorError("USAGE_INVALID");
  return Object.freeze({ mode, poolId, receiptId, databaseFingerprint, sourceRevision, planHash, adjudicationFile });
}

async function readAdjudication(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > 32_768) throw new Error("invalid file");
    return JSON.parse(await handle.readFile({ encoding: "utf8" }));
  } finally { await handle.close(); }
}

function sourceState() {
  try {
    const options = { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    const revision = execFileSync("git", ["rev-parse", "HEAD"], options).trim();
    const dirty = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], options).length !== 0;
    return { revision, dirty };
  } catch { throw new PoolCreditOperatorError("SOURCE_STATE_UNAVAILABLE"); }
}
