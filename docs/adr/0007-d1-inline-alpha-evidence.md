# ADR 0007: D1-inline evidence for the no-card alpha

Status: accepted, 2026-07-14

## Context

Cloudflare requires a billing subscription before R2 can be enabled, even when
usage would remain in its free allowance. Proofweave must be usable for a
small, closed alpha without requiring a participant or project owner to add a
payment method.

## Decision

Use D1 as both the relational store and the bounded immutable byte store for
the alpha. `inline_artifact_bytes` is append-only, content-addressed through
the existing `artifact_objects` index, and limited to 1,000,000 bytes per
object. The Remote MCP gateway and Runner Worker require only `DB` plus their
existing Queue/Container bindings; they do not require `ARTIFACTS`.

`pw-artifact-bundle-v3` additionally signs a GitHub repository snapshot
(`repository`, full immutable `commitSha`, and visibility) alongside the same
offline v2 workspace evidence. The Runner uses the submitted D1 workspace and
never clones a repository or receives GitHub credentials. A snapshot is an
Agent-signed provenance reference, not proof that Proofweave has authenticated
to, fetched, or can disclose a private repository.

## Consequences

- Evidence, source patches, manifests, and Runner output must stay below 1 MB
  per stored object during this alpha.
- The D1 limit makes this unsuitable for large source archives, long logs, or
  public scale; those cases need a later R2/object-store migration.
- The storage adapter boundary and content-addressed object keys remain stable,
  so an R2 backend can be restored without changing receipts or Bundle hashes.
- A future GitHub App integration may independently verify access to a commit;
  it is not implied by this decision.
