import assert from "node:assert/strict";
import test from "node:test";
import { derivePoolCreditAllocation, PoolAllocationError } from "../packages/protocol/pool-credit-allocation.mjs";

const sha = (character) => `sha256:${character.repeat(64)}`;
const receipt = (id, person, hash) => ({ receiptId: id, personId: person, attemptOwnerPersonId: person, receiptHash: sha(hash) });
const root = receipt("receipt:root", "person:owner", "a");
const dependencies = [receipt("receipt:z", "person:z", "d"), receipt("receipt:a", "person:a", "b"), receipt("receipt:m", "person:m", "c")];
const reviews = [
  { jobId: `verification-job:${"1".repeat(64)}`, assignmentId: "assignment:one", personId: "person:reviewer1", sourceReceiptId: root.receiptId, attestationId: "attestation:one", attestationHash: sha("e"), claimType: "bundle_reproducible", decision: "attested", rewardWeight: 1 },
  { jobId: `verification-job:${"2".repeat(64)}`, assignmentId: "assignment:two", personId: "person:reviewer2", sourceReceiptId: root.receiptId, attestationId: "attestation:two", attestationHash: sha("f"), claimType: "kernel_accepted", decision: "attested", rewardWeight: 2 },
];
const input = { poolId: "pool:test", problemRevisionId: "revision:test", totalCredits: 1000, finalReceipt: root, dependencies, reviews };

test("allocates fixed buckets, equally splits verified dependencies by Receipt ID, and preserves the challenge reserve", async () => {
  const plan = await derivePoolCreditAllocation(input);
  assert.deepEqual(plan.entries, [
    { bucket: "final_result", personId: "person:owner", units: 300, reasonId: "receipt:root" },
    { bucket: "verified_dependencies", personId: "person:a", units: 134, reasonId: "receipt:a" },
    { bucket: "verified_dependencies", personId: "person:m", units: 133, reasonId: "receipt:m" },
    { bucket: "verified_dependencies", personId: "person:z", units: 133, reasonId: "receipt:z" },
    { bucket: "independent_verification", personId: "person:reviewer1", units: 67, reasonId: reviews[0].jobId },
    { bucket: "independent_verification", personId: "person:reviewer2", units: 133, reasonId: reviews[1].jobId },
  ]);
  assert.deepEqual(plan.reserved, { verified_dependencies: 0, independent_verification: 0, challenge_reserve: 100 });
  const reordered = await derivePoolCreditAllocation({ ...input, dependencies: [...dependencies].reverse(), reviews: [...reviews].reverse() });
  assert.deepEqual(reordered, plan);
});

test("does not reassign a missing dependency or review bucket", async () => {
  const plan = await derivePoolCreditAllocation({ ...input, dependencies: [], reviews: [] });
  assert.deepEqual(plan.entries, [{ bucket: "final_result", personId: "person:owner", units: 300, reasonId: "receipt:root" }]);
  assert.deepEqual(plan.reserved, { verified_dependencies: 400, independent_verification: 200, challenge_reserve: 100 });
});

test("review remainder follows job ID order even when fractional remainders differ", async () => {
  const four = [
    { ...reviews[1], jobId: `verification-job:${"1".repeat(64)}` },
    { ...reviews[0], jobId: `verification-job:${"2".repeat(64)}` },
    { ...reviews[1], jobId: `verification-job:${"3".repeat(64)}`, assignmentId: "assignment:three", attestationId: "attestation:three" },
    { ...reviews[1], jobId: `verification-job:${"4".repeat(64)}`, assignmentId: "assignment:four", attestationId: "attestation:four" },
  ];
  const plan = await derivePoolCreditAllocation({ ...input, reviews: four.reverse() });
  assert.deepEqual(plan.entries.filter((entry) => entry.bucket === "independent_verification").map((entry) => entry.units), [58, 28, 57, 57]);
});

test("refuses duplicate dependencies, self-review, duplicate evidence and mismatched policy weight", async () => {
  for (const invalid of [
    { dependencies: [dependencies[0], dependencies[0]] },
    { dependencies: [root] },
    { reviews: [reviews[0], reviews[0]] },
    { reviews: [{ ...reviews[0], personId: root.personId }] },
    { reviews: [{ ...reviews[0], sourceReceiptId: "receipt:outside" }] },
    { reviews: [{ ...reviews[0], rewardWeight: 2 }] },
    { reviews: [{ ...reviews[0], attestationHash: "not-a-hash" }] },
  ]) await assert.rejects(derivePoolCreditAllocation({ ...input, ...invalid }), PoolAllocationError);
});
