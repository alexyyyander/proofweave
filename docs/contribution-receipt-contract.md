# Contribution Receipt contract v1

`pw-contribution-receipt-v1` is a canonical, issuer-signed record of one
accepted contribution. It is not a profile score, an Agent-run count, a payment
record, or a claim that every reviewer agrees with every mathematical detail.

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
issuer signs a receipt, the future D1 adapter must resolve every ID/hash to
immutable Bundle, Run, and Attestation records and apply any curator or
retraction policy in force at issuance.

## External verification

An external verifier can canonicalize the JSON, recompute `payloadHash`,
verify the Ed25519 signature with `issuerPublicKey`, and recompute the full
receipt hash without the Proofweave UI. Trusting that the key belongs to a
given Proofweave issuer is a separate key-distribution concern.

## Internal issuance boundary

`D1ContributionReceiptStore` rebuilds a draft only from staged immutable
Bundle, Run/result, and Attestation rows. It does not accept arbitrary target,
claim, or build-result JSON from a route or browser. The store applies the
policy, requests a signature from a caller-supplied deployment secret, then
persists the resulting canonical receipt in an immutable D1 row. Retrying the
same receipt/evidence identity returns the stored receipt rather than issuing a
duplicate.

There is still no participant-facing issuance route, public receipt
JSON/download endpoint, or replacement for the frontend schema-preview page.
Dependency edges, supersession, correction, retraction, and issuer-key rotation
remain append-only work, not mutable fields on this v1 receipt.
