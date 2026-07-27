# Cloudflare Runner deployment boundary (non-current reference)

> **Not the active alpha topology.** Current release evidence comes from the
> Sites-integrated Turso gateway and the Render/E2B Runner described in
> `runner-provider-neutral-deployment.md`. This Cloudflare D1/Queue/Container
> path is retained for a future separately reviewed provider activation.

This document describes the selected closed-alpha hosting target. There is no
approved Lean Runner image, image digest, live Queue, or Runner Worker yet.
The repository therefore provides a non-secret deployment preflight, not a
permission to deploy: it renders a configuration with execution disabled and
cannot supply a result-signing secret. The source-level Worker remains
deliberately non-deployable until every gate below is complete. Do not deploy
`services/lean-runner/wrangler.example.jsonc` as-is.

**Storage update (2026-07-14).** The no-card alpha uses immutable D1-inline
evidence, capped at 1 MB per object, as specified in
[`ADR 0007`](adr/0007-d1-inline-alpha-evidence.md). References to R2 below
describe the retained scale-up adapter and are not a requirement for this
alpha. This change does not make the Runner deployable: Cloudflare Containers
still require a paid Workers plan and the image, Queue, key, and security gates
in this document remain unmet.

Before any Wrangler command, copy
`services/lean-runner/deployment-manifest.example.json` outside the repository,
replace every value with provisioned resources, and run:

```bash
npm run runner:deploy:preflight -- /secure/path/proofweave-runner-alpha.json
```

The preflight rejects placeholders, mutable images, mismatched Queue/DLQ
topology, non-singleton concurrency, unsafe queue batching, invalid public
issuer keys, and unpinned Lean/Mathlib image metadata. It emits only
non-secret Worker configuration, always with `RUNNER_EXECUTION_ENABLED=false`.
The full activation and rollback sequence is in
[`runner-deployment-preflight.md`](runner-deployment-preflight.md).

## Selected topology

```text
Control-plane Worker
  -- signed pw-runner-queue-v1 --> Cloudflare Queue
                                      |
                                      v
                             Runner Worker consumer
                              | verifies issuer signature
                              | reads prevalidated D1-inline bundle
                              v
                       one Container instance per Run
                        - fresh workspace
                        - no public internet
                        - no credentials
                              |
                              v
                    signed result -> D1-inline control evidence
```

Cloudflare Queues provide a Worker producer/consumer binding, individual
acknowledgements, retry delays, and a dead-letter queue. The production adapter
uses the Queue binding's durable `send()` acknowledgement and explicitly
acknowledges only an executor callback that has completed result persistence.
Before Lean begins, the worker records the Run as retryable `preparing`, streams
the verified v2 workspace to the private Container, and only then records
`running`. An interrupted workspace transfer is therefore retried by Queue
delivery rather than being mistaken for a running computation.

Cloudflare Containers are suitable for the second boundary because their
outbound Internet access can be disabled with `enableInternet = false`; no
exception host is allowed for a Lean job. The selected closed-alpha sizing is
one `standard-1` Container maximum. It is a capacity cap, not a substitute for
per-Run wall-time, output, archive, axiom, or cleanup enforcement.

## Required gates before deployment

1. Build and independently inspect a Linux `amd64` Lean image using the
   digest-required, offline final-assembly recipe in
   [`runner-container-image.md`](runner-container-image.md), then record its
   immutable `@sha256:` digest and the exact bundled Lean/Mathlib revisions in
   the Runner image registry. Each request must match that registry. The
   checked-in recipe is not an approved image and supplies no digest.
