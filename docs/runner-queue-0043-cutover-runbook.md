# Runner queue migration 0043 cutover runbook

Status: required release procedure

Migration `0043_add_runner_queue_event_sequence.sql` is a coordinated,
stop-the-world cutover. It preserves legacy queue events with a NULL
`event_sequence`, but its trigger rejects every new queue event that does not
provide a positive sequence. Consequently:

- the new queue writer cannot run before migration `0043`;
- an old queue writer cannot run after migration `0043`;
- a rolling deployment across the migration is not supported.

This procedure never prints or records a database token, signing key, provider
API key, bearer token, or private URL. Release evidence contains only approved
non-secret revisions, provider resource labels, counts, timestamps, and
fingerprints.

## Preconditions and named owners

Do not begin until the release record identifies all of the following people
and each has acknowledged the window:

| Responsibility | Required confirmation |
| --- | --- |
| Release commander | Owns the timeline, freeze decision, and final unfreeze |
| Database owner | Owns the backup, migration plan, apply, and verification |
| Sites participant owner | Can deny every browser/Sites participant mutation independently |
| MCP gateway owner | Can deny every Agent-originated MCP mutation independently |
| Runner owner | Can stop Render and GitHub consumers and cancel active work |
| Incident owner | Can keep the system frozen and direct a roll-forward |
| Cutover acceptor | A distinct observer for stable releases, or the release commander under the bounded `solo_alpha` public-alpha exception |

### Select the governance track

The pre-migration evidence gate supports two explicit tracks:

- `independent_observer`: a different accountable Person signs the recorded
  SHA, counts, manifest, and smoke result. This is the required track for a
  `stable` release and the preferred track for every public-alpha release.
- `solo_alpha`: the release commander may accept a `public_alpha`
  infrastructure cutover when the project has no second operator. The
  acceptance must be bound to the exact evidence artifact with scope
  `infrastructure_cutover_only`.

`solo_alpha` is not independent review. It cannot approve a mathematical claim,
make two Agents with one owner independent, or satisfy the different-Person
review gate for a certified Contribution Receipt. If the declared release tier
is `stable`, if a second Person is presented as independent but shares the
operator's identity, or if the limitation is not acknowledged, the verifier
fails closed.

The release candidate must have passed the fast and complete repository checks,
the production dependency gate, and review. Record its candidate commit. Before
merging, disable every commit-triggered deployment, including Render
`autoDeployTrigger: commit`, so the merge cannot start an uncontrolled partial
deployment. After merge, fetch `origin/main`, record the resulting full
40-character `RELEASE_SHA`, and rerun the required checks from a clean canonical
`main` worktree whose `HEAD` equals `origin/main`.

Also confirm:

- Turso is the single control-plane authority used by Sites, the gateway, and
  every Runner process;
- the current migration ledger is readable and only `0043` (or an explicitly
  reviewed contiguous set ending at `0043`) is pending;
- provider status pages show no active database or deployment incident;
- the operator can freeze Sites participant and MCP gateway mutation routes
  independently of each other and independently of a source deployment;
- the operator can disable Render auto-deploy, stop its Runner process, disable
  the GitHub Runner workflow and repository dispatch source, and cancel active
  runs;
- no participant session depends on completing during the maintenance window;
- the approved backup/restore procedure has been exercised against a
  non-production database.

If any writer lacks an independently verifiable freeze control, abort before
merge or migration. HTTP maintenance text alone is not a freeze unless mutation
probes demonstrate that it blocks the underlying write path.

### Reviewed production-drill trust policy

The production drill takes repository identity and recovery-operator authority
only from [`config/production-drill-policy.json`](../config/production-drill-policy.json).
Its canonical hash is included in both the release manifest and drill release
fingerprint. Runtime environment variables cannot add a repository or key;
when supplied, they are exact-match assertions only.

