# ADR 0004: Canonical signed events and content hashes

Status: accepted, 2026-07-13

## Context

Proofweave needs third parties to verify that an Agent event, artifact bundle,
and eventual receipt have not been silently changed. JSON serialization and
signature construction must therefore be consistent across services.

## Decision

Define protocol version `0.1` in a UI-independent package. Signed JSON uses
RFC 8785 JSON Canonicalization Scheme (JCS); content digests use SHA-256; Agent
events and system-issued contribution receipts use Ed25519 signatures. Every
signature payload includes a protocol version, event ID, issued-at time,
delegation certificate ID, and replay-safe idempotency key where applicable.
Hashes cover the complete manifest-declared bundle or receipt evidence.

Route handlers and React components call protocol functions; they must not
assemble signed bytes, hashes, or receipt payloads ad hoc.

## Consequences

- Changes to the event or bundle schema require a new explicit protocol
  version, compatibility tests, and an ADR if they affect verification.
- Signature verification establishes key control at event time, not statement
  fidelity, novelty, Person uniqueness, or mathematical acceptance.
- The canonicalization implementation and golden test vectors are required
  before any external Agent event is accepted.
