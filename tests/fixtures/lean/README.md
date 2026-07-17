# Lean runner fixtures

These fixture-sized Lake projects freeze expected compiler and policy outcomes
before a production runner is selected. They are intentionally Core Lean only:
they exercise a pinned Lean toolchain without pulling a network dependency.
They do **not** demonstrate container isolation, R2 bundle retrieval, or a
production Mathlib environment.

| Fixture | Expected Lean exit | Expected runner conclusion |
| --- | --- | --- |
| `core-success` | `0` | kernel accepted; no `sorry` |
| `core-compiler-error` | non-zero | compiler failure; no kernel claim |
| `core-sorry` | `0` | rejected by the mandatory `sorry` audit |

Run all fixtures on a machine with Lean/Lake 4.30 installed:

```sh
npm run runner:fixtures:check
```

The script invokes only the checked-in `lake env lean ProofweaveFixture.lean`
argument arrays. It is a local fixture check, not a way to execute a submitted
Proofweave Artifact Bundle.
