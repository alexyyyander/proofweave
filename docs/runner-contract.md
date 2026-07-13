# Lean runner contract v1

The Lean runner is a hostile-code boundary. The web application and remote MCP
Gateway submit a content-addressed bundle reference; neither executes supplied
Lean code directly.

## Request

`pw-lean-runner-v1` requests include:

- one Attempt and idempotency key;
- R2 bundle key plus bundle and manifest SHA-256 hashes;
- an argument-array entrypoint beginning `lake env lean` (never a shell string);
- a pinned container image digest, Lean toolchain, and Mathlib revision;
- explicit CPU, wall-time, memory, disk, and output limits;
- `network: "disabled"`, a mandatory `sorry` audit, and an explicit axiom allowlist.

The canonical request hash is the idempotency/evidence binding. A worker must
reject traversal keys, shell metacharacters, unpinned images, or a request that
enables network access.

The request's bundle reference must be a valid
[`pw-artifact-bundle-v1`](artifact-bundle-contract.md) manifest; the runner
uses its hashes rather than an unpinned working tree.

`createLeanRunnerRequest` derives command, Lean version, Mathlib revision,
policy, and canonical `bundle.json` key from that manifest. The control plane
cannot change those inputs after the manifest hash is fixed, and it rejects an
Artifact Bundle whose Agent signature does not verify. Its lifecycle is
separately constrained by the [`Run state contract`](run-state-contract.md).

## Queue delivery

`pw-runner-queue-v1` is the provider-neutral envelope between the control
plane and a separately hosted runner. Its payload contains the immutable
`pw-lean-runner-v1` request plus a re-derived request hash, a run ID equal to
the request job ID, enqueue time, control-plane key ID, and detached Ed25519
signature. It contains no source bytes, credentials, or shell string. The
signature covers every other envelope field. A runner accepts a job only after
the key ID resolves to its operator-provisioned issuer allowlist and that
signature verifies.

The matching private key is a control-plane deployment secret, never a D1
value, Artifact Bundle field, queue message field, browser value, or repository
file. Runner deployments receive only public issuer keys. Queue adapters must
use at-least-once delivery; the runner and control plane use the request
hash/idempotency key to make duplicate delivery safe.

The reference in-memory adapter only tests delivery semantics. It does not
provide durability, network isolation, or Lean execution. Closed alpha selects
Cloudflare Queues for the hosted transport: `CloudflareRunnerQueue` uses a
trusted producer binding, and `consumeCloudflareRunnerBatch` authenticates
each envelope before a durable executor callback can see it. The Queue/DLQ and
Container boundary are described in
[`docs/runner-cloudflare-deployment.md`](runner-cloudflare-deployment.md).

`RunnerOrchestrator` records the immutable Run projection before queue
delivery. A transient queue-provider failure therefore leaves a queued Run that
can be retried with the same Attempt/idempotency key; it never creates a second
execution identity. This control-plane handoff is internal-only and does not
make an HTTP execution API available.

## Result

Results record bounded infrastructure evidence only: outcome, exit code, timing,
network/no-`sorry`/axiom/build checks, kernel status, and content hashes for the
manifest, stdout, and stderr. Each result names an operator-provisioned runner
key and carries an Ed25519 detached signature over all of that evidence. The D1
Run store accepts it only when that key is active in its allowlist. A `succeeded`
result requires zero exit code, accepted kernel status, and every check passed.

A runner result is still not statement-fidelity review, novelty review, project
acceptance, or a contribution receipt. Those remain separate attestations.

## Still required before execution

- non-root container image with pinned Lean and Mathlib;
- verified Runner Worker bundle transfer, result persistence, cancellation,
  cleanup, and signing-key deployment/rotation;
- no-network enforcement, archive limits, cgroup limits, cancellation, cleanup;
- R2 bundle retrieval/upload and signed immutable result manifest;
- production logging, quotas, abuse response, and external security review.