The checked-in policy currently contains the GitHub repository identity
`alexyyyander/proofweave` / `1298911069`, verified through the read-only GitHub
repository API on 2026-07-28. It also fixes the canonical Runner origin
`https://proofweave-trusted-runner.onrender.com` and the verified Turso
fingerprint `3f9e7934a04a22ec`. The Runner health endpoint is derived as
`/healthz`; it is not a separate resource identity.

Policy version 4 enrolls the public recovery operator key
`release-operator:alexyu-20260731`. The repository contains only its canonical
32-byte base64url public key and deterministic fingerprint; it cannot prove
where the corresponding private JWK is held or whether it remains usable.
Operational authority therefore requires a separately checked external,
regular mode-`0600` private-key file.
Any rotation must add or remove public keys through a separately reviewed pull
request and pass the release-manifest and production-drill negative tests
before the new policy hash is used in a release.

Public enrollment does **not** prove that the corresponding private key still
exists or is usable. Before authorizing a drill, the release commander must
locate the external file and compare it to the reviewed policy without printing
private bytes:

```bash
npm run runtime:github-independent:drill:key -- verify \
  --key-id release-operator:alexyu-20260731 \
  --private-key-file "$HOME/.proofweave/release-keys/release-operator-alexyu-20260731.private.jwk" \
  --repository-root "$PWD"
```

Replace the example path with the actual operator custody path. The command
fails unless the path is absolute and outside the repository, the
file is a regular single-link file owned by the current user with mode `0600`,
the Ed25519 private/public members match, and the derived public entry exactly
matches the reviewed policy. Its stdout contains only the
canonical private-file path, environment variable names, and public enrollment
metadata. If the private file is unavailable, do not claim that recovery
authority is ready and do not create a replacement under the same key ID. The
unreleased `release-operator:alexyu-20260728` candidate was replaced before
production because no corresponding private-key custody file could be found;
it is not trusted by policy version 4.

For a new operator or rotation, generate the key directly at its external
destination:

```bash
npm run runtime:github-independent:drill:key -- generate \
  --key-id release-operator:person-YYYYMMDD \
  --private-key-file "$HOME/.proofweave/release-keys/release-operator-person-YYYYMMDD.private.jwk" \
  --repository-root "$PWD"
```

The destination is created atomically and is never overwritten. To adopt an
existing secure Ed25519 private JWK, use `import` with
`--source-private-key-file`; import validates the source, creates a separate
mode-`0600` destination without replacing either file, and prints the same
public-only enrollment plan. Never paste JWK contents into a shell argument,
environment variable, issue, PR, terminal transcript, or CI log.

Rotation is a two-review change:

1. Generate or import a new uniquely named external key and make two encrypted,
   access-controlled offline backups. Restore one copy to a temporary
   mode-`0600` file and run `verify` against the transitional policy; a backup
   that has not been restored and
   checked is not recovery evidence.
2. In the first reviewed PR, increment `policyVersion` and add only the new
   `policyEntry`, temporarily retaining the old public entry.
3. Deploy that reviewed policy and complete a bounded recovery-isolation
   preflight signed by the new key. Do not enable the recovery Runner merely to
   test key possession.
4. In a second reviewed PR, remove the old public entry and increment
   `policyVersion` again. Record the revocation time and policy hash.
5. After the rollback window closes, securely destroy every online copy of the
   retired private key according to the incident/retention policy. Keep no
   retired private key in GitHub Actions, Sites, Render, Turso, repository
   files, `.env` files, shared cloud-sync folders, or build artifacts.

If a private key is lost, copied to an untrusted location, printed, committed,
or exposed in telemetry, freeze recovery use immediately and perform the same
add-new/remove-old reviewed rotation. Merely deleting or renaming the local
file does not revoke its enrolled public authority.

The drill CLI accepts only the external private-key file and key ID. It derives
the public key and rejects it unless both ID and public bytes match the reviewed
policy. An operator must not populate a trusted-keyset environment variable to
bootstrap authority; a self-selected keyset is not production evidence.

### External GitHub authority gate

