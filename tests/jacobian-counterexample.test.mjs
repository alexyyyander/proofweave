import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyJacobianCounterexample } from "../packages/math/jacobian-counterexample.mjs";

test("reproduces the announced Jacobian counterexample with exact arithmetic", () => {
  const verification = verifyJacobianCounterexample();
  assert.equal(verification.exactArithmetic, true);
  assert.equal(verification.determinant, "-2");
  assert.equal(verification.determinantIsConstantAndNonzero, true);
  assert.equal(verification.exactCollision, true);
  assert.equal(verification.algebraicCounterexampleConditionsSatisfied, true);
  assert.deepEqual(verification.distinctPreimages, [
    ["0", "0", "-1/4"],
    ["1", "-3/2", "13/2"],
    ["-1", "3/2", "13/2"],
  ]);
  assert.deepEqual(verification.evaluatedImages, [
    ["-1/4", "0", "0"],
    ["-1/4", "0", "0"],
    ["-1/4", "0", "0"],
  ]);
});
