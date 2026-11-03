import { sha256Canonical } from "./canonical-json.mjs";
import { allocateCreditPool } from "./credit-market.mjs";
import { verificationClaimPolicy } from "./verification-market.mjs";

export const poolSettlementPolicyVersion = "pw-pool-settlement-v1";

/**
 * Calculate a deterministic allocation from a closure that the caller has
 * already verified against the database. This pure function does not verify
 * signatures, assert finality, lock a pool, or write a ledger.
 */
export async function derivePoolCreditAllocation({ poolId, problemRevisionId, totalCredits, finalReceipt, dependencies, reviews }) {
  identifier(poolId, "poolId");
  identifier(problemRevisionId, "problemRevisionId");
  const root = normalizeReceipt(finalReceipt);
  if (!Array.isArray(dependencies) || !Array.isArray(reviews)) throw new PoolAllocationError("Verified dependencies and reviews must be arrays.");
  const dependencyRecords = dependencies.map(normalizeReceipt).sort((a, b) => compareIdentifiers(a.receiptId, b.receiptId));
  const receiptIds = new Set([root.receiptId]);
  for (const receipt of dependencyRecords) {
    if (receiptIds.has(receipt.receiptId)) throw new PoolAllocationError("Dependency closure contains a duplicate or root Receipt.");
    receiptIds.add(receipt.receiptId);
  }
  const ownersByReceipt = new Map([root, ...dependencyRecords].map((receipt) => [receipt.receiptId, receipt.attemptOwnerPersonId]));
  const reviewRecords = reviews.map((review) => normalizeReview(review, ownersByReceipt)).sort((a, b) => compareIdentifiers(a.jobId, b.jobId));
  const assignments = new Set();
  const jobs = new Set();
  const attestations = new Set();
  for (const review of reviewRecords) {
    if (assignments.has(review.assignmentId) || jobs.has(review.jobId) || attestations.has(review.attestationId)) throw new PoolAllocationError("Completed review evidence must not be counted twice.");
    assignments.add(review.assignmentId);
    jobs.add(review.jobId);
    attestations.add(review.attestationId);
  }
  const bucketMap = Object.fromEntries(allocateCreditPool(totalCredits).map((bucket) => [bucket.key, bucket.credits]));
  const entries = [];
  if (bucketMap.final_result > 0) entries.push({ bucket: "final_result", personId: root.personId, units: bucketMap.final_result, reasonId: root.receiptId });
  if (dependencyRecords.length > 0) {
    const base = Math.floor(bucketMap.verified_dependencies / dependencyRecords.length);
    const remainder = bucketMap.verified_dependencies % dependencyRecords.length;
    dependencyRecords.forEach((receipt, index) => {
      const units = base + (index < remainder ? 1 : 0);
      if (units > 0) entries.push({ bucket: "verified_dependencies", personId: receipt.personId, units, reasonId: receipt.receiptId });
    });
  }
  const totalWeight = reviewRecords.reduce((sum, review) => sum + review.rewardWeight, 0);
  const shares = reviewRecords.map((review) => {
    const numerator = bucketMap.independent_verification * review.rewardWeight;
    return { review, units: Math.floor(numerator / totalWeight) };
  });
  const remaining = bucketMap.independent_verification - shares.reduce((sum, share) => sum + share.units, 0);
  // reviewRecords are already sorted by canonical job ID. Distribute all
  // integer remainder units in that order, as specified by the pool owner.
  for (let index = 0; index < (shares.length ? remaining : 0); index += 1) shares[index].units += 1;
  for (const share of shares) {
    if (share.units > 0) entries.push({ bucket: "independent_verification", personId: share.review.personId, units: share.units, reasonId: share.review.jobId });
  }
  const reserved = Object.freeze({
    verified_dependencies: dependencyRecords.length === 0 ? bucketMap.verified_dependencies : 0,
    independent_verification: reviewRecords.length === 0 ? bucketMap.independent_verification : 0,
    challenge_reserve: bucketMap.challenge_reserve,
  });
  const allocated = entries.reduce((sum, entry) => sum + entry.units, 0);
  if (allocated + Object.values(reserved).reduce((sum, amount) => sum + amount, 0) !== totalCredits) {
    throw new PoolAllocationError("Pool allocation does not conserve the budget.");
  }
  const plan = Object.freeze({
    protocolVersion: poolSettlementPolicyVersion, poolId, problemRevisionId, totalCredits,
    finalReceipt: root, dependencies: Object.freeze(dependencyRecords), reviews: Object.freeze(reviewRecords),
    entries: Object.freeze(entries.map((entry) => Object.freeze(entry))), reserved,
  });
  return Object.freeze({ ...plan, payloadHash: await sha256Canonical(plan) });
}

function normalizeReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new PoolAllocationError("Receipt evidence is required.");
  identifier(receipt.receiptId, "receiptId");
  identifier(receipt.personId, "receipt beneficiary");
  identifier(receipt.attemptOwnerPersonId, "attempt owner");
  digest(receipt.receiptHash, "receiptHash");
  return Object.freeze({ receiptId: receipt.receiptId, receiptHash: receipt.receiptHash, personId: receipt.personId, attemptOwnerPersonId: receipt.attemptOwnerPersonId });
}

function normalizeReview(review, ownersByReceipt) {
  if (!review || typeof review !== "object" || Array.isArray(review)) throw new PoolAllocationError("Review evidence is required.");
  for (const [key, label] of [["jobId", "jobId"], ["assignmentId", "assignmentId"], ["personId", "reviewer Person"], ["attestationId", "attestationId"], ["sourceReceiptId", "source Receipt"]]) identifier(review[key], label);
  if (!/^verification-job:[0-9a-f]{64}$/.test(review.jobId)) throw new PoolAllocationError("Review jobId must be the canonical market job identifier.");
  digest(review.attestationHash, "attestationHash");
  const ownerPersonId = ownersByReceipt.get(review.sourceReceiptId);
  if (!ownerPersonId) throw new PoolAllocationError("Review must belong to a Receipt in the frozen closure.");
  if (review.personId === ownerPersonId) throw new PoolAllocationError("A target owner cannot receive independent review credit.");
  const policy = verificationClaimPolicy(review.claimType);
  if (!policy || review.rewardWeight !== policy.rewardWeight) throw new PoolAllocationError("Review weight must match the current claim policy.");
  if (!["attested", "rejected", "request_changes", "integrity_flagged"].includes(review.decision)) throw new PoolAllocationError("Review decision must be evidence-bearing.");
  return Object.freeze({ jobId: review.jobId, assignmentId: review.assignmentId, claimType: review.claimType, personId: review.personId, sourceReceiptId: review.sourceReceiptId, attestationId: review.attestationId, attestationHash: review.attestationHash, decision: review.decision, rewardWeight: review.rewardWeight });
}

function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:._-]{2,519}$/.test(value)) throw new PoolAllocationError(`${label} must be a bounded identifier.`);
}

function digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value)) throw new PoolAllocationError(`${label} must be a SHA-256 digest.`);
}

function compareIdentifiers(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class PoolAllocationError extends Error {
  constructor(message) { super(message); this.name = "PoolAllocationError"; }
}