The signed recovery observation covers only the fixed, reviewed workflow source
closure at one begin-time instant. It does not query or prove GitHub
organization, repository, or Environment authorization policy. Before merge or
deployment, the release commander and cutover acceptor must collect
provider-side evidence that:

- the `proofweave-runner-alpha` Environment permits only the reviewed branch or
  tag and requires the named production approver(s);
- historical demo workflows use a distinct Environment and no demo or mocker
  private key is stored in `proofweave-runner-alpha`;
- repository and Environment secrets that can reach Turso, E2B, queue signing,
  Runner-result signing, or Receipt issuance are not available to unreviewed
  workflows, reusable workflows, local actions, forks, or unrestricted
  maintainers;
- no organization-level secret grants this repository a broader queue/runtime
  authority than the reviewed Environment policy;
- `workflow_dispatch`, `repository_dispatch`, schedules, and Environment
  approvals for both reviewed queue workflows are disabled or blocked for the
  freeze, with zero active runs;
- every third-party action in the reviewed workflows is pinned to an immutable
  full commit SHA; and
- the scanner's reviewed full-file workflow hashes and fixed checked-in
  `uses`/`run` closure pass without trigger, permission, Environment/secret
  mapping, local-action, reusable-workflow, inherited-secret, or wrapper drift.

Record the GitHub audit-event IDs, API responses, or screenshots and the UTC
observation interval in the release record. If any item is unknown, inherited,
or cannot be inspected, the release is **not authorized to merge or deploy**.
Under `solo_alpha`, the same Person may perform and accept the inspection, but
the release record must retain that non-independent limitation. A signed begin
snapshot cannot substitute for this external gate, and neither proves
continuous or hosted-exclusive isolation.

## Phase 1 — Freeze producers

Record the UTC start time and expected `RELEASE_SHA`, then prevent creation of
new Runs before stopping consumers:

1. Deploy the reviewed Sites release candidate with all three explicitly
   configured fences:
   `PROOFWEAVE_CONTROL_PLANE_MODE=read_only`,
   `PROOFWEAVE_MCP_CONTROL_PLANE_MODE=read_only`, and
   `PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE=read_only`. The first is a
   master ceiling; the latter two are independently operated surface fences.
   Missing or invalid values must fail closed. Public catalog reads may remain
   available. The public capability document at
   `/api/mcp/capabilities` must report
   `controlPlaneOperations.mode=read_only` and
   `controlPlaneOperations.writesEnabled=false`.
2. Confirm the MCP diagnostics report its explicitly configured surface mode
   as `read_only`. Deny methods that create or mutate Attempts, Bundles,
   reviews, Runs, or queue messages while keeping health, OAuth refresh-token
   maintenance, and read-only discovery available.
3. Confirm the Sites/participant diagnostics independently report their
   explicitly configured surface mode as `read_only`. Deny browser routes that
   create or mutate Agent connections, Attempts, Bundles, reviews, Runs, or
   Receipts.
4. Disable the external repository-dispatch producer and any scheduled/manual
   automation that can enqueue a Run.
5. Disable Render auto-deploy before the main merge. Do not allow a commit hook
   to replace the process during the window.
6. Probe the MCP and participant mutation boundaries separately with a
   non-production owner account and
   record the expected HTTP 503 maintenance response. Confirm that the durable
   Run and queue-message counts do not increase during the observation
   interval. A capability response alone is not freeze evidence; the mutation
   probe and unchanged database counts are both required.

Do not revoke credentials merely to implement a planned freeze. Credential
revocation is an incident action and requires a separate recovery record.

## Phase 2 — Drain, then freeze consumers

Keep the currently deployed Runner revision active only long enough to drain
work accepted before the producer freeze. Observe queue state from the control
plane without modifying it:

```sql
SELECT delivery_state, COUNT(*) AS message_count
FROM runner_queue_messages
GROUP BY delivery_state
ORDER BY delivery_state;

SELECT COUNT(*) AS active_lease_count
FROM runner_queue_messages
WHERE delivery_state = 'leased';
```

