/-
Copyright 2026 Yangyang Yu.
SPDX-License-Identifier: Apache-2.0

Prepared by the delegated Codex Agent for a Proofweave user-journey audit.
This is a formalization of a classical identity, not a claim of mathematical novelty.
-/

namespace ProofweaveJourney

/-- The sum of the first `n` positive odd natural numbers. -/
def oddSum : Nat → Nat
  | 0 => 0
  | n + 1 => oddSum n + (2 * n + 1)

/-- The first `n` positive odd numbers sum to `n * n`. -/
theorem oddSum_eq_square (n : Nat) : oddSum n = n * n := by
  induction n with
  | zero => rfl
  | succ n ih =>
    simp only [oddSum, ih, Nat.mul_add, Nat.add_mul,
      Nat.mul_one, Nat.one_mul, Nat.two_mul, Nat.add_assoc]

#print axioms oddSum_eq_square

end ProofweaveJourney
