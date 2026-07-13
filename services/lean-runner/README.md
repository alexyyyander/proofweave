# Proofweave Lean runner

This directory is the deployment boundary for the future isolated Lean
executor. It must run outside Sites and outside the MCP/identity Workers.

The checked-in implementation freezes the request/result protocol in
[`contract.mjs`](contract.mjs). It accepts only content-addressed R2 bundles,
a pinned image digest, `lake env lean` argument arrays, explicit CPU/memory/
disk/output limits, and disabled network. [`queue.mjs`](queue.mjs) defines the
provider-neutral `RunnerQueue` delivery contract and includes a deterministic
in-memory reference adapter for tests. Queue envelopes are Ed25519-signed by a
control-plane deployment key, and the runner-side authenticator accepts only
operator-provisioned public issuer keys. It does not yet contain a container
image, deployed Worker, source-transfer implementation, or executable
user-code service.

[`orchestrator.mjs`](orchestrator.mjs) is the control-plane handoff: it creates
the immutable D1 Run projection before delivering the signed queue envelope.
If a queue provider fails, a retry with the same Attempt/idempotency key reuses
the recorded Run rather than creating a second execution identity. It still
does not invoke Lean, download source, or expose an HTTP route.

See [the runner contract](../../docs/runner-contract.md) for the non-negotiable
security and evidence boundaries, and [the Run state contract](../../docs/run-state-contract.md)
for queue/start/cancellation result semantics.

The checked-in [Lean fixtures](../../tests/fixtures/lean/README.md) validate
success, compiler-error, and mandatory-`sorry`-audit cases with local Lean.
They are not an isolated runner and are intentionally outside the normal CI
check because a production CI image does not install Lean implicitly.

The internal [artifact store](../../docs/artifact-storage-contract.md) must
stage and hash a bundle before this boundary can derive a runner request.

`d1-run-store.mjs` persists the control-plane projection plus immutable event
and terminal-result records. It verifies each result against an active,
operator-provisioned `runner_keys` entry. It is an internal adapter only: no
web route calls it yet, and it does not execute Lean or authenticate a runner
service.

For the closed-alpha hosting target, [`cloudflare-queues.mjs`](cloudflare-queues.mjs)
implements a Cloudflare Queue producer plus authenticated per-message consumer
handling. [`cloudflare-runner-container.mjs`](cloudflare-runner-container.mjs)
is the deployment-side Container class with Internet disabled; it is not an
execution implementation. `d1-r2-runner-bundle-resolver.mjs` rechecks the
immutable D1/R2 Bundle before source transfer, `runner-job-preflight.mjs`
claims exactly one persisted queued Run after that check, and
`runner-image-policy.mjs` binds an approved image digest to exact Lean/Mathlib
versions. The selected hosting boundary, non-deployable config template, and
remaining gates are documented in
[`docs/runner-cloudflare-deployment.md`](../../docs/runner-cloudflare-deployment.md).