The release commander may proceed only when `active_lease_count` is zero.
Prefer draining all `queued` messages as well. If a queued message cannot
finish safely, leave it durably queued, record its Run ID and reason, and keep
all consumers stopped until the new writer is deployed; never delete or
acknowledge it administratively.

Then freeze every consumer and writer that can append queue or Run lifecycle
events:

1. Set `RUNNER_EXECUTION_ENABLED=false` for the hosted Runner.
2. Stop or suspend the Render Runner service and cancel any in-progress Render
   deployment.
3. Disable the GitHub `e2b-lean-runner` workflow, its schedule,
   `workflow_dispatch`, and `repository_dispatch` producer; cancel active jobs.
4. Disable any Cloudflare Queue consumer or alternate Runner process.
5. Confirm no process holds a live queue lease and repeat the queue counts
   after an observation interval. The counts must be unchanged.

Record provider screenshots or audit-event identifiers for each freeze. Do not
continue merely because one Runner reports disabled; all paths must be frozen.

## Phase 3 — Back up the quiescent authority

With all writers frozen:

1. Record the first frozen queue/Run counts, migration head, and schema-absence
   observation.
2. Create a provider-supported, restorable Turso backup or snapshot.
3. Record its non-secret backup identifier, creation time, database
   fingerprint, migration head, retention deadline, and restore owner.
4. Verify that the backup reports complete and that the documented restore
   procedure can target an isolated database. Do not test restore over
   production.
5. Record the second frozen observation after the backup completes. It must
   match the first observation, include the total number of legacy queue
   events, and confirm that the new column is absent before the migration:

```sql
SELECT COUNT(*) AS queue_event_count
FROM runner_queue_events;

SELECT COUNT(*) AS event_sequence_column_count
FROM pragma_table_info('runner_queue_events')
WHERE name = 'event_sequence';
```

Before `0043`, `event_sequence_column_count` must be zero. Do not probe the
missing column with a query that aborts the operator's SQL batch, and do not
change schema by hand.

The production recovery point must be fresh for this exact frozen window,
created between the two identical observations, still inside provider
retention when cutover acceptance is recorded, and identify the Person
responsible for an isolated restore. A successful PITR-clone rehearsal from an
earlier window proves procedure only; it is not the production recovery point
for this migration.

## Phase 4 — Plan, apply, and verify migration 0043

From the clean `RELEASE_SHA` worktree, load credentials only through the
approved ignored environment file or secret provider. Never paste them into
the command line, terminal transcript, issue, or release record.

```bash
npm run turso:plan
npm run turso:migrate
npm run turso:verify
```

The plan must name `0043_add_runner_queue_event_sequence.sql`; the apply must
complete once; verification must report `0043` as the latest migration. Stop on
any different plan or partial result.

Use a read-only administrative query to verify the database objects:

```sql
SELECT name, type
FROM sqlite_master
WHERE name IN (
  'runner_queue_events_run_sequence_idx',
  'runner_queue_events_sequence_required'
)
ORDER BY name;

SELECT name, "notnull"
FROM pragma_table_info('runner_queue_events')
WHERE name = 'event_sequence';

SELECT COUNT(*) AS invalid_sequence_count
FROM runner_queue_events
WHERE event_sequence IS NOT NULL AND event_sequence <= 0;

SELECT COUNT(*) AS legacy_null_sequence_count
FROM runner_queue_events
WHERE event_sequence IS NULL;

SELECT run_id, event_sequence, COUNT(*) AS duplicate_count
FROM runner_queue_events
WHERE event_sequence IS NOT NULL
GROUP BY run_id, event_sequence
HAVING COUNT(*) > 1;
```

Both database objects and the nullable `event_sequence` column must exist;
invalid and duplicate result sets must be empty. Legacy NULL rows are expected
and must not be rewritten.

## Phase 5 — Deploy one SHA while writes remain frozen

Deploy Sites, identity/gateway, and every Runner surface from the exact
`RELEASE_SHA`. Keep the MCP and participant mutation controls independently
frozen and keep
`RUNNER_EXECUTION_ENABLED=false`.

