import assert from "node:assert/strict";
import test from "node:test";
import {
  VerificationMarketPolicyError,
  allocateCompletedReviewCredits,
  assertVerificationMarketPolicy,
  projectVerificationJobState,
  verificationMarketBoundaries,
  verificationMarketClaims,
} from "../packages/protocol/verification-market.mjs";

test("verification market publishes only evidence-bearing different-owner work", () => {
  assert.equal(assertVerificationMarketPolicy(), true);
  assert.deepEqual(
    verificationMarketClaims.map(({ claimType, rewardWeight }) => ({ claimType, rewardWeight })),
    [
      { claimType: "bundle_reproducible", rewardWeight: 1 },
      { claimType: "kernel_accepted", rewardWeight: 2 },
      { claimType: "statement_faithful", rewardWeight: 2 },
      { claimType: "novelty_reviewed", rewardWeight: 2 },
      { claimType: "project_accepted", rewardWeight: 2 },
    ],
  );
  assert.equal(verificationMarketBoundaries.requiresActivePool, true);
  assert.equal(verificationMarketBoundaries.requiresDifferentOwner, true);
  assert.equal(verificationMarketBoundaries.rewardIsReservedAtClaim, false);
});

test("verification job state never treats claiming as completed review", () => {
  assert.equal(projectVerificationJobState({ claimed: false }), "open");
  assert.equal(projectVerificationJobState({ claimed: true, assignmentStatus: "accepted" }), "claimed");
  assert.equal(projectVerificationJobState({ claimed: true, assignmentStatus: "completed" }), "completed");
  assert.throws(
    () => projectVerificationJobState({ claimed: false, assignmentStatus: "completed" }),
    VerificationMarketPolicyError,
  );
});

test("completed review shares divide a fixed budget deterministically", () => {
  const allocation = allocateCompletedReviewCredits(2_000, [
    { jobId: "job:novelty", rewardWeight: 2, decision: "attested" },
    { jobId: "job:reproduce", rewardWeight: 1, decision: "rejected" },
    { jobId: "job:fidelity", rewardWeight: 2, decision: "request_changes" },
  ]);
  assert.deepEqual(allocation, [
    { jobId: "job:fidelity", rewardWeight: 2, decision: "request_changes", credits: 800 },
    { jobId: "job:novelty", rewardWeight: 2, decision: "attested", credits: 800 },
    { jobId: "job:reproduce", rewardWeight: 1, decision: "rejected", credits: 400 },
  ]);
  assert.equal(allocation.reduce((sum, entry) => sum + entry.credits, 0), 2_000);
});

test("a conflict declaration or incomplete work cannot share review credit", () => {
  assert.throws(
    () => allocateCompletedReviewCredits(100, [
      { jobId: "job:conflict", rewardWeight: 1, decision: "conflict_declared" },
    ]),
    /evidence-bearing review decision/,
  );
});
