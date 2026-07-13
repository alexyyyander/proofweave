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

## Closed-alpha review queue

`/reviews` and `/api/me/review-assignments` provide an owner-scoped
closed-alpha queue. A signed-in Person can see only assignments addressed to
that Person, inspect the target metadata and immutable event history, and
append one `accepted` or `declined` transition while the assignment is still
pending. Repeating the same transition is idempotent; a conflicting later
transition is rejected. The response deliberately omits the Attempt owner's
identity and any private Agent material.

The queue is not a browser attestation form. A browser cannot create an Agent
signature, replay a Lean bundle, or turn acceptance into a mathematical claim.
An accepted assignment still needs a separately held Agent key under a valid
`review` delegation to submit the exact signed attestation described above.
Fresh runner replay remains unavailable. The checked-in remote MCP adapter now
supports a `verification:write` submission path, but it is not deployed for
participants until the independent identity and gateway-control-plane rollout
gates are complete.

## Controlled evidence inspection

`/evidence` lists only Bundles where the signed-in Person is either the
recorded Attempt owner or the assignee of an independent verification task.
Each record is addressed by its immutable Bundle manifest hash. The detail
page and `GET /api/me/evidence/bundles/:manifestHash` expose the canonical
Bundle manifest, its indexed source archive/patch/Lake-manifest metadata, and
stored Run/result metadata. An assigned reviewer sees the submitting Agent
label needed to inspect the work but never the Attempt owner's Person identity
or display name.

`GET /api/me/evidence/bundles/:manifestHash/artifacts/:artifactId` returns a
download only after the same access test succeeds and the private R2 object's
stored size and `sha256` metadata match the immutable D1 index. Responses are
`private, no-store` attachments with `nosniff`; R2 object keys are never
returned in the JSON view. Supported artifact identifiers are the signed Bundle
manifest, source archive, normalized patch, Lake manifest, and any persisted
Runner stdout/stderr object for that Bundle's Runs.

Inspection and download are deliberately not replay: they do not execute Lean,
update a Run, create an attestation, or make a verification claim.

## Remote Agent attestation submission

The remote MCP tool `submit_verification_attestation` accepts one complete
`pw-verification-attestation-v1` from the Agent that holds the private review
key. It requires the OAuth `verification:write` scope. Before the immutable
verification store sees the object, the gateway's D1 adapter requires the
OAuth-selected installation to be active and review-scoped, binds the
Attestation's Person, Agent, certificate, and public key to that installation,
and confirms the assignment is addressed to that Person. The verification store
then performs its existing exact assignment, independence, evidence-hash,
time-window, revocation, payload-hash, and Ed25519 checks.

The MCP access token is never passed into that D1 adapter, and an attestation
cannot be used to mint a contribution receipt. This source-level pathway still
requires a deployed independent identity/consent provider and gateway before it
is participant-accessible.
