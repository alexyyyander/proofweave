# Proofweave verification store

This D1 adapter owns Person-level review assignments and signed,
review-delegated Agent attestations. It implements the policy in
[`docs/verification-contract.md`](../../docs/verification-contract.md).

The web application exposes a separate owner-scoped closed-alpha queue for
listing an assignee's task metadata and recording immutable accept/decline
events. This adapter never receives browser identity and does not let a
browser submit an Attestation.

It does not replay Lean, expose the full artifact evidence set, or issue a
contribution receipt.
