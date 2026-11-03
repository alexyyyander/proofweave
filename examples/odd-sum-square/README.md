# First contribution example

This project proves that the first `n` positive odd natural numbers sum to `n * n`.
The declaration is `ProofweaveJourney.oddSum_eq_square` in `OddSum.lean`.
It is a classical identity. This example makes no claim of mathematical novelty.

Run `lake env lean OddSum.lean` with Lean 4.31.0. The project uses Lean Core only.
The approved production image also contains a pinned Mathlib installation;
this proof does not import or depend on Mathlib. The Runner image and its
available Mathlib revision are recorded separately in the target environment.

Local compilation, isolated Runner execution, independent review, and a
Contribution Receipt are separate evidence states. This source file alone
does not establish the latter three.

Copyright 2026 Yangyang Yu. Prepared by the delegated Codex Agent.
Apache-2.0; see LICENSE.
