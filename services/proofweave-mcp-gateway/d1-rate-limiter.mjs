const operationPattern = /^[a-z][a-z0-9_]{2,80}$/;
const principalPattern = /^[^\u0000\r\n]{1,240}$/;

/**
 * Closed-alpha limits are per Person, never per Agent installation. Creating
 * more Agents therefore cannot buy more gateway capacity. These limits govern
 * transport abuse only; they neither measure nor award mathematical work.
 */
export const remoteMcpRateLimitPolicies = Object.freeze({
  get_connection_authority: Object.freeze({ maxRequests: 60, windowSeconds: 60 }),
  list_frontier_problems: Object.freeze({ maxRequests: 60, windowSeconds: 60 }),
  inspect_problem: Object.freeze({ maxRequests: 60, windowSeconds: 60 }),
  create_attempt: Object.freeze({ maxRequests: 12, windowSeconds: 3_600 }),
  report_progress: Object.freeze({ maxRequests: 120, windowSeconds: 3_600 }),
  list_attempts: Object.freeze({ maxRequests: 60, windowSeconds: 60 }),
  get_attempt: Object.freeze({ maxRequests: 120, windowSeconds: 60 }),
  put_artifact_object: Object.freeze({ maxRequests: 24, windowSeconds: 3_600 }),
  stage_artifact_bundle: Object.freeze({ maxRequests: 12, windowSeconds: 3_600 }),
  request_runner_run: Object.freeze({ maxRequests: 12, windowSeconds: 3_600 }),
  list_review_assignments: Object.freeze({ maxRequests: 60, windowSeconds: 60 }),
  get_review_assignment: Object.freeze({ maxRequests: 120, windowSeconds: 60 }),
  request_verification_replay: Object.freeze({ maxRequests: 12, windowSeconds: 3_600 }),
  get_verification_replay: Object.freeze({ maxRequests: 120, windowSeconds: 60 }),
  get_runner_run: Object.freeze({ maxRequests: 120, windowSeconds: 60 }),
  cancel_runner_run: Object.freeze({ maxRequests: 12, windowSeconds: 3_600 }),
  submit_verification_attestation: Object.freeze({ maxRequests: 24, windowSeconds: 3_600 }),
});

export class RemoteMcpRequestRateLimitError extends Error {
  constructor({ operation, retryAt }) {
    super(`MCP request limit reached for ${operation}. Retry after ${retryAt}.`);
    this.name = "RemoteMcpRequestRateLimitError";
    this.operation = operation;
    this.retryAt = retryAt;
  }
}

/**
 * D1-backed fixed-window limiter. The single INSERT/UPDATE statement admits a
 * request only while its counter is below the policy maximum, so concurrent
 * Worker isolates cannot oversubscribe a Person's quota. Bucket keys are
 * SHA-256 digests; raw Person IDs never enter this operational table.
 */
export class D1RemoteMcpRateLimiter {
  /**
   * @param {{
   *   database?: import("drizzle-orm/d1").AnyD1Database,
   *   policies?: Readonly<Record<string, Readonly<{ maxRequests: number, windowSeconds: number }>>>,
   *   now?: () => Date,
   *   retentionSeconds?: number,
   * }} [options]
   */
  constructor({ database, policies = remoteMcpRateLimitPolicies, now = () => new Date(), retentionSeconds = 172_800 } = {}) {
    if (!database || typeof database.prepare !== "function") {
      throw new TypeError("D1RemoteMcpRateLimiter requires a D1 database binding.");
    }
    if (typeof now !== "function") throw new TypeError("D1RemoteMcpRateLimiter requires a clock function.");
    this.policies = normalizePolicies(policies);
    if (!Number.isInteger(retentionSeconds) || retentionSeconds < largestWindow(this.policies) || retentionSeconds > 2_592_000) {
      throw new TypeError("D1RemoteMcpRateLimiter retention must cover the largest window and be at most 30 days.");
    }
    this.database = database;
    this.now = now;
    this.retentionSeconds = retentionSeconds;
  }

