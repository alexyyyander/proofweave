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
- `attested`, `rejected`, `request_changes`, `conflict_declared`, or
  `integrity_flagged` decision;
- canonical payload hash and detached Ed25519 Agent signature.

The store rechecks the Agent owner, `review` scope, certificate validity,
revocation, signature, assignment match, and evidence-object index. Assignment
identity, transition events, and final attestations are immutable.

An Attestation is still not a contribution receipt. In particular,
`kernel_accepted` remains a claim with explicit evidence; the system does not
compress reproducibility, mathematical review, novelty, or project acceptance
into a single boolean.

## Fresh reviewer replay

An accepted review assignment can now authorize a separate
`pw-verification-replay-v1` record through the remote MCP control plane. The
review Agent calls `request_verification_replay` under the OAuth
`verification:replay` scope, with the assignment ID and an idempotency key.
The gateway requires the assignment to be addressed to the OAuth Person and
currently `accepted`, the selected installation to have an active `review`
delegation, and the assignment's immutable Bundle to resolve to the original
Attempt and its pinned executable v2 environment.

The replay record immutably binds the assignment, reviewer
Person/Agent/certificate/installation, Bundle hash, idempotency key, and a new
Run. That Run uses the original Bundle but a new deterministic identity, so the
Runner creates a new isolated workspace. It does not grant the review Agent
`run:request`, `run:read`, or `run:cancel` on the submitting Agent's Attempt.
When the trusted Runner records a terminal result, it first materializes a
content-addressed `pw-verification-replay-evidence-v1` object containing the
exact signed Runner result, replay identity, assignment, Bundle hash, and
result hash. `get_verification_replay` is limited to the same review Agent
installation and returns its replay Run projection, immutable event hashes,
and this evidence hash only after the matching terminal result exists. A replay
result is infrastructure evidence, not an attestation or a receipt; the
reviewer must still make one separately signed explicit claim.

For a positive `attested` `bundle_reproducible` decision, that separation has
one additional guard: its Attestation evidence hash must be this terminal
replay evidence for the same assignment, Person, Agent, and review certificate.
An arbitrary indexed note, the submitter's ordinary Run, or a different review
Agent's replay cannot satisfy the claim. A `conflict_declared` or
`integrity_flagged` decision may instead cite its own indexed evidence so it
can be recorded before a replay starts; it still cannot satisfy the claim.
Other claim types continue to carry their own explicit evidence and are not
silently inferred from a successful replay.

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
The completed assignment exposes its exact immutable decision: `attested`,
`rejected`, `request_changes`, `conflict_declared`, or `integrity_flagged`.
Only `attested` can satisfy a receipt gate. Rejection, requested changes,
declared conflict, and integrity flags close the assignment for capacity
purposes without becoming positive verification. A conflict declaration means
the assignment needs another Person; an integrity flag preserves a signed,
evidence-linked concern for curator follow-up but is neither a mathematical
conclusion nor an automatic retraction. The Attempt owner can inspect only the
terminal decision, claim type, and evidence hash on their controlled evidence
record; the reviewer identity and fresh replay artifacts remain private. The
queue shows the assignment ID and count of recorded
fresh replays so a review Agent can start the assignment-bound replay through
the separately deployed remote connection. Once it reaches a terminal result,
the Agent receives the exact replay evidence hash it must use when preparing a
`bundle_reproducible` claim. The checked-in remote MCP adapter
now supports both `verification:replay` and `verification:write`, but neither
is deployed for participants until the independent identity and
gateway-control-plane rollout gates are complete.

## Controlled evidence inspection

`/evidence` lists only Bundles where the signed-in Person is either the
recorded Attempt owner or the assignee of an independent verification task.
Each record is addressed by its immutable Bundle manifest hash. The detail
page and `GET /api/me/evidence/bundles/:manifestHash` expose the canonical
Bundle manifest, its indexed source archive/patch/Lake-manifest metadata, and
stored Run/result metadata. The review surface projects the declared target,
pinned Lean/Mathlib environment, command, `sorry`/axiom policy, and valid
signed Runner build/kernel checks before exposing the canonical payloads. Its
normalized source patch can be fetched through the same private artifact route
for an escaped, 1 MiB-bounded in-page preview or downloaded unchanged. An
assigned reviewer sees the submitting Agent
label needed to inspect the work but never the Attempt owner's Person identity
or display name. A terminal fresh replay evidence closure is additionally
visible and downloadable only to the Person whose review Agent created that
replay; it includes the exact replay/assignment identity and signed Runner
result needed to prepare `bundle_reproducible`. It is not exposed to the
Attempt owner or to other reviewers before a separate attestation makes an
explicit claim.

`GET /api/me/evidence/bundles/:manifestHash/artifacts/:artifactId` returns a
download only after the same access test succeeds and the private R2 object's
stored size and `sha256` metadata match the immutable D1 index. Responses are
`private, no-store` attachments with `nosniff`; R2 object keys are never
returned in the JSON view. Supported artifact identifiers are the signed Bundle
manifest, source archive, normalized patch, Lake manifest, any persisted
Runner stdout/stderr object for that Bundle's Runs, and the caller's own
terminal fresh-replay evidence closure.

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

The MCP access token is never passed into that D1 adapter. A submitted
attestation cannot specify or mint a Receipt directly. After the signed claim
is durable, an operator-configured coordinator may independently re-read the
Bundle, primary accepted Runner result, all required different-owner claims,
attribution, and issuer registry. It deterministically issues a Receipt only
when the complete policy is satisfied; missing or rejected gates remain
visible and the review record is never rolled back. This source-level pathway
still requires a deployed independent identity/consent provider and gateway
before it is participant-accessible.
