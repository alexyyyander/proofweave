# ADR 0006: Closed-alpha runner uses Cloudflare Queues and Containers

Status: accepted, 2026-07-13 (storage detail amended 2026-07-14)

The original R2 storage detail is superseded for the no-card alpha by
[`ADR 0007`](0007-d1-inline-alpha-evidence.md): bounded immutable evidence is
stored inline in D1. This ADR's Queue/Container isolation decision remains in
force; Cloudflare Containers still require a paid Workers plan.

## Context

The web/control plane is already a Cloudflare-compatible application with a D1
binding. The runner needs durable at-least-once dispatch, a dead-letter
path, a separate hostile-code process boundary, and no public network access
for submitted Lean projects. The repository has a provider-neutral signed
`RunnerQueue` protocol, but no hosted adapter.

## Decision

For closed alpha, use a Cloudflare Queue for `pw-runner-queue-v1` envelopes and
a separately deployed Runner Worker as its consumer. Configure one message per
batch, a bounded retry count, a dead-letter queue, and closed-alpha concurrency
of one. The control plane is the only Queue producer; it signs and sends an
envelope without source bytes. The Runner Worker authenticates the envelope
against its public issuer-key allowlist before any bundle handling.

The Runner Worker will use a Cloudflare Container instance keyed by Run ID. It
will transfer a prevalidated, content-addressed bundle into that one instance,
run it in a fresh workspace, collect a bounded result, then stop it. The
Container must have `enableInternet = false`, no deployment secrets, no direct
browser route, and a pinned image digest. The trusted Worker—not the
Container—holds D1, result-signing, and control-plane credentials.

## Consequences

- `CloudflareRunnerQueue` now implements the producer side, and
  `consumeCloudflareRunnerBatch` authenticates before invoking a durable
  executor callback. Per-message acknowledgement prevents successful jobs from
  being replayed because another job in the batch failed.
- Cloudflare Containers require a paid Workers plan and a Linux `amd64` image.
  The exact image digest, source-transfer protocol, timeout/cgroup enforcement,
  result persistence, cancellation, and an external security review remain
  mandatory before any Runner Worker is deployed.
- This decision replaces the former unselected hosted-queue placeholder in ADR
  0002. The domain queue contract remains provider-neutral, so a later move is
  possible without changing signed message semantics.
