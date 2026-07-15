export const creditMarketPolicyVersion = "pw-credit-market-v1";
export const creditMarketUnit = "non_transferable_research_credit";

export const creditMarketBuckets = Object.freeze([
  Object.freeze({
    key: "final_result",
    label: "Final result",
    basisPoints: 3_000,
    description: "Reserved for the accepted result that closes the pinned target.",
  }),
  Object.freeze({
    key: "verified_dependencies",
    label: "Verified dependencies",
    basisPoints: 4_000,
    description: "Distributed over Receipt-backed nodes in the final dependency closure.",
  }),
  Object.freeze({
    key: "independent_verification",
    label: "Independent verification",
    basisPoints: 2_000,
    description: "Reserved for different-owner Agents that complete assigned checks.",
  }),
  Object.freeze({
    key: "challenge_reserve",
    label: "Challenge reserve",
    basisPoints: 1_000,
    description: "Rewards evidence-backed rejections and counterexamples without inventing author debt.",
  }),
]);

export const creditMarketBoundaries = Object.freeze({
  tokenSpendCreatesCredit: false,
  computeSpendCreatesCredit: false,
  rawCheckpointEligible: false,
  sameOwnerReviewEligible: false,
  receiptRequiredForSettlement: true,
  transferable: false,
  financialAsset: false,
});

export const creditEligibilityStages = Object.freeze([
  Object.freeze({ key: "shared", label: "Shared checkpoint", eligible: false }),
  Object.freeze({ key: "bundle_staged", label: "Reproducible Bundle", eligible: false }),
  Object.freeze({ key: "kernel_accepted", label: "Kernel accepted", eligible: false }),
  Object.freeze({ key: "review_recorded", label: "Independent review", eligible: false }),
  Object.freeze({ key: "receipt_recorded", label: "Contribution Receipt", eligible: true }),
]);

export const creditPoolEventTypes = Object.freeze([
  "created",
  "activated",
  "locked",
  "settled",
  "cancelled",
]);

const nextPoolStates = Object.freeze({
  absent: Object.freeze({ created: "draft" }),
  draft: Object.freeze({ activated: "active", cancelled: "cancelled" }),
  active: Object.freeze({ locked: "locked", cancelled: "cancelled" }),
  locked: Object.freeze({ settled: "settled" }),
  settled: Object.freeze({}),
  cancelled: Object.freeze({}),
});

export function assertCreditMarketPolicy(buckets = creditMarketBuckets) {
  if (!Array.isArray(buckets) || buckets.length === 0) {
    throw new CreditMarketPolicyError("Credit market buckets are required.");
  }
  const keys = new Set();
  let totalBasisPoints = 0;
  for (const bucket of buckets) {
    if (!bucket || typeof bucket !== "object" || Array.isArray(bucket)) {
      throw new CreditMarketPolicyError("Every credit market bucket must be an object.");
    }
    if (typeof bucket.key !== "string" || bucket.key.length === 0 || keys.has(bucket.key)) {
      throw new CreditMarketPolicyError("Credit market bucket keys must be unique non-empty strings.");
    }
    if (!Number.isInteger(bucket.basisPoints) || bucket.basisPoints < 0 || bucket.basisPoints > 10_000) {
      throw new CreditMarketPolicyError("Credit market basis points must be integers between 0 and 10,000.");
    }
    keys.add(bucket.key);
    totalBasisPoints += bucket.basisPoints;
  }
  if (totalBasisPoints !== 10_000) {
    throw new CreditMarketPolicyError("Credit market bucket weights must sum to 10,000 basis points.");
  }
  return true;
}

export function allocateCreditPool(totalCredits, buckets = creditMarketBuckets) {
  assertCreditMarketPolicy(buckets);
  if (!Number.isSafeInteger(totalCredits) || totalCredits < 1 || totalCredits > 1_000_000_000) {
    throw new CreditMarketPolicyError("Credit pool size must be a positive safe integer no larger than 1,000,000,000.");
  }
  const provisional = buckets.map((bucket, order) => {
    const numerator = totalCredits * bucket.basisPoints;
    return {
      ...bucket,
      order,
      credits: Math.floor(numerator / 10_000),
      remainder: numerator % 10_000,
    };
  });
  let undistributed = totalCredits - provisional.reduce((sum, bucket) => sum + bucket.credits, 0);
  const remainderOrder = [...provisional].sort((left, right) =>
    right.remainder - left.remainder || left.order - right.order,
  );
  for (let index = 0; index < undistributed; index += 1) {
    remainderOrder[index].credits += 1;
  }
  return Object.freeze(provisional.map((bucket) => Object.freeze({
    key: bucket.key,
    label: bucket.label,
    basisPoints: bucket.basisPoints,
    description: bucket.description,
    credits: bucket.credits,
  })));
}

export function projectCreditPoolState(events) {
  if (!Array.isArray(events)) {
    throw new CreditMarketPolicyError("Credit pool events must be an array.");
  }
  let state = "absent";
  let expectedSequence = 1;
  for (const event of events) {
    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new CreditMarketPolicyError("Every credit pool event must be an object.");
    }
    if (event.sequence !== expectedSequence) {
      throw new CreditMarketPolicyError("Credit pool event sequences must be contiguous and begin at one.");
    }
    if (!creditPoolEventTypes.includes(event.eventType)) {
      throw new CreditMarketPolicyError(`Unknown credit pool event type: ${event.eventType}.`);
    }
    const nextState = nextPoolStates[state]?.[event.eventType];
    if (!nextState) {
      throw new CreditMarketPolicyError(`Credit pool event ${event.eventType} is invalid while the pool is ${state}.`);
    }
    state = nextState;
    expectedSequence += 1;
  }
  return state;
}

export class CreditMarketPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "CreditMarketPolicyError";
  }
}

assertCreditMarketPolicy();
