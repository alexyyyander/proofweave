# Provider-neutral trusted Lean Runner

Status: active alpha reference architecture; current-release live closure still
required

This is the provider-neutral trusted Runner path for the closed alpha. The
reference deployment uses a hosted Node control process on Render, shared
Turso/libSQL control-plane state, and one fresh private E2B Sandbox per Run.
`PROOFWEAVE_RUNNER_PROVIDER` selects `e2b` or `modal`; provider selection is
explicit and otherwise fails closed.

GitHub Actions is not the primary Runner. It remains a bounded recovery,
diagnostic, CI, and image-release mechanism. The canonical GitHub dependency
boundary is in [`github-independence.md`](github-independence.md).

## Trust boundary

```text
OAuth-bound MCP gateway
  -> signed, source-free durable lease in Turso
  -> authenticated wake to the hosted trusted Runner
  -> trusted Render control process
       - verifies the control-plane signature
       - renews and fences its lease
       - creates one private E2B Sandbox
       - confirms Internet and public traffic are disabled
       - reconstructs immutable Bundle evidence inside that Sandbox
       - rechecks the active lease before signing or storing a result
       - signs the Runner result outside the Sandbox
  -> one-Run E2B Lean Sandbox
       - exact reviewed template
       - no outbound Internet
       - authenticated private inbound proxy
       - no database, OAuth, queue, GitHub, E2B, or signing credential
```

The trusted process holds the libSQL token, E2B API key, control-plane public
keys, Runner result private key, and wake secret. Submitted code receives none
of them. The per-Sandbox E2B traffic token stays only in process memory and is
cleared when the Sandbox is killed.

The hosted HTTP surface accepts no source or Bundle bytes. It exposes
privacy-safe `GET /healthz` status plus authenticated, empty-body
`POST /v1/wake`. Signed work remains in the durable Turso lease queue.

## Required deployment values

Start from `.env.example`. The hosted trusted process requires:

- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`;
- `PROOFWEAVE_RUNNER_PROVIDER=e2b`;
- `RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON`, containing only enrolled Ed25519
  public keys;
- one exact declaration in `RUNNER_APPROVED_IMAGES_JSON`;
- `RUNNER_RESULT_KEY_ID` and `RUNNER_RESULT_PRIVATE_KEY_JWK`, held only by the
  trusted process;
- `PROOFWEAVE_RUNNER_WAKE_TOKEN`, shared only with the control-plane wake
  client;
- a stable `RUNNER_CONSUMER_ID`; and
- a deployment revision such as `RENDER_GIT_COMMIT`.

E2B additionally requires:

- `E2B_API_KEY`, kept only in the hosted secret store;
- `PROOFWEAVE_E2B_RUNNER_IMAGE`, pinned by registry SHA-256 digest and identical
  to the approved image declaration;
- `PROOFWEAVE_E2B_TEMPLATE_ID`, a version-tagged `template-id:tag` reference;
- `PROOFWEAVE_E2B_TEMPLATE_BUILD_ID`, the immutable build UUID that the tag
  must still resolve to before every Sandbox creation;
- bounded runtime and startup timeouts; and
- `PROOFWEAVE_E2B_RESOURCE_POLICY_REVIEWED=true` only after template, resource,
  network, and termination review.

The public gateway uses `RUNNER_QUEUE_MODE=d1`, the same Turso authority, the
control-plane private signing key, the approved image registry, bounded default
limits, and the exact hosted wake URL/token. The Runner receives only the
matching control-plane public key.

## E2B template and image supply chain

The template is built from an already reviewed digest-pinned Runner image, not
from mutable source or a floating tag:

```text
reviewed image build
  -> checksum-bound Lean base
  -> network-disabled final assembly
  -> immutable OCI image digest + provenance
  -> private E2B template build
```

The current engineering pipeline uses
`.github/workflows/build-e2b-lean-runner-image.yml` and GHCR for this release
step. That is a build-time GitHub dependency, not a per-Run participant or
runtime dependency. Runtime still verifies that the E2B version tag resolves
to the recorded build UUID and that the requested Lean/Mathlib environment
matches the approved image declaration.

The checked-in core-alpha profile supports only Lean Core and records
`mathlibRevision=none`; it must not verify a Bundle that declares Mathlib.
For an audited runtime-only repair that does not change Lean, Mathlib, or system
dependencies, `PROOFWEAVE_E2B_RUNNER_SOURCE_OVERLAY=true` uploads only reviewed
`packages/` and `services/lean-runner/` source. This opt-in requires explicit
operator authorization.

## Hosted control process

`services/lean-runner/hosted-trusted-runner.mjs` is the reference controller.
It continuously leases bounded work from Turso while the host is awake and can
be awakened after a durable queue write through the authenticated endpoint.
Run it in a hosted Node environment with:

```sh
npm run runner:hosted:start
```

The host must use the exact reviewed release revision and must never receive
participant source over HTTP. Health readiness does not prove a completed Run:
release evidence must show a current-instance wake and one terminal,
correlation-linked result.

## GitHub Actions recovery path

`.github/workflows/e2b-lean-runner.yml` is retained for manual recovery,
bounded repository dispatch, and a six-hour safety sweep. It may claim at most
one Turso lease and invoke one E2B Sandbox. Untrusted workspace bytes are never
checked out or executed on the GitHub-hosted machine.

Do not describe this workflow as the primary controller. Normal queue delivery
must wake the hosted trusted Runner. Disabling the Actions workflow must not
prevent the current-release acceptance fixture from reaching E2B.

## Database and delivery semantics

Migration `0043` supplies immutable ordered queue events, while the durable
queue keeps idempotency, expiring leases, conditional renew/ack/release fencing,
dead-letter projections, and append-only privacy-minimal events. Delivery is at
least once. A crashed controller leaves a lease that another authorized
consumer can reclaim after expiry. A stale process cannot acknowledge or sign
across the final fence.

Queue acknowledgement never creates contribution credit. A successful Runner
record only makes the Bundle eligible for different-owner verification; the
Receipt coordinator still requires the configured independent-review policy.

## Activation sequence

1. Keep `RUNNER_EXECUTION_ENABLED=false` while applying and verifying all Turso
   migrations.
2. Enrol the Runner result public key; never place its private JWK in the E2B
   template, Sandbox environment, database, logs, or source.
3. Build and inspect the final Runner image by digest, then record the exact
   E2B template reference and build ID.
4. Exercise E2B creation and confirm disabled Internet plus private inbound
   traffic.
5. Configure the hosted trusted Runner and verify `GET /healthz` reports the
   expected revision, provider, image, template, and ready state.
6. Queue one signed v2 fixture, send one authenticated wake, and confirm real
   Lean execution, kernel acceptance, no-`sorry`, allowed-axiom audit,
   immutable outputs, result signature, and queue acknowledgement.
7. Disable the GitHub Actions Runner and repeat the fixture. This is the
   required GitHub-independent runtime drill.
8. Exercise lease expiry, cancellation, output truncation, invalid-signature
   dead-lettering, maximum attempts, Sandbox kill, and key revocation.
9. Close different-owner review and Receipt issuance before calling the
   current release operational.

## Shutdown and incident response

Set `RUNNER_EXECUTION_ENABLED=false`, reject new wake requests, stop the hosted
consumer, and disable the Actions recovery workflow. Do not delete queue rows
or events. Revoke the credential at the compromised boundary: E2B, Turso,
hosted wake, control-plane, registry, or Runner-result key. Keep affected Runs
provisional until their exact evidence has been replayed by a different owner.