2. Build and inspect an image that starts the checked-in private
   `container-http-server.mjs` process and connect it to the Runner Worker. The
   source now provides clean workspace creation, verified no-link extraction,
   no-fuzz patch/final-tree reconstruction, process timeout, Lean invocation,
   and a post-output workspace cleanup acknowledgement. It fails closed until
   the deployment has proved no egress plus CPU/memory/disk/process limits.
   The checked-in Worker source wires authenticated Queue consumption,
   D1 preflight, exact named-Container staging, private execution, immutable
   stdout/stderr immutable evidence persistence, Worker-held result signing, and D1 result
   recording. It also polls the durable `cancel_requested` projection while an
   execution is in flight and forwards that request to the same private
   Container, which aborts Lean and returns normal cancellation evidence.
   It emits only one privacy-minimal aggregate structured audit event per Queue
   batch (delivery/acknowledgement/retry totals and duration); it never logs a
   Run ID, signed envelope, Agent, Bundle, token, source, or output. This
   source-level console instrumentation needs deployed retention and alerting
   before it can count as production observability.
   Non-production lifecycle testing of that delivery path remains a deployment
   gate. Source-only runtime tests are not a deployed Container service.
3. Provision the Queue, DLQ, D1 binding, control-plane signing secret, and
   Runner public issuer-key allowlist. Before any result can be accepted, use
   `runner:deploy:key-enrollment` with the reviewed Runner manifest and apply
   its collision-checked, parameterized D1 `runner_keys` plan through the
   audited operator channel. The Container receives none of these secrets.
4. Keep `RUNNER_EXECUTION_ENABLED` set to `false` until the non-production
   exercises have passed. The Runner Worker fails closed before it reads a
   Bundle, stages a workspace, or starts a Container unless that deployment
   variable is exactly `true`. For an emergency stop, set it back to `false`
   and disable the Queue consumer; investigate and reconcile the retained
   Queue backlog before re-enabling it.
5. Exercise duplicate delivery, process timeout, Container termination,
   cancellation, Queue retry/DLQ, output-limit, and no-network tests in a
   non-production account. Then obtain an external security review.

Cloudflare's deployment workflow builds a Container image with Docker. Docker
is not installed in this workspace, so this repository has not built or run a
Container image locally.

## Source Worker configuration

`worker.mjs` is the testable queue orchestration core. The deployment entry
`cloudflare-worker.mjs` additionally exports `LeanRunnerContainer`, so the
Durable Object class is available to Wrangler. It exposes no public execution
route: its `fetch` handler always returns `404`; only the Queue consumer can
reach a named Container instance.

Before copying the template, provision the following Worker values. The two
JSON settings are non-secret deployment configuration; their constructors reject
unknown or malformed entries. Set the result private key as a Worker secret,
not in `wrangler.jsonc` or source control.

| Value | Purpose |
| --- | --- |
| `RUNNER_EXECUTION_ENABLED` | Explicit deployment kill switch. It must be exactly `true` before any Queue delivery can reach a Container; keep it `false` until the deployment gates pass. |
| `RUNNER_APPROVED_IMAGES_JSON` | Array of immutable image digest, Lean toolchain, and Mathlib revision entries accepted by `PinnedRunnerImageRegistry`. |
| `RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON` | Array of active public Ed25519 keys allowed to sign `pw-runner-queue-v1` messages. |
| `RUNNER_RESULT_KEY_ID` | Active D1-allowlisted Runner result-signing key ID. |
| `RUNNER_RESULT_PRIVATE_KEY_JWK` | Secret Ed25519 private JWK held only by the Worker. |
| `RUNNER_RETRY_DELAY_SECONDS` | Optional retry delay, 1–86,400 seconds; defaults to 30. |

Each delivery is authenticated before preflight. If a retry sees a Run already
in `running`, the Worker resumes only its private execution/finalization phase
against the same named Container; terminal and cancellation-requested Runs are
not restarted. For an execution already in flight, the Worker polls its D1 Run
projection and forwards a durable cancellation to that named Container only;
the Container has no public cancellation endpoint. A deployed non-production
test of cancellation delivery and process termination remains mandatory before
participant execution.

The default Worker wraps Queue batches in the shared structured-audit boundary.
The resulting event intentionally contains only `delivered`, `acknowledged`,
`retried`, duration, and outcome. It is suitable for a platform console and
correlation with deployment logs, but must not be treated as an evidence record
or as production observability until retention, access control, alerting, and
an incident procedure are provisioned.
