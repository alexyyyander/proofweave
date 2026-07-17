# Lean runner contract v1

The Lean runner is a hostile-code boundary. The web application and remote MCP
Gateway submit a content-addressed bundle reference; neither executes supplied
Lean code directly.

## Request

`pw-lean-runner-v1` requests include:

- one Attempt and idempotency key;
- R2 bundle key plus bundle and manifest SHA-256 hashes;
- exactly one safe relative `.lean` entry file after the `lake env lean`
  argument array (never a shell string or caller-controlled option);
- a pinned container image digest, Lean toolchain, and Mathlib revision;
- explicit CPU, wall-time, memory, disk, and output limits;
- `network: "disabled"`, a mandatory `sorry` audit, and an explicit axiom allowlist.

The canonical request hash is the idempotency/evidence binding. A worker must
reject traversal keys, shell metacharacters, unpinned images, or a request that
enables network access.

The request's bundle reference must be a valid
[`Artifact Bundle`](artifact-bundle-contract.md) manifest; the runner uses its
hashes rather than an unpinned working tree. Historical v1 Bundles remain
inspectable but cannot be claimed for execution. Only v2 fixes the archive,
patch, final-tree, and Lake-manifest reconstruction rules required before a
Container may receive source bytes.

`PinnedRunnerImageRegistry` is a deployment-owned allowlist that binds each
approved image digest to one exact Lean toolchain and Mathlib revision. The
Runner rejects a digest absent from that registry, or a request that pairs an
otherwise approved digest with a different environment. This closes the gap
between a syntactically pinned image reference and an actually reproducible
toolchain; the configured registry must be independently checked against the
image before deployment.

Before a Container can receive any source bytes, `D1R2RunnerBundleResolver`
re-fetches the canonical manifest from R2, re-hashes it, compares it with the
immutable D1 manifest record, re-verifies the Agent signature, and checks the
request's Attempt, command, Lean environment, Mathlib revision, and policy
against that manifest. It also confirms the source archive, normalized patch,
and Lake manifest are still present in the D1/R2 immutable object index. This
resolver intentionally does not fetch source archives; a later transfer layer
must stream and limit them without trusting a user-provided path or hash.

`RunnerWorkspaceTransfer` is that trusted Worker-side transfer layer. After
preflight has claimed a v2 Run, it sends the private Container a fixed workspace
declaration followed by the signed target declaration, no-`sorry`/allowed-axiom
policy, and three R2 streams in fixed archive/patch/Lake-manifest order. Every
stream carries its expected immutable hash and byte length. The Container holds
no D1, R2, queue, or signing credentials and must make those private ingress
steps idempotent, re-hash every stream, enforce v2 extraction/patch/tree rules,
and reject any mismatch before Lean can run.

`RunnerWorkspaceIngress` is the checked-in Container-side protocol state
machine. It validates the declaration, freezes each role's expected hash and
length, permits exactly `sourceArchive -> sourcePatch -> lakeManifest`, and
refuses finalization until all three observed byte streams match.
`ContainerWorkspaceRuntime` is the corresponding Node/container-process source
implementation: it re-hashes the inbound streams while writing isolated files,
extracts only checksummed regular tar entries under declared limits, accepts
only Git-style no-fuzz patches with safe paths, replaces the root Lake manifest,
and requires the final `pw-tree-v1` hash before exposing the argument-array
command. Its private HTTP adapter matches `RunnerWorkspaceTransfer` and makes
identical retry uploads idempotent. `container-http-server.mjs` now adapts this
Fetch handler to a private Node port with an unprivileged readiness probe,
bounded request timeout, and shutdown cleanup. It refuses to boot the Lean
executor unless the deployment asserts both disabled network access and
externally enforced CPU/memory/disk/process limits. This source still has no
pinned Container image or deployed endpoint.

`ContainerLeanExecutor` is the following source-only process boundary. Given a
finalized workspace and the exact matching Runner request, it runs only the
fixed `lake env lean <entry-file>` process without a shell, bounds combined
stdout/stderr, observes the request wall-time, audits `sorry` tokens, and
recompiles the target with `#print axioms` against the declared allowlist. It
returns unsigned result evidence and output hashes only; the trusted Runner
Worker must persist artifacts and attach the operator-held Ed25519 signature.
The executor refuses to start unless the surrounding image declares that
network isolation and CPU/memory/disk limits are enforced externally.

`RunnerExecutionResultSigner` is the corresponding Worker-side signing gate.
Before an Ed25519 signature is made, it re-hashes the returned stdout/stderr,
rejects extra fields, and binds the unsigned result's Run ID, Attempt ID,
request hash, and manifest hash to the currently active D1 Run. An
artifact-persistence adapter must still save those exact output bytes to R2
before `D1RunStore.recordResult` accepts the signed result; that deployment
adapter is provided by `D1R2RunnerOutputStore`: its stdout/stderr rows are
immutable, separate from Agent-owned Bundles, and bind a content-addressed R2
object before the result store accepts the hash.

`RunnerContainerExecutionClient` is the Worker-side private transport for that
result. It can invoke only `/workspace/execute` for a matching active Run, then
retrieves `stdout` and `stderr` from private Container paths whose hash headers
must agree with the unsigned result. Only after both bytes are read does it
call private `/workspace/complete`, which removes staging and reconstructed
workspace files while retaining bounded in-memory result bytes for idempotent
finalization reads. The response is only input to the signing gate; it is not
accepted by D1 or exposed to a browser directly.

`RunnerExecutionFinalizer` fixes the Worker ordering: load the active Run,
persist output artifacts, sign exact evidence, then call `D1RunStore`. It is a
source-level composition root; a deployed Worker still needs to wire actual
Queue/Container/R2 bindings and its operator signing key.

`createLeanRunnerRequest` derives command, Lean version, Mathlib revision,
policy, and canonical `bundle.json` key from that manifest. The control plane
cannot change those inputs after the manifest hash is fixed, and it rejects an
Artifact Bundle whose Agent signature does not verify. It also rejects v1
Bundles before a Run is persisted or a Queue envelope is signed. Its lifecycle is
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

After authentication, `RunnerJobPreflight` compares the queue request hash,
Attempt, and Bundle hash with the single persisted D1 Run. It resolves the
immutable Bundle and deployment-owned image registry before atomically changing
that Run from `queued` to retryable `preparing`. `RunnerWorkspaceStager` then
transfers the private workspace and advances `preparing -> running` only after
Container finalization. Duplicate, already-running, cancelled, or terminal
deliveries are acknowledged as no-ops rather than starting another Container.
A storage, image, or transfer failure does not make the Run running and must be
retried or sent to the DLQ.

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
`signLeanRunnerResult` creates that detached signature only from unsigned
evidence and a trusted Worker-held Ed25519 private key; the Container never
receives that key.

A runner result is still not statement-fidelity review, novelty review, project
acceptance, or a contribution receipt. Those remain separate attestations.

## Still required before execution

- non-root container image with pinned Lean/Mathlib plus `patch` and zstd
  support, and deployment wiring for the checked-in private HTTP/runtime code;
- provisioned Runner Worker D1/R2/Queue/Container bindings, cancellation
  forwarding, deployment-level cleanup, and signing-key deployment/rotation;
- independently verified no-network enforcement, cgroup limits, cancellation,
  cleanup, and Container lifecycle tests;
- R2 bundle retrieval/upload and signed immutable result manifest;
- production logging, quotas, abuse response, and external security review.