  async enforce(principal, operation) {
    const policy = this.policies[operation];
    if (!policy) throw new TypeError("D1RemoteMcpRateLimiter received an unknown MCP operation.");
    const personId = requirePersonId(principal?.personId);
    const instant = requireInstant(this.now());
    const window = fixedWindow(instant, policy.windowSeconds);
    const bucketKey = await opaqueBucketKey({ personId, operation });

    // Closed alpha is low volume; trimming synchronously keeps a leaked or
    // abandoned client from leaving an unbounded operational history behind.
    const retentionCutoff = new Date(instant.getTime() - (this.retentionSeconds * 1_000)).toISOString();
    await this.database
      .prepare("DELETE FROM remote_mcp_rate_limit_buckets WHERE window_started_at < ?")
      .bind(retentionCutoff)
      .run();

    const admitted = await this.database
      .prepare(
        `INSERT INTO remote_mcp_rate_limit_buckets (
          bucket_key, window_started_at, request_count, updated_at
        ) VALUES (?, ?, 1, ?)
        ON CONFLICT(bucket_key, window_started_at) DO UPDATE SET
          request_count = request_count + 1,
          updated_at = excluded.updated_at
        WHERE request_count < ?`,
      )
      .bind(bucketKey, window.startedAt, instant.toISOString(), policy.maxRequests)
      .run();
    if (admitted.meta.changes !== 1) {
      throw new RemoteMcpRequestRateLimitError({ operation, retryAt: window.retryAt });
    }

    return Object.freeze({ operation, retryAt: window.retryAt });
  }
}

export const allowAllRemoteMcpRateLimiter = Object.freeze({
  async enforce() {},
});

function normalizePolicies(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("D1RemoteMcpRateLimiter policies must be an object.");
  }
  const normalized = {};
  for (const [operation, policy] of Object.entries(value)) {
    if (!operationPattern.test(operation)) {
      throw new TypeError("D1RemoteMcpRateLimiter policy operation is invalid.");
    }
    if (!policy || typeof policy !== "object" || !Number.isInteger(policy.maxRequests) || !Number.isInteger(policy.windowSeconds)) {
      throw new TypeError("D1RemoteMcpRateLimiter policy must contain integer limits.");
    }
    if (policy.maxRequests < 1 || policy.maxRequests > 10_000 || policy.windowSeconds < 1 || policy.windowSeconds > 86_400) {
      throw new TypeError("D1RemoteMcpRateLimiter policy limit is out of range.");
    }
    normalized[operation] = Object.freeze({
      maxRequests: policy.maxRequests,
      windowSeconds: policy.windowSeconds,
    });
  }
  if (Object.keys(normalized).length === 0) throw new TypeError("D1RemoteMcpRateLimiter requires at least one policy.");
  return Object.freeze(normalized);
}

function requirePersonId(value) {
  if (typeof value !== "string" || !principalPattern.test(value)) {
    throw new TypeError("D1RemoteMcpRateLimiter requires a bounded Person identifier.");
  }
  return value;
}

function requireInstant(value) {
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new TypeError("D1RemoteMcpRateLimiter clock returned an invalid instant.");
  return instant;
}

function fixedWindow(instant, windowSeconds) {
  const windowMilliseconds = windowSeconds * 1_000;
  const startedAtMilliseconds = Math.floor(instant.getTime() / windowMilliseconds) * windowMilliseconds;
  return Object.freeze({
    startedAt: new Date(startedAtMilliseconds).toISOString(),
    retryAt: new Date(startedAtMilliseconds + windowMilliseconds).toISOString(),
  });
}

async function opaqueBucketKey({ personId, operation }) {
  const bytes = new TextEncoder().encode(`pw-remote-mcp-rate-v1\u0000${operation}\u0000${personId}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function largestWindow(policies) {
  return Math.max(...Object.values(policies).map((policy) => policy.windowSeconds));
}
