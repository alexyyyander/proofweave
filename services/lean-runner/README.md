# Proofweave Lean runner

This directory is the deployment boundary for the future isolated Lean
executor. It must run outside Sites and outside the MCP/identity Workers.

The checked-in implementation freezes the request/result protocol in
[`contract.mjs`](contract.mjs). It accepts only content-addressed R2 bundles,
a pinned image digest, `lake env lean` argument arrays, explicit CPU/memory/
disk/output limits, and disabled network. [`queue.mjs`](queue.mjs) defines the
provider-neutral `RunnerQueue` delivery contract and includes a deterministic
in-memory reference adapter for tests. It does not yet contain a container
image, hosted queue adapter, queue consumer, or executable user-code service.

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
