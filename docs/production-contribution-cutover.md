# Production contribution cutover evidence gate

Status: offline verifier; it does not authorize or perform a production change

Migration `0043_add_runner_queue_event_sequence.sql` is a stop-the-world
boundary. The old queue writer cannot append after the migration trigger is
installed, and the new writer cannot safely operate before the migration. A
rolling migration is therefore not supported.

`scripts/check-production-contribution-cutover.mjs` verifies one captured,
non-secret **pre-migration authorization** document before an operator applies
0043. It never accepts post-migration observations in the same verdict. It
never connects to Turso, Sites, MCP, E2B, Render, GitHub, or any other
provider. It does not migrate a database, deploy a service, execute Lean,
unfreeze a write route, or issue a contribution record.

## Run the offline verifier

Create an ignored JSON evidence file from captured provider and database
observations:

```sh
node scripts/check-production-contribution-cutover.mjs \
  /absolute/path/to/production-cutover-evidence.json
```

The process exits zero and emits a verdict only when all required evidence is
present and internally consistent. Missing, malformed, or contradictory
evidence fails closed with path-specific issue codes.

Run the deterministic verifier tests with:

```sh
node --check scripts/check-production-contribution-cutover.mjs
node --test tests/production-contribution-cutover.test.mjs
```

Do not commit the operator evidence file. Although its schema permits only
non-secret identifiers, it remains a release record with provider and
operational metadata.

## Required evidence

New evidence uses schema version
`pw-production-contribution-cutover-evidence-v3`. Existing v2 evidence remains
verifiable as an `independent_observer` record so an already signed release
artifact does not become unverifiable. New v2 evidence must not be created.

Every v3 record declares one governance mode:

- `independent_observer` is the strong path. A distinct accountable Person
  signs the exact evidence artifact. It is valid for `public_alpha` or `stable`
  release tiers.
- `solo_alpha` is an operational exception for a project that still has one
  developer. It is valid only when `releaseTier` is `public_alpha`; the release
  commander acknowledges the exact evidence artifact with scope
  `infrastructure_cutover_only`.

Both modes must explicitly acknowledge that certified Receipts still require a
different-Person review and that a solo operator does not satisfy independent
review. The governance exception changes who may authorize an infrastructure
cutover; it does not weaken Agent ownership, review eligibility, Lean evidence,
or Receipt issuance rules.

The evidence also contains:

- **PITR clone rehearsal:** clone and snapshot labels, PITR and completion
  timestamps, source database fingerprint, pre/post migration heads, outcome,
  stable counts, and the verified `event_sequence` schema.
- **Production pre-migration boundary:** phase
  `pre_migration_authorization`, current head 0042, planned migration 0043,
  two ordered frozen observations with stable Run/queue counts, zero active
  leases, and confirmation that the production `event_sequence` column does
  not exist yet.
- **One release identity:** one lowercase, full 40-character commit SHA
  reported identically by the website, MCP/gateway, and Runner.
- **One control-plane authority:** `turso` and one 16-character non-secret
  database fingerprint reported by all three surfaces.
- **Frozen current state:** website and MCP report `read_only` with writes
  disabled; Runner execution is disabled. The declared target mode is
  `read_write`, but it must not be active at verification time.
- **Named ownership:** every operator role records a stable Person ID, account
  ID, and acceptance time. In `independent_observer` mode, the observer records
  a different Person ID and account ID, an acceptance time after the frozen
  observations, a signed acceptance-artifact hash, and a valid-signature
  projection. In `solo_alpha` mode, the release commander records a matching
  Person/account identity, an acknowledged acceptance-artifact hash, and the
  exact `infrastructure_cutover_only` scope. The gate deterministically
  recomputes the canonical hash of the exact payload—excluding only the
  acceptance hash and proof fields—and requires an exact match. Acceptance from
  another release window cannot be reused. A second account controlled by an
  operator never satisfies the independent-observer boundary.
- **Recovery boundary:** acknowledged `roll_forward` strategy. After 0043
  succeeds, an old writer or a schema downgrade is not a safe rollback.

The stable count objects contain non-negative integer values for:

```json
{
  "runs": 29,
  "queueMessages": 29,
  "queueEvents": 508,
  "activeLeases": 0
}
```

The `eventSequenceSchema` object contains:

```json
{
  "columnExists": true,
  "columnNullable": true,
  "uniqueRunSequenceIndexExists": true,
  "requiredInsertTriggerExists": true,
  "invalidSequenceCount": 0,
  "duplicateRunSequenceCount": 0,
  "legacyNullSequenceCount": 508,
  "sequencedEventCount": 0
}
```

Nullable legacy rows are intentional. The trigger requires every newly
inserted queue event to carry a positive sequence; the verifier therefore
requires the nullable column, partial unique index, and insert trigger
together.

## What a passing verdict means

A pass means only that the supplied pre-migration evidence is complete and
agrees on:

1. the rehearsed 0043 ledger transition and production's current 0042 head;
2. the exact planned 0043 migration;
3. stable data counts while production is still frozen before migration;
4. one release SHA across all runtime surfaces;
5. one Turso authority and fingerprint;
6. the current read-only/frozen state;
7. named release, incident, and recovery responsibility; and
8. the selected governance path's acceptance of this exact pre-migration
   evidence.

All operator role acceptances must precede final cutover acceptance, and that
acceptance must not postdate the evidence record.

It is not proof that the observations were honestly collected, are current, or
came from production. Those properties require the accepting party to inspect
the original provider and database evidence. `independent_observer` adds a
distinct Person to that inspection. `solo_alpha` does not, and the verdict
states that limitation. The verifier intentionally does not fetch provider
evidence itself.

It is also not post-migration verification. After 0043 is applied, operators
must capture a separate post-migration record before deploying or enabling any
writer. Keeping the two phases separate prevents a passing preflight from being
mistaken for evidence that migration already happened.

## Remaining controlled production steps

A passing offline verdict is followed by human-controlled steps from
`docs/runner-queue-0043-cutover-runbook.md`:

1. Confirm all public producers and every Runner consumer remain frozen, with
   two unchanged count observations and zero active leases.
2. Confirm the independent observer, or the scoped solo-alpha operator,
   accepted the exact pre-migration evidence artifact represented by the
   passing gate.
3. Apply 0043 once against production while every writer remains
   frozen.
4. Capture a separate post-migration record: head 0043, stable counts, schema
   objects, zero invalid/duplicate sequences, and unchanged authority.
5. Deploy website, identity/MCP gateway, and Runner from the same recorded
   commit SHA; keep writes and Runner execution disabled.
6. Recollect release diagnostics and run the strict release-manifest gate.
7. Enable one controlled consumer and run one persisted, operator-owned Lean
   smoke. Verify positive consecutive event sequences and then freeze it again.
8. Obtain explicit post-migration sign-off under the same governance mode. A
   stable release still requires a distinct independent observer.
9. Restore consumers, gateway writes, and website writes in the documented
   order; monitor and refreeze immediately on an old-writer or NULL-sequence
   attempt.
10. Run the separate credentialed ordinary-user smoke through Agent connection,
    Attempt, Bundle, and Runner. A certified Receipt remains blocked until a
    genuinely different Person completes the required review.

Until these steps finish, public contribution writes remain `read_only`.
