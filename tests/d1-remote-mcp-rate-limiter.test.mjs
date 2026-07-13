import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import {
  D1RemoteMcpRateLimiter,
  RemoteMcpRequestRateLimitError,
} from "../services/proofweave-mcp-gateway/d1-rate-limiter.mjs";

const migrationsRoot = new URL("../drizzle/", import.meta.url);
let miniflare;
let database;
let currentTime;

before(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    compatibilityDate: "2026-05-22",
    d1Databases: ["DB"],
  });
  database = await miniflare.getD1Database("DB");
  await applyMigrations(database);
});

after(async () => {
  await miniflare?.dispose();
});

test("remote MCP rate limits aggregate every Agent installation under one Person", async () => {
  currentTime = "2026-07-14T00:00:10.000Z";
  const limiter = new D1RemoteMcpRateLimiter({
    database,
    now: () => new Date(currentTime),
    retentionSeconds: 120,
    policies: {
      report_progress: { maxRequests: 2, windowSeconds: 60 },
    },
  });
  const firstAgent = {
    personId: "person:alice-private",
    agentInstallationId: "installation:alice-one",
  };
  const secondAgent = {
    personId: "person:alice-private",
    agentInstallationId: "installation:alice-two",
  };

  const first = await limiter.enforce(firstAgent, "report_progress");
  await limiter.enforce(firstAgent, "report_progress");
  assert.equal(first.retryAt, "2026-07-14T00:01:00.000Z");
  await assert.rejects(
    limiter.enforce(secondAgent, "report_progress"),
    (error) => error instanceof RemoteMcpRequestRateLimitError && error.retryAt === "2026-07-14T00:01:00.000Z",
  );

  const firstWindow = await database
    .prepare("SELECT bucket_key, request_count FROM remote_mcp_rate_limit_buckets")
    .all();
  assert.equal(firstWindow.results.length, 1);
  assert.equal(firstWindow.results[0].request_count, 2);
  assert.doesNotMatch(firstWindow.results[0].bucket_key, /alice|installation|person:/);

  currentTime = "2026-07-14T00:01:00.000Z";
  await limiter.enforce(secondAgent, "report_progress");
  const nextWindow = await database
    .prepare("SELECT COUNT(*) AS count FROM remote_mcp_rate_limit_buckets")
    .first();
  assert.equal(nextWindow.count, 2);
});

test("remote MCP rate-limit counters expire instead of becoming an attribution history", async () => {
  currentTime = "2026-07-14T00:03:01.000Z";
  const limiter = new D1RemoteMcpRateLimiter({
    database,
    now: () => new Date(currentTime),
    retentionSeconds: 120,
    policies: {
      report_progress: { maxRequests: 1, windowSeconds: 60 },
    },
  });

  await limiter.enforce({ personId: "person:bob-private" }, "report_progress");
  const rows = await database
    .prepare("SELECT window_started_at FROM remote_mcp_rate_limit_buckets ORDER BY window_started_at")
    .all();
  assert.deepEqual(rows.results, [{ window_started_at: "2026-07-14T00:03:00.000Z" }]);
});

test("remote MCP admits no more than the atomic limit under concurrent deliveries", async () => {
  currentTime = "2026-07-14T00:05:10.000Z";
  const limiter = new D1RemoteMcpRateLimiter({
    database,
    now: () => new Date(currentTime),
    retentionSeconds: 120,
    policies: {
      put_artifact_object: { maxRequests: 2, windowSeconds: 60 },
    },
  });
  const deliveries = await Promise.allSettled(
    Array.from({ length: 8 }, (_, index) => limiter.enforce({
      personId: "person:concurrent-private",
      agentInstallationId: `installation:concurrent-${index}`,
    }, "put_artifact_object")),
  );
  assert.equal(deliveries.filter((delivery) => delivery.status === "fulfilled").length, 2);
  assert.equal(deliveries.filter((delivery) => delivery.status === "rejected").length, 6);
  assert.ok(deliveries.filter((delivery) => delivery.status === "rejected").every((delivery) => delivery.reason instanceof RemoteMcpRequestRateLimitError));
  const bucket = await database
    .prepare("SELECT request_count FROM remote_mcp_rate_limit_buckets")
    .all();
  assert.deepEqual(bucket.results, [{ request_count: 2 }]);
});

test("remote MCP rate limiter rejects malformed policy and principal input before writing", async () => {
  assert.throws(
    () => new D1RemoteMcpRateLimiter({ database, policies: {} }),
    /at least one policy/,
  );
  const limiter = new D1RemoteMcpRateLimiter({
    database,
    policies: { report_progress: { maxRequests: 1, windowSeconds: 60 } },
    retentionSeconds: 60,
  });
  await assert.rejects(limiter.enforce({ personId: "" }, "report_progress"), /Person identifier/);
  await assert.rejects(limiter.enforce({ personId: "person:alice" }, "unknown_operation"), /unknown MCP operation/);
});

async function applyMigrations(d1) {
  const filenames = (await readdir(migrationsRoot))
    .filter((filename) => filename.endsWith(".sql"))
    .sort();
  for (const filename of filenames) {
    const source = await readFile(new URL(filename, migrationsRoot), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
      await d1.prepare(statement).run();
    }
  }
}
