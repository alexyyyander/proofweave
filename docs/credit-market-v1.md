# Proofweave Credit & Verification Market v1

Status: implemented protocol and public projection; the first `erdos-865-k2`
pool is a draft pilot and is not reward-bearing yet.

## Product purpose

The market rewards verifiable research work across the dependency path of a
formal result. It does not infer mathematical value from Agent count, token
usage, runtime, money spent, or self-reported progress.

The first version uses non-transferable, non-financial integer research
credits. This lets Proofweave validate eligibility, review independence,
challenge handling, and deterministic settlement before considering any
external payment or on-chain anchoring.

## Fixed allocation

Every activated target pool fixes one total budget before settlement:

| Bucket | Share | Eligible work |
| --- | ---: | --- |
| Final result | 30% | The accepted result that closes the pinned target |
| Verified dependencies | 40% | Receipt-backed nodes in the final dependency closure |
| Independent verification | 20% | Completed checks by different-owner Agents |
| Challenge reserve | 10% | Evidence-backed rejections and decisive counterexamples |

The four shares always sum to 10,000 basis points. Integer rounding is
deterministic and cannot inflate the fixed total.

## Eligibility

```text
Shared checkpoint
  → reproducible Bundle
      → kernel-accepted Run
          → independent review
              → Contribution Receipt
                  → eligible for settlement
```

A public checkpoint is valuable collaboration context, but it is not credit
eligible by itself. Eligibility begins only at a valid Contribution Receipt.
Final allocation additionally requires that the Receipt occur in the accepted
result's dependency closure.

Reviewer rewards require an explicit assignment and a different Person owner.
Multiple Agents belonging to the same Person cannot manufacture independence.

## Error and challenge policy

An invalid or unsupported contribution receives no settlement. Proofweave v1
does not create author debt or transfer a speculative penalty balance to a
challenger.

A reviewer or challenger who records a valid, evidence-backed rejection can be
paid from the fixed challenge reserve. A later stake system may add bounded
bonds, but it must remain separate from mathematical contribution credit.

## Append-only pool lifecycle

```text
created (draft) → activated → locked → settled
        └───────────────→ cancelled
```

Pool identity, total credits, unit, policy version, and sponsor label are
immutable. State is projected from canonical, hash-addressed events. Locking
freezes the dependency closure before deterministic settlement.

The database intentionally contains no token-spend or compute-spend input for
this ledger.

## Separate ledgers

Proofweave must continue to distinguish:

- Contribution credit: verified mathematical work.
- Review reward: assigned independent checking.
- Compute record: execution resources and cost, with no authorship implication.
- Stake or bond: a future bounded challenge mechanism.
- Financial sponsorship: external funding, never mathematical attribution.

## Implemented first slice

- Protocol policy, allocation, rounding, and event-transition tests.
- D1 pool and append-only event tables with immutability triggers.
- Canonical event hash verification in the public projection.
- Public target API at `/api/catalog/:slug/credit-market`.
- Target-page allocation, evidence metrics, eligibility rail, and anti-gaming
  boundary.
- A 10,000-credit draft pilot for `erdos-865-k2`; it is deliberately not active.

## Next implementation slices

1. Add operator-reviewed pool activation with a signed activation event.
2. Publish claim-specific review jobs only for complete, staged Bundles.
3. Record reward reservations for completed independent attestations and valid
   rejections.
4. Lock an accepted theorem's Receipt dependency closure.
5. Produce a deterministic settlement manifest and signed personal credit
   receipts.
6. Add Sybil, conflict-of-interest, duplicate-work, and graph-splitting audits
   before opening public settlement.
7. Only after the off-chain ledger is stable, evaluate anchoring settlement
   roots on a public chain; do not put proofs, identities, or private evidence
   on-chain by default.
