# Provider-neutral trusted Lean Runner

This is the no-Cloudflare-Containers deployment path for the closed alpha. It
uses the same signed Runner protocol with remote libSQL for control-plane state
and one fresh, no-egress Sandbox per Run. `PROOFWEAVE_RUNNER_PROVIDER` selects
`e2b` or `modal`; provider selection is explicit and otherwise fails closed.

For the zero-card Build Week path, GitHub Actions runs the trusted control
process once per dispatch and E2B executes the submitted Lean workspace.

## Trust boundary

```text
OAuth-bound MCP gateway
  -> signed, source-free durable lease in Turso
  -> protected GitHub Actions trusted Runner
       - verifies the control-plane signature
       - renews and fences its lease
       - creates one private E2B Sandbox
       - confirms Internet disabled and public traffic disabled
       - reconstructs immutable evidence inside that Sandbox
       - rechecks the active lease before signing or storing a result
       - signs the Runner result outside the Sandbox
  -> one-Run E2B Lean Sandbox
       - exact reviewed template
       - no outbound Internet
       - authenticated private inbound proxy
       - no database, OAuth, queue, GitHub, E2B, or signing credential
```

The trusted process holds the libSQL token, E2B API key, control-plane public
keys, and Runner result private key. Submitted code receives none of them. The
per-Sandbox E2B traffic token stays only in process memory and is cleared when
the Sandbox is killed.

## Required deployment values

Start from `.env.example`. Shared trusted-process values are:

- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`;
- `PROOFWEAVE_RUNNER_PROVIDER=e2b`;
- `RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON`, containing only enrolled Ed25519
  public keys;
- one exact declaration in `RUNNER_APPROVED_IMAGES_JSON`;
- `RUNNER_RESULT_KEY_ID` and `RUNNER_RESULT_PRIVATE_KEY_JWK`, held only by the
  trusted process; and
- a stable `RUNNER_CONSUMER_ID`.

E2B additionally requires:

- `E2B_API_KEY`, kept only in the protected GitHub Actions environment;
- `PROOFWEAVE_E2B_RUNNER_IMAGE`, pinned by registry sha256 digest and identical
  to the single approved image declaration;
- `PROOFWEAVE_E2B_TEMPLATE_ID`, produced from that exact image;
- bounded runtime and startup timeouts; and
- `PROOFWEAVE_E2B_RESOURCE_POLICY_REVIEWED=true` only after the template,
  resources, network policy, and termination path have been reviewed.

The public gateway uses `RUNNER_QUEUE_MODE=d1`, the same Turso authority, the
control-plane private signing key, the approved image registry, and bounded
default limits. The Runner receives only the matching control-plane public key.

## E2B template

The template is built from the already reviewed Proofweave Runner image, not
from mutable source or a floating tag:

```sh
npm run runner:e2b:template:build
```

Record the returned template id as `PROOFWEAVE_E2B_TEMPLATE_ID`. The template
contains Lean, Lake, the pinned dependencies, and the credential-free Runner
HTTP process. Runtime code still checks the configured image against the
signed job's approved environment before staging any bytes.

## GitHub Actions control process

`.github/workflows/e2b-lean-runner.yml` runs only trusted repository code. It
uses protected environment secrets, claims at most one Turso lease, invokes one
E2B Sandbox, and exits. Untrusted workspace bytes are never checked out or
executed on the GitHub-hosted machine.

Configure the `proofweave-runner-alpha` GitHub environment:

- secrets: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `E2B_API_KEY`, and
  `RUNNER_RESULT_PRIVATE_KEY_JWK`;
- variables: `PROOFWEAVE_E2B_TEMPLATE_ID`,
  `PROOFWEAVE_E2B_RUNNER_IMAGE`, `RUNNER_APPROVED_IMAGES_JSON`,
  `RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON`, and `RUNNER_RESULT_KEY_ID`.

The workflow supports manual `workflow_dispatch` and the bounded
`proofweave_lean_run` repository dispatch event. Until a least-privilege GitHub
App owns the automatic dispatch credential, keep automatic dispatch disabled
and trigger the alpha workflow manually after a Bundle has been queued.

## Database and delivery semantics

Migration `0032` supplies immutable queue envelopes, idempotency, expiring
leases, conditional renew/ack/release fencing, dead-letter projections, and
append-only privacy-minimal events. Delivery is at least once. A crashed GitHub
job leaves a lease that another run can reclaim after expiry. A stale process
cannot acknowledge or sign across the final fence.

Queue acknowledgement never creates contribution credit. A successful Runner
record only makes the Bundle eligible for different-owner verification; the
Receipt coordinator still requires the configured independent review policy.

## Activation sequence

1. Keep `RUNNER_EXECUTION_ENABLED=false` while applying and verifying all Turso
   migrations.
2. Enrol the Runner result public key; never put its private JWK in the E2B
   template, Sandbox environment, database, or output.
3. Build the final Runner image by digest, inspect it, then build and record the
   E2B template id.
4. Exercise E2B creation and confirm the provider reports both disabled
   Internet access and private inbound traffic.
5. Configure the protected GitHub environment and run one signed fixture with
   `npm run runner:trusted:once` through the workflow.
6. Confirm real Lean execution, kernel acceptance, no-`sorry`, allowed-axiom
   audit, immutable outputs, result signature, and queue acknowledgement.
7. Kill a second workflow after lease acquisition and confirm expiry recovery
   while the stale lease cannot finalize.
8. Exercise cancellation, output truncation, invalid signature dead-lettering,
   maximum attempts, Sandbox kill, and key revocation.
9. Only then enable automatic repository dispatch for the closed alpha.

## Shutdown and incident response

Disable repository dispatch, set `RUNNER_EXECUTION_ENABLED=false` in the
protected environment, and cancel active Runner workflows. Do not delete queue
rows or events. Revoke E2B, Turso, GitHub dispatch, or Runner-result credentials
at the boundary that may be compromised. Keep affected Runs provisional until
their exact evidence has been replayed by a different owner.
