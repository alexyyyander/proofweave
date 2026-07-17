import assert from "node:assert/strict";
import test from "node:test";
import {
  CreditMarketPolicyError,
  allocateCreditPool,
  assertCreditMarketPolicy,
  creditMarketBoundaries,
  creditMarketBuckets,
  projectCreditPoolState,
} from "../packages/protocol/credit-market.mjs";

test("credit market v1 allocates a fixed pool without equating compute spend to contribution", () => {
  assert.equal(assertCreditMarketPolicy(), true);
  assert.deepEqual(
    allocateCreditPool(10_000).map(({ key, credits }) => ({ key, credits })),
    [
      { key: "final_result", credits: 3_000 },
      { key: "verified_dependencies", credits: 4_000 },
      { key: "independent_verification", credits: 2_000 },
      { key: "challenge_reserve", credits: 1_000 },
    ],
  );
  assert.equal(creditMarketBoundaries.tokenSpendCreatesCredit, false);
  assert.equal(creditMarketBoundaries.computeSpendCreatesCredit, false);
  assert.equal(creditMarketBoundaries.sameOwnerReviewEligible, false);
  assert.equal(creditMarketBoundaries.receiptRequiredForSettlement, true);
});

test("credit allocation preserves every integer unit through deterministic rounding", () => {
  const allocation = allocateCreditPool(17);
  assert.equal(allocation.reduce((sum, bucket) => sum + bucket.credits, 0), 17);
  assert.deepEqual(allocation.map((bucket) => bucket.credits), [5, 7, 3, 2]);
});

test("credit policy rejects weights that can inflate or hide the fixed pool", () => {
  assert.throws(
    () => assertCreditMarketPolicy([{ key: "solver", basisPoints: 9_999 }]),
    CreditMarketPolicyError,
  );
  assert.throws(() => allocateCreditPool(0), CreditMarketPolicyError);
  assert.equal(creditMarketBuckets.reduce((sum, bucket) => sum + bucket.basisPoints, 0), 10_000);
});

test("credit pool state is an append-only transition projection", () => {
  assert.equal(projectCreditPoolState([]), "absent");
  assert.equal(projectCreditPoolState([
    { sequence: 1, eventType: "created" },
    { sequence: 2, eventType: "activated" },
    { sequence: 3, eventType: "locked" },
    { sequence: 4, eventType: "settled" },
  ]), "settled");
  assert.throws(
    () => projectCreditPoolState([{ sequence: 1, eventType: "activated" }]),
    /invalid while the pool is absent/,
  );
  assert.throws(
    () => projectCreditPoolState([{ sequence: 2, eventType: "created" }]),
    /contiguous and begin at one/,
  );
});
