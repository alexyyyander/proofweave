# ADR 0008: Provider-neutral alpha control plane and Sandbox runner

Status: accepted direction, source adapters complete, deployment pending, 2026-07-14

## Context

The Sites application owns its D1 binding. That database cannot be the
shared authority for separately hosted public MCP, OAuth, queue, and Runner
processes. Cloudflare Queues and Containers also require account capabilities
that are not available to the no-card alpha.

The first alternative considered was managed Postgres. Proofweave already has
26 SQLite migration files (`0000` through `0025`) and 117 prepared-query call sites using D1/SQLite
semantics, including triggers, `INSERT OR IGNORE`, positional placeholders,
BLOB evidence, and atomic batches. Rewriting that layer before the first live
alpha would add risk without changing any signed research protocol.

## Decision

Keep the Sites frontend and its current Person-scoped D1 data intact. Public
read access to the frontend does not turn that database into a shared external
control plane. Build the separate participant control plane around
provider-neutral boundaries:

1. Use remote libSQL/Turso as the first shared control-plane database. The
   `LibsqlD1Database` adapter implements only the D1 surface Proofweave uses:
   `prepare`, `bind`, `first`, `all`, `run`, `raw`, and atomic `batch`.
2. Apply the existing migrations unchanged to the new database, including the
   one-megabyte D1-inline evidence boundary from migration `0025`. Do not copy
   existing Sites records implicitly.
3. Keep every signature, canonical hash, Artifact Bundle, Runner request,
   review attestation, and Contribution Receipt format provider-neutral.
4. Use a Modal Sandbox adapter behind the existing private Container `fetch`
   contract. One fresh Sandbox is bound to one Run, starts only from a pinned
   image digest, blocks outbound network access, and receives no database,
   queue, OAuth, control-plane, or result-signing credential.
5. Keep the short-lived Modal Connect Token only in the trusted runner process.
   It is never forwarded to submitted code, stored as evidence, or signed into
   a Receipt.
6. Retain the Cloudflare adapters as an optional future deployment target.
   Choosing libSQL and Modal for the alpha does not change the domain ports.

The target hosted shape is:

```text
Sites frontend
      |
      v
public HTTPS MCP + OAuth service
      |
      +-- remote libSQL control-plane database
      |
      +-- durable Runner queue/lease adapter (not yet implemented)
                  |
                  v
            Modal Sandbox
                  |
                  v
         no-egress pinned Lean image
```

## Deployment gates

The new source adapters are not a live service. Production remains disabled
until all of the following are satisfied:

- an independently created remote database receives the reviewed migrations;
- the public MCP and OAuth HTTPS process has participant identity, recovery,
  revocation, rate limiting, and structured audit operations;
- a durable queue or lease store preserves at-least-once delivery and
  idempotent Run claiming;
- the Modal app and pinned image digest are reviewed;
- Modal's CPU, memory, timeout, disk, and process isolation are documented and
  accepted for this image before
  `PROOFWEAVE_MODAL_RESOURCE_POLICY_REVIEWED=true` is set;
- the result-signing key remains outside the Sandbox and its public key is
  enrolled in the Runner-key registry;
- cancellation, retry, output truncation, Sandbox termination, and incident
  response are exercised against a real hosted fixture; and
- the public UI continues to call all Agent-reported work provisional until a
  signed Runner result, independent review, and Receipt actually exist.

## Consequences

- The database migration is much smaller than a Postgres rewrite and remains
  reversible at the adapter boundary.
- A future Postgres implementation remains possible, but it is no longer a
  prerequisite for the first participant demo.
- Sites D1 and the external control plane must not become two writable sources
  of truth. Participant writes move only after an explicit cutover plan.
- No account, token, remote database, Modal app, or public endpoint is created
  by committing these adapters.
