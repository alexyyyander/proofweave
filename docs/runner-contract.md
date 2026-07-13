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
- isolated queue and signed job authentication;
- no-network enforcement, archive limits, cgroup limits, cancellation, cleanup;
- R2 bundle retrieval/upload and signed immutable result manifest;
- production logging, quotas, abuse response, and external security review.