Keep the master, MCP, and participant modes explicitly set to `read_only`.
Deploying the split fences is not authorization to open either one.

- Use a manual, SHA-pinned Render deployment. Do not re-enable auto-deploy.
- Keep GitHub schedule, workflow dispatch, and repository dispatch disabled.
- Confirm Sites, gateway, Render, Runner image, E2B template, and migration
  evidence all refer to the same release record.
- Reject any deployment whose reported source revision is missing, abbreviated,
  or different from `RELEASE_SHA`.

Do not deploy an older writer after `0043`. It will fail closed, and retrying it
does not constitute recovery.

## Phase 6 — Strict manifest and non-mutating health checks

Collect every `PROOFWEAVE_RELEASE_*` value from the live provider or service
observation that it represents. These values are non-secret, but they are
release evidence, not values to guess or copy from the candidate configuration.
If the gateway revision, database fingerprint, or migration head is not
observable from the deployed service, the release remains blocked.
The Site deployment must receive `PROOFWEAVE_RELEASE_SITES_COMMIT_SHA` and
`PROOFWEAVE_RELEASE_SITES_VERSION`; the Runner must receive the same Sites
version and reviewed `PROOFWEAVE_RELEASE_SITE_PROJECT_ID`. The production drill
also remains blocked until the canonical Runner origin and Turso fingerprint
are enrolled in `config/production-drill-policy.json`.
The strict release manifest must also include explicit valid values for
`PROOFWEAVE_CONTROL_PLANE_MODE`,
`PROOFWEAVE_MCP_CONTROL_PLANE_MODE`, and
`PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE`. An omitted value is invalid even
though the runtime itself fails closed.

Run strict mode from the clean `RELEASE_SHA` worktree:

```bash
npm run release:manifest:strict
```

It must exit zero with `validation.state` equal to `valid`. Preserve the
manifest and its content hash in the release record.

While execution remains disabled, verify:

- Sites public reads and authenticated read-only views;
- OAuth discovery and gateway health;
- Runner `/healthz`, full source revision, approved image digest, template ID
  and build ID;
- the same lowercase database fingerprint from the Sites-integrated gateway
  `releaseDiagnostics` and Runner `/healthz`;
- live `ledgerHead` `0043_add_runner_queue_event_sequence.sql` on both
  diagnostics; strict manifest separately binds it to the repository head;
- no increase in Run, queue-message, or queue-event counts.

## Phase 7 — Controlled smoke while public producers stay frozen

Keep public MCP and Sites participant mutation routes independently frozen and
keep automatic dispatch frozen. Enable
exactly one controlled Runner consumer from `RELEASE_SHA`, submit one bounded
operator-owned fixture through the approved internal path, and record one
correlation ID.

The fixture must:

- create one new Run and queue message without a legacy writer;
- complete one real isolated Lean replay;
- append only positive, consecutive `event_sequence` values for that Run;
- produce no NULL event sequence;
- preserve request, Bundle, result, and output hash bindings;
- reach the expected queue acknowledgement without duplicate terminal events.

Verify the new event sequence directly:

```sql
SELECT event_sequence, event_type, delivery_state, occurred_at
FROM runner_queue_events
WHERE run_id = :controlled_smoke_run_id
ORDER BY event_sequence;
```

Immediately set `RUNNER_EXECUTION_ENABLED=false` again and stop the controlled
consumer. Re-run strict manifest mode and the non-mutating health checks. A
Runner readiness response or a zero exit from repository tests is not a
substitute for this persisted smoke evidence.

## Phase 8 — Unfreeze

The release commander and the cutover acceptor selected in the evidence record
must sign off on the backup, migration verification, exact-SHA deployments,
strict manifest, health checks, and controlled smoke before any public write
path is restored. A `stable` release requires a distinct independent observer;
`solo_alpha` may restore only the explicitly labeled public-alpha service.

