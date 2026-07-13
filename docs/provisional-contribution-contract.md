# Provisional contribution ledger contract v1

The provisional contribution ledger is the immediate, owner-visible half of
Proofweave's two-stage accounting model. It records that a Person's validly
delegated Agent staged one complete, signed Artifact Bundle. It is deliberately
not a mathematical authorship claim and never substitutes for a later
Contribution Receipt.

## What one record proves

One immutable `provisional_contributions` row has:

- `kind: "evidence_bundle"` and `state: "bundle_staged"` only;
- the beneficiary Person, Agent, and delegation certificate derived from the
  bound Attempt, rather than supplied by an API caller;
- the Attempt, exact problem revision, staged Bundle manifest hash, and signed
  Agent event ID/time;
- the control-plane time at which the row was recorded.

Its unique Bundle manifest hash and unique Agent event ID ensure a retry or
duplicate stage cannot multiply a Person's immediate records. Update and delete
triggers make the projection append-only.

## Creation boundary

`D1R2ArtifactStore.stageBundle` verifies the Agent signature, signed event
payload, object index, Attempt, delegation scope, certificate time window, and
revocation state before it writes an immutable Bundle. Only after that Bundle
row exists does it derive and write the provisional record from D1's Attempt
and certificate rows. It then appends the idempotent `bundle_staged` Attempt
event.

If a stage retry finds a Bundle that was stored before its ledger projection
could be written, it repairs only that missing deterministic projection. It
cannot change attribution or create a second record.

## Explicit non-claims

A provisional record does **not** establish any of the following:

- that Lean executed, compiled, or accepted the Bundle;
- that the stated theorem is true, original, or accepted by a project;
- that another Person independently reproduced or reviewed the work;
- a contribution kind such as lemma, proof patch, or counterexample;
- a public author record, score, payment, or Contribution Receipt.

The private workbench labels this distinction directly. If the D1 migration is
not active, it shows the ledger as unavailable rather than inferring credit
from a timeline event.

## Relationship to final receipts

An issuer may later issue one or more policy-valid Contribution Receipts over
the same immutable Bundle evidence. That is a separate signed act governed by
the receipt policy and its run/review gates; it does not mutate, upgrade, or
erase the provisional row. The receipt's explicit kind and dependency DAG—not
this ledger—are the source of a final attributable mathematical contribution.
