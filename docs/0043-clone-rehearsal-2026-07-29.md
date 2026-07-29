# Migration 0043 isolated-clone rehearsal

Status: completed on an isolated Turso PITR clone; production cutover not authorized

This record contains no database token, signing key, provider API key, bearer
token, or private connection URL. It records operational evidence only. It is
not mathematical verification, independent review, or a Contribution Receipt.

## Release candidate

- Repository: `alexyyyander/proofweave`
- Candidate SHA: `222f9318b0bebf0c4808433f1e9659d857d0146c`
- Production database fingerprint: `3f9e7934a04a22ec`
- Production migration head before and after rehearsal:
  `0042_add_jacobian_counterexample_audit.sql`
- Production control-plane mode: `read_only`
- Production public writes: disabled
- Production Runner consumers: frozen

## Stable production baseline

Two read-only samples separated by at least 20 seconds produced the same
values:

| Metric | Value |
| --- | ---: |
| Runs | 29 |
| Queue messages | 29 |
| Queue events | 508 |
| Active leases | 0 |
| Acknowledged messages | 25 |
| Cancelled messages | 4 |
| `event_sequence` columns | 0 |

The newest Run update was `2026-07-27T08:39:38.576Z`. The newest queue-message
and queue-event updates were both `2026-07-27T08:39:39.846Z`.

## Isolated restore

- PITR timestamp: `2026-07-29T00:56:27Z`
- Clone name: `proofweave-pre-0043-20260729t005627z`
- Clone ID: `019fab61-4001-7c6b-af6e-e319a0d487e0`
- Clone database fingerprint: `40bf2aae7d04f46c`
- Source database: `proofweave-control`
- Restore owner: Alex Yu
- Initial integrity result: `ok`
- Initial migration head: `0042_add_jacobian_counterexample_audit.sql`
- Initial counts: 29 Runs, 29 queue messages, 508 queue events

The clone is an independent database and was never restored over production.
Clone mutation used short-lived database tokens with a one-day expiration.
Turso token invalidation is group-wide for this database group, so the
operator deliberately did not rotate the `default` group keys: doing so would
also invalidate production tokens. No token value was printed or recorded.

## Migration result

The repository migration manager reported exactly one pending migration:

```text
0043_add_runner_queue_event_sequence.sql
```

The clone-only sequence `plan -> migrate -> verify` completed successfully:

- 44 migrations verified;
- latest migration:
  `0043_add_runner_queue_event_sequence.sql`;
- `runner_queue_events_run_sequence_idx` exists;
- `runner_queue_events_sequence_required` exists;
- `event_sequence` exists and remains nullable for immutable legacy rows;
- all 508 legacy events remain NULL;
- invalid positive-sequence count: 0;
- duplicate `(run_id, event_sequence)` count: 0.

## New-writer queue smoke

- Correlation Run: `run:clone-0043-smoke-ms5i2g6y`
- Scope: isolated clone only
- Resulting queue delivery state: `acknowledged`

Persisted events:

| Sequence | Event | Delivery state |
| ---: | --- | --- |
| 1 | `enqueued` | `queued` |
| 2 | `lease_claimed` | `leased` |
| 3 | `acknowledged` | `acknowledged` |

Post-smoke integrity remained `ok`; invalid and duplicate sequences remained
zero.

## Production boundary

After the rehearsal, production was checked again:

- migration head remained 0042;
- Runs remained 29;
- queue messages remained 29;
- queue events remained 508;
- `event_sequence` remained absent.

Production migration, exact-SHA deployment, isolated Lean execution smoke, and
public unfreeze remain blocked until the external independent-observer gate is
satisfied. A solo operator must not present this clone rehearsal as a completed
production cutover.

Recorded at `2026-07-29T03:06:43Z`.
