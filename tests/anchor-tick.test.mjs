import assert from "node:assert/strict";
import test from "node:test";
import { runAnchorTick } from "../scripts/anchor-tick.mjs";
import { AnchorStoreConflictError } from "../services/anchoring/d1-anchor-store.mjs";

function coordinatorWith(result) {
  return {
    resumeUnfinishedBatches: async () => 0,
    maybeBuildAndSubmit: async () => ({ created: false, reason: "empty" }),
    pollConfirmations: async () => result,
  };
}

test("tick retains partial confirmation errors and returns a nonzero exit code", async () => {
  const error = { submissionId: "s", batchId: "b", txRef: "mock:local:t", message: "RPC unavailable" };
  const result = await runAnchorTick(coordinatorWith({ confirmedBatches: ["healthy-batch"], failedBatches: [], errors: [error] }));
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.status, "partial_failure");
  assert.deepEqual(result.summary.errors, [error]);
  assert.deepEqual(result.summary.confirmedBatches, ["healthy-batch"]);
});

test("tick reports reverted submissions as partial failure even without RPC errors", async () => {
  const result = await runAnchorTick(coordinatorWith({ confirmedBatches: [], failedBatches: ["b"], errors: [] }));
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.status, "partial_failure");
  assert.deepEqual(result.summary.failedBatches, ["b"]);
});

test("empty healthy tick and a build conflict retain successful exit semantics", async () => {
  const coordinator = coordinatorWith({ confirmedBatches: [], failedBatches: [], errors: [] });
  const result = await runAnchorTick(coordinator);
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.status, "ok");
  assert.equal(result.summary.reason, "empty");
  coordinator.maybeBuildAndSubmit = async () => { throw new AnchorStoreConflictError("head changed"); };
  assert.deepEqual(await runAnchorTick(coordinator), { summary: { status: "conflict", reason: "head changed" }, exitCode: 0 });
});
