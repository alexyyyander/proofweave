export const verificationMarketPolicyVersion = "pw-verification-market-v1";

export const verificationMarketClaims = Object.freeze([
  Object.freeze({
    claimType: "bundle_reproducible",
    label: "Reproduce the Bundle",
    rewardWeight: 1,
    evidenceRequirement: "A fresh isolated replay of this exact Bundle.",
  }),
  Object.freeze({
    claimType: "statement_faithful",
    label: "Check statement fidelity",
    rewardWeight: 2,
    evidenceRequirement: "A source-linked comparison of the formal and intended statements.",
  }),
  Object.freeze({
    claimType: "novelty_reviewed",
    label: "Review novelty",
    rewardWeight: 2,
    evidenceRequirement: "A cited search record covering the claimed reusable result.",
  }),
]);

export const verificationMarketBoundaries = Object.freeze({
  requiresActivePool: true,
  requiresStagedBundle: true,
  requiresDifferentOwner: true,
  requiresActiveReviewDelegation: true,
  claimImmediatelyAcceptsAssignment: true,
  rewardIsReservedAtClaim: false,
  rewardSettlesOnlyAfterReceiptClosure: true,
});

export const verificationMarketJobEventTypes = Object.freeze(["published", "claimed", "withdrawn"]);

export function verificationClaimPolicy(claimType) {
  return verificationMarketClaims.find((claim) => claim.claimType === claimType) ?? null;
}

export function assertVerificationMarketPolicy(claims = verificationMarketClaims) {
  if (!Array.isArray(claims) || claims.length === 0) {
    throw new VerificationMarketPolicyError("Verification market claims are required.");
  }
  const types = new Set();
  for (const claim of claims) {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      throw new VerificationMarketPolicyError("Every verification market claim must be an object.");
    }
    if (typeof claim.claimType !== "string" || claim.claimType.length === 0 || types.has(claim.claimType)) {
      throw new VerificationMarketPolicyError("Verification market claim types must be unique non-empty strings.");
    }
    if (!Number.isSafeInteger(claim.rewardWeight) || claim.rewardWeight < 1 || claim.rewardWeight > 100) {
      throw new VerificationMarketPolicyError("Verification market reward weights must be integers between 1 and 100.");
    }
    types.add(claim.claimType);
  }
  return true;
}

export function projectVerificationJobState({ claimed, assignmentStatus = null }) {
  if (!claimed) {
    if (assignmentStatus !== null) {
      throw new VerificationMarketPolicyError("An unclaimed verification job cannot have an assignment state.");
    }
    return "open";
  }
  if (assignmentStatus === "accepted" || assignmentStatus === "assigned") return "claimed";
  if (assignmentStatus === "completed") return "completed";
  if (assignmentStatus === "cancelled") return "withdrawn";
  throw new VerificationMarketPolicyError(`Unsupported claimed verification assignment state: ${assignmentStatus}.`);
}

export function allocateCompletedReviewCredits(totalCredits, reviews) {
  if (!Number.isSafeInteger(totalCredits) || totalCredits < 0 || totalCredits > 1_000_000_000) {
    throw new VerificationMarketPolicyError("Review credit budget must be a non-negative safe integer no larger than 1,000,000,000.");
  }
  if (!Array.isArray(reviews)) {
    throw new VerificationMarketPolicyError("Completed review records must be an array.");
  }
  const eligible = reviews.map((review) => normalizeCompletedReview(review));
  if (eligible.length === 0) return Object.freeze([]);
  const totalWeight = eligible.reduce((sum, review) => sum + review.rewardWeight, 0);
  const provisional = eligible.map((review) => {
    const numerator = totalCredits * review.rewardWeight;
    return {
      ...review,
      credits: Math.floor(numerator / totalWeight),
      remainder: numerator % totalWeight,
    };
  });
  let undistributed = totalCredits - provisional.reduce((sum, review) => sum + review.credits, 0);
  const remainderOrder = [...provisional].sort((left, right) =>
    right.remainder - left.remainder || left.jobId.localeCompare(right.jobId),
  );
  for (let index = 0; index < undistributed; index += 1) remainderOrder[index].credits += 1;
  return Object.freeze(provisional
    .sort((left, right) => left.jobId.localeCompare(right.jobId))
    .map((review) => Object.freeze({
      jobId: review.jobId,
      rewardWeight: review.rewardWeight,
      decision: review.decision,
      credits: review.credits,
    })));
}

function normalizeCompletedReview(review) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new VerificationMarketPolicyError("Every completed review must be an object.");
  }
  if (typeof review.jobId !== "string" || review.jobId.length === 0 || review.jobId.length > 240) {
    throw new VerificationMarketPolicyError("Completed review jobId must be a bounded identifier.");
  }
  if (!Number.isSafeInteger(review.rewardWeight) || review.rewardWeight < 1 || review.rewardWeight > 100) {
    throw new VerificationMarketPolicyError("Completed review rewardWeight must be an integer between 1 and 100.");
  }
  if (!["attested", "rejected", "request_changes", "integrity_flagged"].includes(review.decision)) {
    throw new VerificationMarketPolicyError("Only a completed evidence-bearing review decision can share the verification bucket.");
  }
  return Object.freeze({
    jobId: review.jobId,
    rewardWeight: review.rewardWeight,
    decision: review.decision,
  });
}

export class VerificationMarketPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "VerificationMarketPolicyError";
  }
}

assertVerificationMarketPolicy();