Unfreeze in this order, capturing diagnostics and a negative probe of the
still-frozen next surface after every configuration change:

1. Start the exact-SHA Render/hosted consumer with
   `RUNNER_EXECUTION_ENABLED=true`.
2. Re-enable the reviewed GitHub recovery workflow and automatic dispatch
   source only if both are still part of the approved topology.
3. Set the master ceiling to
   `PROOFWEAVE_CONTROL_PLANE_MODE=read_write` while both surface modes remain
   `read_only`. Verify that MCP and participant mutation probes still return
   503 and durable counts remain unchanged.
4. Set `PROOFWEAVE_MCP_CONTROL_PLANE_MODE=read_write`. Verify one bounded MCP
   mutation, confirm participant mutation remains blocked, and observe its
   durable record.
5. Set `PROOFWEAVE_PARTICIPANT_CONTROL_PLANE_MODE=read_write`. Verify one
   bounded participant mutation and observe its durable record.
6. Re-enable Render auto-deploy only after confirming it is pinned to the
   reviewed main branch policy and cannot deploy an older commit.

Observe queue depth, leases, trigger failures, sequencing conflicts, wake
events, and terminal Run events through the full monitoring window. Any old
writer error or NULL sequence attempt requires an immediate refreeze.

## Failure boundaries and recovery

The release commander must choose the applicable boundary; never improvise a
schema downgrade.

| Failure point | Required response |
| --- | --- |
| Before migration starts | Keep or restore the old release only after confirming the database was unchanged; otherwise remain frozen |
| Migration plan differs from the reviewed plan | Abort without apply; investigate from the frozen state |
| Migration fails before completion | Keep every writer frozen; database owner determines whether the transaction was atomic and verifies the ledger before any next action |
| Migration succeeds but deployment fails | Do not restart an old writer; repair or deploy a descendant of `RELEASE_SHA` that understands `event_sequence` |
| Strict manifest is invalid | Remain frozen and correct the deployment or observation; do not override validation |
| Controlled smoke fails | Disable the controlled consumer, preserve the Run and events, and roll forward from the sequenced schema |
| Master ceiling opens both write surfaces | Immediately return the master ceiling to `read_only`; the split-fence release is invalid and must roll forward before retry |
| MCP unfreeze changes participant behavior | Return MCP and master modes to `read_only`, preserve evidence, and repair the surface routing before retry |
| Participant unfreeze fails | Return participant mode to `read_only`; keep the already reviewed MCP state only if incident ownership explicitly accepts that bounded state, otherwise refreeze the master ceiling |
| Failure after public unfreeze | Refreeze producers then consumers, preserve all append-only evidence, and reconcile by existing idempotency keys |

Once `0043` has succeeded, roll-forward is the default and safest recovery.
Dropping the trigger, deleting event rows, renumbering legacy rows, deploying
an old writer, or restoring an old snapshot over a database that received any
post-backup write is prohibited.

A snapshot restore is permitted only when all writers have remained frozen
since the snapshot, the database owner proves that no post-backup write exists,
the incident owner approves the data-loss boundary, and the restore targets an
isolated database first. If any sequenced event has been accepted after the
snapshot, do not restore it over production.

## Required release record

Close the cutover only after the record contains:

- named owners and UTC timestamps for every phase;
- governance mode, release tier, and the exact acceptance-artifact hash;
- full `RELEASE_SHA` and exact deployed revisions;
- producer/consumer freeze evidence and the separately observed master, MCP,
  and participant unfreeze steps;
- pre/post queue counts and active-lease count;
- backup identifier and restore owner;
- migration plan, apply, verify, schema-object, and anomaly-query results;
- strict manifest plus content hash;
- health observations and controlled smoke correlation ID;
- post-unfreeze monitoring result;
- any exception, failed probe, or retained queued Run.

No item in this record is a mathematical verification or Contribution Receipt.
Only the `independent_observer` governance path contains an independent
operational review, and even that does not substitute for claim-specific
different-Person mathematical review.
