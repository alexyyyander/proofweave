# ADR 0002: Lean execution is an isolated service

Status: accepted, 2026-07-13

## Context

Lean projects and their build dependencies are untrusted submission material.
The web application is a control plane, not a hostile-code execution sandbox.

## Decision

Run Lean only in a separately deployed containerized runner. Each job receives
a clean workspace, a pinned toolchain/image, a bounded input bundle, and a
signed idempotent request. The control plane signs each queue envelope with a
deployment key; the runner verifies it against an operator-provisioned public
issuer-key allowlist before using the request. Jobs run without network access
and with explicit CPU, memory, disk, wall-time, output, and concurrency limits.
The runner emits a signed result manifest and artifact hashes; it never decides
mathematical acceptance.

## Consequences

- No web route, Worker, or browser process may invoke user-provided Lean code.
- Closed alpha uses Cloudflare Queues plus a separate Cloudflare Container
  boundary; the provider-neutral `RunnerQueue` protocol is retained. See ADR
  0006 for the deployment decision and remaining gates.
- Runner images, fixtures, limits, cancellation, orphan cleanup, and emergency
  shutdown are security-critical work before public execution.
