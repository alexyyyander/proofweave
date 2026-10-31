import assert from "node:assert/strict";
import test from "node:test";
import { runnerDeliverySummary } from "../services/lean-runner/runner-delivery-summary.mjs";

test("delivery projection exposes only bounded state, attempts, and diagnostic code", () => {
  const summary = runnerDeliverySummary({ delivery_state: "dead_letter", delivery_attempts: 1, last_error_code: "runner_workspace_finalization_rejected_4xx", canonical_message: "private source", lease_consumer_id: "secret identity" });
  assert.deepEqual(summary, { state: "dead_letter", attempts: 1, errorCode: "runner_workspace_finalization_rejected_4xx" });
  assert.equal(runnerDeliverySummary(null), null);
  assert.equal(runnerDeliverySummary({ delivery_state: "unknown", delivery_attempts: 1 }), null);
  assert.equal(runnerDeliverySummary({ delivery_state: "dead_letter", delivery_attempts: -1 }), null);
  assert.equal(runnerDeliverySummary({ delivery_state: "dead_letter", delivery_attempts: 1, last_error_code: "private source /tmp/file" }).errorCode, null);
});
