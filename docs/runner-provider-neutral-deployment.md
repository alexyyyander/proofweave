# Provider-neutral trusted Lean Runner

This is the no-Cloudflare-Containers deployment path for the closed alpha. It
uses the same signed Runner protocol as the Cloudflare Worker, with remote
libSQL for control-plane state and one no-egress Modal Sandbox per Run.

## Trust boundary

```text
OAuth-bound MCP gateway
  -> signed, source-free queue envelope
  -> remote libSQL migration 0032 lease queue
  -> trusted Runner process
       - verifies the control-plane signature
       - renews and fences its lease
       - reconstructs immutable evidence into one Sandbox
       - rechecks the active lease before signing or storing a result
       - signs the Runner result outside the Sandbox
  -> no-egress, digest-pinned Modal Lean Sandbox
```

The trusted process holds the libSQL token, Modal credentials, control-plane
public keys, and Runner result private key. Submitted code receives none of
them. The Modal Connect Token stays only in process memory and is cleared when
the one-Run Sandbox terminates.

## Required deployment values

Start from `.env.example`. The process requires:

- `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`;
- Modal SDK credentials, an existing Modal app, and one digest-pinned Runner
  image;
- `RUNNER_CONTROL_PLANE_ISSUER_KEYS_JSON`, containing only enrolled Ed25519
  public keys;
- the matching approved image declaration in
  `RUNNER_APPROVED_IMAGES_JSON`;
- `RUNNER_RESULT_KEY_ID` and `RUNNER_RESULT_PRIVATE_KEY_JWK`, held only by the
  trusted process; and
- a stable `RUNNER_CONSUMER_ID` for this deployment instance.

Keep `RUNNER_EXECUTION_ENABLED=false` until every gate below is evidenced.

## Database and delivery semantics

Apply the complete migration history to a new external database, or apply only
pending reviewed migrations to an existing one. Migration `0032` creates:

- one immutable canonical queue envelope per Run;
- a unique `(attempt_id, idempotency_key)` boundary;
- queued, leased, acknowledged, cancelled, and dead-letter projections;
- expiring leases with conditional renew/ack/release fencing; and
- append-only privacy-minimal delivery events.

Delivery is at least once. A crashed process leaves a lease that another
process can reclaim after expiry. A stale process cannot acknowledge a newer
lease or cross the final result-signing/persistence boundary. If a trusted
process dies after a process-local Modal Sandbox entered `running`, its
replacement restages the same immutable evidence into one new clean Sandbox;
the original Run identity and start event remain unchanged, and the abandoned
no-egress Sandbox is bounded by its provider timeout. Run state, signed
execution evidence, and contribution credit remain in
their existing stores; queue acknowledgement itself never creates credit.

For the no-card Turso path, run `npm run turso:bootstrap` once after installing
the official Turso CLI. It creates/reuses a free database, keeps its scoped
token in `.env.local`, and atomically records the reviewed migration hashes.
Use `npm run turso:plan` and `npm run turso:verify` for read-only operational
checks. Full setup and token rotation are documented in
[the zero-cost Turso guide](turso-zero-cost-control-plane.md).

## Activation sequence

1. Back up the external database and apply migration `0032` with execution
   disabled.
2. Enrol the Runner result public key in `runner_keys`; never put the private
   JWK in the Sandbox image or database.
3. Confirm the Modal image digest exactly matches the single closed-alpha image
   allowlist entry and review CPU, memory, timeout, disk, process, and network
   policy.
4. Start the process with `RUNNER_EXECUTION_ENABLED=false` and confirm it fails
   closed before claiming work.
5. Set the gate to `true` only in a non-production environment and run one
   signed fixture through enqueue, lease, real Lean kernel execution, immutable
   output persistence, result signing, and acknowledgement.
6. Kill the process during a second fixture, wait for lease expiry, and confirm
   a replacement reclaims it while the stale lease cannot acknowledge.
7. Exercise cancellation, output truncation, invalid signature dead-lettering,
   maximum-attempt dead-lettering, and Sandbox termination.
8. Add alerts for `dead_lettered`, `lease_lost`, `control_plane_error`, queue
   age, and a stopped heartbeat before enabling the closed-alpha workload.

Run the trusted process with:

```sh
npm run runner:trusted:start
```

## Shutdown and incident response

Set `RUNNER_EXECUTION_ENABLED=false` in the replacement deployment and stop the
current process. Do not delete queue rows or events. Revoke the Modal and
libSQL credentials if either boundary may be compromised, revoke the Runner
result key if signing material may be compromised, and keep all affected Runs
provisional until their evidence has been replayed by an independent owner.
