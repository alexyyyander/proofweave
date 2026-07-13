# ADR 0002: Lean execution is an isolated service

Status: accepted, 2026-07-13

## Context

Lean projects and their build dependencies are untrusted submission material.
The web application is a control plane, not a hostile-code execution sandbox.

## Decision

Run Lean only in a separately deployed containerized runner. Each job receives
a clean workspace, a pinned toolchain/image, a bounded input bundle, and a
signed idempotent request. Jobs run without network access and with explicit
CPU, memory, disk, wall-time, output, and concurrency limits. The runner emits
a signed result manifest and artifact hashes; it never decides mathematical
acceptance.

## Consequences

- No web route, Worker, or browser process may invoke user-provided Lean code.
- The queue/provider choice remains a Sprint 3 decision behind a
  `RunnerQueue` interface.
- Runner images, fixtures, limits, cancellation, orphan cleanup, and emergency
  shutdown are security-critical work before public execution.
