# Cloudflare Runner deployment boundary

This document describes the selected closed-alpha hosting target. It is not a
deployment runbook yet: this repository has no approved Lean Runner image,
no image digest, no live Queue, and no Runner Worker that executes user code.
Do not deploy `services/lean-runner/wrangler.example.jsonc` as-is.

## Selected topology

```text
Control-plane Worker
  -- signed pw-runner-queue-v1 --> Cloudflare Queue
                                      |
                                      v
                             Runner Worker consumer
                              | verifies issuer signature
                              | reads prevalidated R2 bundle
                              v
                       one Container instance per Run
                        - fresh workspace
                        - no public internet
                        - no credentials
                              |
                              v
                    signed result -> R2/D1 control evidence
```

Cloudflare Queues provide a Worker producer/consumer binding, individual
acknowledgements, retry delays, and a dead-letter queue. The production adapter
uses the Queue binding's durable `send()` acknowledgement and explicitly
acknowledges only an executor callback that has completed result persistence.

Cloudflare Containers are suitable for the second boundary because their
outbound Internet access can be disabled with `enableInternet = false`; no
exception host is allowed for a Lean job. The selected closed-alpha sizing is
one `standard-1` Container maximum. It is a capacity cap, not a substitute for
per-Run wall-time, output, archive, axiom, or cleanup enforcement.

## Required gates before deployment

1. Build and independently inspect a Linux `amd64` Lean image, then record its
   immutable `@sha256:` digest and the exact bundled Lean/Mathlib revisions in
   the Runner image registry. Each request must match that registry.
2. Complete the Runner Worker after its verified D1/R2 bundle resolution:
   streaming source transfer, clean workspace creation, explicit process
   timeout/resource controls, result signing, D1 result persistence,
   cancellation, and deterministic cleanup.
3. Provision the Queue, DLQ, D1/R2 bindings, control-plane signing secret, and
   Runner public issuer-key allowlist. The Container receives none of these
   secrets.
4. Exercise duplicate delivery, process timeout, Container termination,
   cancellation, Queue retry/DLQ, output-limit, and no-network tests in a
   non-production account. Then obtain an external security review.

Cloudflare's deployment workflow builds a Container image with Docker. Docker
is not installed in this workspace, so this repository has not built or run a
Container image locally.
