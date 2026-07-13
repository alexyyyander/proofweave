# Contribution Receipt contract v1

`pw-contribution-receipt-v1` is a canonical, issuer-signed record of one
accepted contribution. It is not a profile score, an Agent-run count, a payment
record, or a claim that every reviewer agrees with every mathematical detail.

It is also distinct from the private provisional contribution ledger. A staged
Bundle can create one immutable `evidence_bundle` / `bundle_staged` record for
its delegating Person, but that immediate record asserts only attributable
evidence staging. It neither becomes nor is rewritten by a Receipt. See the
[provisional contribution ledger contract](provisional-contribution-contract.md).

## Covered evidence

Every receipt fixes all of the following:

- its contribution kind: `formalization`, `lemma`, `proof_patch`,
  `counterexample`, `verification`, `synthesis`, or `infrastructure`;
- credited Person, delegated Agent, and delegation certificate;
- originating Attempt, target problem revision, Lean declaration, and statement
  hash;
- immutable Artifact Bundle manifest plus upstream dependency receipts;
- exact Run request/result hashes and its reported kernel status;
- exact Attestation IDs/hashes, claim types, reviewer Person/Agent/delegation,
  and `attested` decision;
- issuance time, policy version, issuer key ID/public key, canonical payload
  hash, and detached Ed25519 issuer signature.

The canonical receipt hash covers the signature as well as every evidence
field. Any change therefore creates a distinct receipt hash. The signing
payload excludes only its own derived payload hash and detached signature.

## Initial issuance policy

`pw-receipt-policy-v1` is intentionally conservative. A certified receipt
requires a `succeeded` Run with `kernelStatus: "accepted"` and independent,
attested evidence for all three claims:

```text
bundle_reproducible
kernel_accepted
project_accepted
```

Each covered reviewer Person must differ from the Attempt owner. Normal
contribution kinds credit the Person/Agent/delegation that own the Attempt. A
`verification` receipt instead credits a different Person only when its Agent
and review delegation are named on one of the covered non-project review
attestations.

The policy function is a protocol guard, not a database lookup. Before an
issuer signs a receipt, the D1 adapter resolves every ID/hash to immutable
Bundle, Run, and Attestation records and applies any curator or retraction
policy in force at issuance.

## External verification

An external verifier can canonicalize the JSON, recompute `payloadHash`,
verify the Ed25519 signature with `issuerPublicKey`, and recompute the full
receipt hash without the Proofweave UI. The public
`GET /api/receipts/issuer-keys` keyset records Proofweave's operator-managed
key IDs, public keys, activation times, retirement, and emergency revocation
status; it contains no signing material.

Exactly one issuer key is active at a time. A new Receipt or lifecycle event
must use that active key. Rotation retires the prior key and installs the
successor in one control-plane transaction; already-issued receipts retain
their embedded original key and remain trusted only when their timestamp falls
within that retired key's validity interval. A revoked key is no longer trusted
for receipt display or dependency validation, including historical evidence,
until a future recovery policy explicitly supplies replacement evidence.

## Portable verification bundle

`GET /api/receipts/:id/verification-bundle` downloads a
`pw-contribution-receipt-verification-bundle-v1` JSON file for a currently
verified public Receipt. It contains the root Receipt, every upstream Receipt
declared in its dependency closure, every Receipt reached through a signed
lifecycle replacement link, the corresponding signed lifecycle events, and the
read-only issuer-key metadata actually used by that evidence closure.

The endpoint re-resolves each item through the same D1 verification reader
before export. `verifyContributionReceiptVerificationBundle` then rechecks the
Receipt hashes, signatures, policy, issuer-key time windows, dependency hashes,
replacement relationships, lifecycle ordering, and closure completeness without
the Proofweave UI. The response carries the canonical bundle hash in
`X-Proofweave-Verification-Bundle-Hash`.

The issuer-key list is a trust snapshot at download time, not a substitute for
obtaining a newer `/api/receipts/issuer-keys` response when checking later
revocations. The export never contains Agent private keys, issuer private keys,
private artifact bytes, or hidden review material.

An external maintainer can verify a downloaded file without running the web
application:

```bash
npm run receipt:bundle:verify -- /path/to/verification-bundle.json
```

The command exits nonzero on any malformed field, signature/hash mismatch,
missing dependency, invalid lifecycle relationship, issuer-key failure, or
graph-cycle detection, and prints the canonical verification-bundle hash only
after the full closure passes.

## Internal issuance boundary

`D1ContributionReceiptStore` rebuilds a draft only from staged immutable
Bundle, Run/result, and Attestation rows. It does not accept arbitrary target,
claim, or build-result JSON from a route or browser. The store applies the
policy, requests a signature from a caller-supplied deployment secret, then
persists the resulting canonical receipt in an immutable D1 row. Retrying the
same receipt/evidence identity returns the stored receipt rather than issuing a
duplicate.

## Dependency DAG projection

Before issuing a downstream receipt, the store resolves every
`bundle.dependencyReceipts` entry against an existing receipt. Its declared ID
and hash must match an issuer-signed, policy-valid upstream receipt; a receipt
cannot name itself, and an upstream issuance time cannot be after the
downstream issuance time. The receipt and its
`contribution_receipt_dependency_edges` rows are then inserted in one D1 batch.
The edge is therefore a query projection of signed bundle evidence, not a
separately editable claim. Both the receipt and every edge reject update and
delete operations.

## Append-only lifecycle evidence

`pw-contribution-receipt-lifecycle-event-v1` records exactly one of three
issuer-signed events against the original receipt:

- `corrected` links one later receipt covering the same Attempt and target;
- `superseded` links one later receipt covering the same Attempt and target;
- `retracted` records no replacement and never removes the original receipt.

Each event commits a reason hash, time, its signing issuer key ID/public key,
canonical payload hash, and detached Ed25519 signature. The initial policy
requires the current active issuer key, an event time no earlier than issuance,
and (where applicable) a replacement issued after the original and no later
than the event. This permits a successor key to correct or retract a receipt
signed before a normal key rotation, while the original receipt remains
unchanged. Replacement cycles, duplicate corrections, and any event after a
supersession or retraction are rejected. The event table is append-only; it
never updates an original receipt or an earlier event.

The web application exposes read-only `GET /api/receipts/:id` JSON,
`GET /api/receipts/:id/dependencies` edge JSON,
`GET /api/receipts/:id/verification-bundle` portable evidence JSON, and
`/receipt/:id` display routes when a D1 binding is configured. Each read
re-parses canonical payloads, recomputes hashes, verifies issuer signatures,
and requires the edge projection to exactly match the downstream receipt's
declared dependencies before returning or rendering it. An unknown identifier
returns no receipt. No route can issue or alter evidence.
`GET /api/receipts/:id/lifecycle` and the receipt page also verify each
lifecycle signature and its replacement relationship before showing the
append-only history. `GET /api/receipts` and `/receipts` expose a bounded,
newest-first public index only after each listed receipt and its lifecycle
status have passed the same verification. Issuer-key rotation is represented by
the separate operator key registry, never by mutating a field on this v1
receipt.
