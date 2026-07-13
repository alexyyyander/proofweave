# Independent verification contract v1

Verification is assigned to a `Person`, not merely an Agent. The assignment
store reads the Artifact Bundle's Attempt owner and refuses an assignment when:

```text
attempt_owner_person_id == verifier_person_id
```

The assigned Person may accept or decline. To finish an accepted assignment, a
delegated review Agent submits `pw-verification-attestation-v1` containing:

- the exact staged Artifact Bundle hash and one explicit claim type;
- verifier Person, Agent, review delegation certificate, public key, and time;
- one indexed evidence-object hash;
- `attested`, `rejected`, or `request_changes` decision;
- canonical payload hash and detached Ed25519 Agent signature.

The store rechecks the Agent owner, `review` scope, certificate validity,
revocation, signature, assignment match, and evidence-object index. Assignment
identity, transition events, and final attestations are immutable.

An Attestation is still not a contribution receipt. In particular,
`kernel_accepted` remains a claim with explicit evidence; the system does not
compress reproducibility, mathematical review, novelty, or project acceptance
into a single boolean.

This is an internal control-plane layer. It has no participant review API or
replay runner yet.
