# Proofweave Lean runner

This directory is the deployment boundary for the future isolated Lean
executor. It must run outside Sites and outside the MCP/identity Workers.

`RUNNER_EXECUTION_ENABLED` is a deployment-owned emergency gate. It defaults
to disabled in the Wrangler template and must be exactly `true` before the
Worker can read a Queue delivery, resolve a Bundle, or start a Container.

The checked-in implementation freezes the request/result protocol in
[`contract.mjs`](contract.mjs). It accepts only content-addressed R2 bundles,
a pinned image digest, `lake env lean` argument arrays, explicit CPU/memory/
disk/output limits, and disabled network. [`queue.mjs`](queue.mjs) defines the
provider-neutral `RunnerQueue` delivery contract and includes a deterministic
in-memory reference adapter for tests. Queue envelopes are Ed25519-signed by a
control-plane deployment key, and the runner-side authenticator accepts only
operator-provisioned public issuer keys. It does not yet contain an approved
container image or deployed Worker. It does contain a source-only,
digest-required Docker assembly recipe in [`Dockerfile`](Dockerfile); without
an independently inspected base image and a recorded final digest, it cannot
become a Runner image. The build and inspection contract is in
[`docs/runner-container-image.md`](../../docs/runner-container-image.md). It
also contains a source-level Cloudflare Queue consumer in
[`cloudflare-worker.mjs`](cloudflare-worker.mjs): it composes authenticated
preflight, exact named-Container transfer, private execution, immutable output
persistence, Worker-held signing, and D1 result recording. The core
[`worker.mjs`](worker.mjs) remains platform-import-free for Node tests; the
thin Cloudflare entrypoint exports the Container Durable Object class. It is
not a live Runner Worker. This directory also contains source-only R2 transfer, private
Node HTTP ingress, and fixed Lean execution code; those paths cannot start
until an isolated deployment explicitly supplies the required resource limits.

[`orchestrator.mjs`](orchestrator.mjs) is the control-plane handoff: it creates
the immutable D1 Run projection before delivering the signed queue envelope.
If a queue provider fails, a retry with the same Attempt/idempotency key reuses
the recorded Run rather than creating a second execution identity. It still
does not invoke Lean, download source, or expose an HTTP route.

See [the runner contract](../../docs/runner-contract.md) for the non-negotiable
security and evidence boundaries, and [the Run state contract](../../docs/run-state-contract.md)
for queue/start/cancellation result semantics.

For the no-card hosted alpha,
[`e2b-sandbox-container.mjs`](e2b-sandbox-container.mjs) creates one secure,
private, no-egress E2B Sandbox per Run behind the same Container `fetch`
contract. A protected GitHub Actions workflow invokes the trusted process once,
while all Turso, E2B, control-plane, and result-signing credentials stay outside
submitted Lean. Provider selection is explicit; the existing Modal adapter is
retained as an optional deployment target.

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
is the deployment-side Container class with Internet disabled, a private
port/readiness probe, and one-Run path binding; it starts the checked-in Node
process only in a future pinned image. `d1-r2-runner-bundle-resolver.mjs` rechecks the
immutable D1/R2 Bundle before source transfer, `runner-job-preflight.mjs`
claims exactly one persisted queued Run after that check, and
`runner-image-policy.mjs` binds an approved image digest to exact Lean/Mathlib
versions. Only `pw-artifact-bundle-v2` can be claimed for execution: it fixes
safe archive extraction, patch application, Lake manifest replacement, and the
final workspace-tree hash. `runner-workspace-transfer.mjs` now provides the
trusted Worker-side fixed-order R2 stream handoff that a future private
Container ingress will verify before execution.
`container-workspace-ingress.mjs` provides the matching state machine for that
image service: every expected hash/length is frozen before bytes arrive, and
the archive, patch, and Lake manifest must be verified in order.
`container-workspace-runtime.mjs` is the source-only Node process for that
private ingress: it re-hashes streams, safely reconstructs the v2 workspace,
and verifies its final tree before Lean can start.
`container-http-server.mjs` now starts that private handler on the Container
port, rejects broad listeners, exposes only `/ready` outside the private API,
and fails closed without external isolation assertions.
`container-lean-executor.mjs` is the next source-only boundary: under an
explicitly network-isolated and resource-limited image, it runs the fixed Lean
command, performs `sorry` and target-axiom audits, and returns unsigned output
evidence for the Worker—not a signing key or receipt claim.
`runner-execution-result-signer.mjs` is the Worker-side counterpart: it
re-hashes that output, binds it to the active Run, and applies the
operator-held signature before the existing D1 result store can accept it.
`runner-container-execution-client.mjs` invokes the private execution endpoint
and retrieves its hash-bound output; it remains behind the Worker/Container
boundary and never becomes a browser API.
`d1-r2-runner-output-store.mjs` stores those exact bytes as immutable R2/D1
evidence before `runner-execution-finalizer.mjs` signs and records the result.
Deployment of this source-only Container route and provisioned Worker/R2
bindings remains work. `RUNNER_RESULT_PRIVATE_KEY_JWK` must be provisioned as a
Worker secret; the Container never receives it.
`runner-workspace-stager.mjs` connects authenticated preflight, private
workspace transfer, and the D1 `preparing -> running` transition so an
interrupted transfer is retryable rather than a stuck running Run.
The selected hosting boundary, non-deployable config template, and remaining
gates are documented in
[`docs/runner-cloudflare-deployment.md`](../../docs/runner-cloudflare-deployment.md).
