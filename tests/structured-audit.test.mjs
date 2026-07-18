import assert from "node:assert/strict";
import test from "node:test";
import {
  createStructuredHttpAudit,
  createStructuredQueueAudit,
} from "../packages/observability/structured-audit.mjs";

test("HTTP audit emits a privacy-minimal record and preserves the response", async () => {
  const events = [];
  const audit = createStructuredHttpAudit({
    component: "remote_mcp_gateway",
    emit: (record) => events.push(record),
    now: () => new Date("2026-07-14T00:00:00Z"),
    monotonicNow: sequence(100, 112),
    createRequestId: () => "pw-0123456789abcdef0123456789abcdef",
  });

  const response = await audit.handle(
    new Request("https://mcp.example.test/api/mcp?access_token=do-not-log", {
      method: "POST",
      headers: {
        Authorization: "Bearer do-not-log",
        "x-proofweave-request-id": "person-alice-must-not-be-logged",
      },
    }),
    async () => new Response("accepted", { status: 201, headers: { "x-internal": "preserved" } }),
  );

  assert.equal(response.status, 201);
  assert.equal(await response.text(), "accepted");
  assert.equal(response.headers.get("x-internal"), "preserved");
  assert.equal(response.headers.get("x-proofweave-request-id"), "pw-0123456789abcdef0123456789abcdef");
  assert.deepEqual(events, [{
    schemaVersion: "pw-audit-v1",
    kind: "http_request_completed",
    component: "remote_mcp_gateway",
    requestId: "pw-0123456789abcdef0123456789abcdef",
    method: "POST",
    path: "/api/mcp",
    startedAt: "2026-07-14T00:00:00.000Z",
    durationMs: 12,
    status: 201,
    outcome: "completed",
  }]);
  assert.doesNotMatch(JSON.stringify(events), /do-not-log|alice|Authorization|access_token|x-internal/);
});

test("HTTP audit records no exception details and cannot break a response when its sink fails", async () => {
  const events = [];
  const failingSinkAudit = createStructuredHttpAudit({
    component: "remote_mcp_gateway",
    emit() { throw new Error("logging endpoint unavailable"); },
    monotonicNow: sequence(1, 2),
  });
  const response = await failingSinkAudit.handle(
    new Request("https://mcp.example.test/health"),
    async () => new Response(null, { status: 204 }),
  );
  assert.equal(response.status, 204);

  const errorAudit = createStructuredHttpAudit({
    component: "remote_mcp_gateway",
    emit: (record) => events.push(record),
    now: () => new Date("2026-07-14T00:00:00Z"),
    monotonicNow: sequence(10, 18),
    createRequestId: () => "pw-fedcba9876543210fedcba9876543210",
  });
  await assert.rejects(
    errorAudit.handle(
      new Request("https://mcp.example.test/mcp?token=do-not-log"),
      async () => { throw new Error("request body and token=do-not-log"); },
    ),
    /do-not-log/,
  );
  assert.deepEqual(events, [{
    schemaVersion: "pw-audit-v1",
    kind: "http_request_failed",
    component: "remote_mcp_gateway",
    requestId: "pw-fedcba9876543210fedcba9876543210",
    method: "GET",
    path: "/mcp",
    startedAt: "2026-07-14T00:00:00.000Z",
    durationMs: 8,
    status: 500,
    outcome: "unhandled_error",
  }]);
  assert.doesNotMatch(JSON.stringify(events), /do-not-log|token|body/);
});

test("Queue audit emits aggregate delivery totals only and preserves retry semantics", async () => {
  const events = [];
  const audit = createStructuredQueueAudit({
    component: "lean_runner_queue",
    emit: (record) => events.push(record),
    now: () => new Date("2026-07-14T00:00:00Z"),
    monotonicNow: sequence(500, 521),
  });

  const result = await audit.handle({
    delivered: 3,
    handler: async () => ({ acknowledged: 2, retried: 1, sensitiveRunId: "run:do-not-log" }),
  });

  assert.deepEqual(result, { acknowledged: 2, retried: 1, sensitiveRunId: "run:do-not-log" });
  assert.deepEqual(events, [{
    schemaVersion: "pw-audit-v1",
    kind: "queue_batch_completed",
    component: "lean_runner_queue",
    startedAt: "2026-07-14T00:00:00.000Z",
    durationMs: 21,
    delivered: 3,
    acknowledged: 2,
    retried: 1,
    outcome: "partial_retry",
  }]);
  assert.doesNotMatch(JSON.stringify(events), /do-not-log|sensitiveRunId/);
});

function sequence(...values) {
  return () => {
    if (values.length === 0) throw new Error("Test clock was read too often.");
    return values.shift();
  };
}
