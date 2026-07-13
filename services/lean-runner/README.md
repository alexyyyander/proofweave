# Proofweave Lean runner

This directory is the deployment boundary for the future isolated Lean
executor. It must run outside Sites and outside the MCP/identity Workers.

The checked-in implementation freezes the request/result protocol in
[`contract.mjs`](contract.mjs). It accepts only content-addressed R2 bundles,
a pinned image digest, `lake env lean` argument arrays, explicit CPU/memory/
disk/output limits, and disabled network. It does not yet contain a container
image, queue consumer, or executable user-code service.

See [the runner contract](../../docs/runner-contract.md) for the non-negotiable
security and evidence boundaries, and [the Run state contract](../../docs/run-state-contract.md)
for queue/start/cancellation result semantics.

`d1-run-store.mjs` persists the control-plane projection plus immutable event
and terminal-result records. It is an internal adapter only: no web route calls
it yet, and it does not execute Lean or authenticate a runner service.
