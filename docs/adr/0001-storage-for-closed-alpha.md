# ADR 0001: Closed-alpha storage boundary

Status: superseded by [ADR 0007](0007-d1-inline-alpha-evidence.md), 2026-07-14

## Context

Proofweave needs relational state for people, delegations, attempts,
attestations, receipts, and append-only audit events. It also needs immutable
storage for source bundles, logs, manifests, and hashes. The public frontend is
already deployed as a Cloudflare-compatible web application.

## Decision

Use Cloudflare D1 for closed-alpha relational metadata and R2 for immutable
artifact objects. Access both only through repository and artifact-store
interfaces; routes and React components must not use database clients directly.
Artifact keys are content addressed and immutable after a successful write.

## Consequences

- D1 makes the first control-plane deployment small and operationally simple.
- R2 keeps potentially large build logs and source bundles out of relational
  rows and supports reproducibility by hash.
- A later move to PostgreSQL or another object store is possible without
  changing domain or route contracts.
- Database migrations, backup/export, retention, and object lifecycle policies
  become explicit delivery work before closed-alpha hardening.
