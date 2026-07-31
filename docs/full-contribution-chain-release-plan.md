# Proofweave full contribution-chain release plan

Status date: 2026-07-31
Release posture: production writes remain frozen until every release gate below
has recorded evidence.

## Active execution board

| Gate | Current repository evidence | Decision |
| --- | --- | --- |
| Ordinary-user UI and read-only boundary | Candidate changes implemented; independent audit found no private research-store read before maintenance guards | validating |
| UI Lean truthfulness | One weak duplicate acceptance predicate found and replaced by the shared strict predicate | validating |
| Single-maintainer executable chain | Local Miniflare D1/R2, primary Lean Run, two fresh Lean replays, signed test reviews, and signed test Receipt pass through one bounded command | complete for isolated test only |
| PITR clone rehearsal | 0043 applied and queue-sequence smoke passed on the isolated clone | complete for rehearsal only |
| Production cutover evidence | Offline fail-closed verifier implemented; live evidence not yet collected | blocked |
| Cutover acceptance | `solo_alpha` may authorize only a `public_alpha` infrastructure cutover; stable still requires a genuinely different accountable observer | bounded alpha path available |
| Same-SHA read-only deployment | Must be recollected after the split-fence release is deployed; the hosted Render Runner remains a separate provider gate | incomplete |
| Credentialed Person A → Person B smoke | Offline evidence-graph verifier implemented; no real production smoke performed | pending deployment and two people |
| Public Receipt verification | Requires the real credentialed smoke | pending |

The executable test and deterministic release tools are:

- [`run-solo-contribution-smoke.mjs`](../scripts/run-solo-contribution-smoke.mjs)
  for the real local Lean and test-Receipt chain owned by one maintainer;
- [`check-production-contribution-cutover.mjs`](../scripts/check-production-contribution-cutover.mjs)
  for the frozen 0043 cutover evidence;
- [`check-credentialed-contribution-release.mjs`](../scripts/check-credentialed-contribution-release.mjs)
  for the redacted evidence graph from a real two-Person smoke; and
- [`check-ordinary-user-release.mjs`](../scripts/check-ordinary-user-release.mjs)
  for unauthenticated, read-only public preflight.

The production cutover and credentialed-release checkers do not create
evidence; they reject incomplete or internally inconsistent evidence collected
from authoritative services. The solo smoke intentionally creates only
temporary, explicitly labelled test evidence in a local Miniflare authority,
which disappears with the test process.

## Phase 0 — Single-maintainer executable gate

Before a cloud or production smoke, run:

```bash
npm run smoke:solo-contribution
```

This must complete the real local Bundle, primary Lean Run, two claim-specific
fresh Lean replays, signed test attestations, and signed test Receipt. Generated
mock Persons exercise ownership separation in the protocol, but their keys are
controlled by one process, so this is not independent human review or public
credit. See [the owner-controlled smoke contract](solo-contribution-smoke.md).

## What “the full chain works” means

Proofweave may describe the contribution chain as working only after one fresh
researcher and one different Person complete this sequence against the same
production release:

```text
Pinned target
  -> Person A signs in
  -> Person A connects a research Agent
  -> bounded Attempt
  -> owner-approved checkpoint and Artifact Bundle
  -> isolated Lean Runner result
  -> Person B accepts an independent-review assignment
  -> Person B signs a claim-specific decision
  -> Contribution Receipt
  -> public signature, hash, and dependency verification
```

A readable website, a successful repository test, a pre-existing demo, or a
Lean-accepted Run is not sufficient on its own.

## Current recorded state

The repository currently records:

- production control-plane mode `read_only`;
- production migration head
  `0042_add_jacobian_counterexample_audit.sql`;
- frozen production Runner consumers;
- a successful isolated PITR-clone rehearsal of
  `0043_add_runner_queue_event_sequence.sql`;
- a successful clone-only sequenced queue smoke; and
- no authorization yet for the production migration or public unfreeze.

See [the isolated-clone rehearsal](0043-clone-rehearsal-2026-07-29.md) for the
recorded evidence. Re-check live provider state before relying on any of these
facts in a release decision.

## Phase 1 — Candidate closure

### Work

1. Integrate the ordinary-user journey, read-only fail-closed surfaces, exact
   Attempt reconnect routing, and truthful Lean-versus-credit language.
2. Add deterministic public preflight and credentialed-chain evidence
   validation.
3. Run build, lint, typecheck, Worker rendering, read-only journey, and release
   gate tests.
4. Commit and push one candidate branch.
5. Review the complete diff and record the full candidate commit SHA.

### Exit criteria

- the worktree is clean;
- every intended file belongs to the candidate;
- no production credential or private URL is present;
- required checks pass from the committed SHA; and
- the candidate has review evidence.

## Phase 2 — Freeze and cutover authorization

Follow the
[0043 cutover runbook](runner-queue-0043-cutover-runbook.md). Before touching
production, record named people for:

- release commander;
- database owner;
- Runner owner;
- incident owner;
- Sites participant owner;
- MCP gateway owner;
- cutover acceptor.

One person may perform several operator roles. For `solo_alpha`, the release
commander may also be the cutover acceptor only for the explicitly labelled
`public_alpha` infrastructure release, with the limitation bound to the exact
evidence artifact. A `stable` release still requires an independent observer
who is a different accountable Person. A second account owned by the same
Person never creates independence, and neither governance path substitutes for
different-Person mathematical review of a certified Receipt.

### Exit criteria

- every public and Agent-originated mutation probe fails closed;
- Run, queue-message, and queue-event counts remain stable;
- active leases equal zero;
- every consumer and alternate writer is frozen;
- provider-side permissions and workflow closures have been inspected;
- the selected cutover acceptor has accepted the exact evidence artifact; and
- `solo_alpha` evidence explicitly states that it authorizes infrastructure
  only and does not constitute independent review.

## Phase 3 — Production migration

### Work

1. Create a fresh quiescent PITR recovery point or confirm that the recorded
   recovery point is still within its provider retention boundary.
2. Re-sample stable production counts and migration head.
3. Plan, apply, and verify migration `0043` exactly once.
4. Verify the column, index, trigger, legacy NULL rows, positive-sequence
   invariant, and absence of duplicate `(run_id, event_sequence)` pairs.

### Exit criteria

- the production ledger head is exactly
  `0043_add_runner_queue_event_sequence.sql`;
- the schema objects match the reviewed migration;
- legacy evidence has not been rewritten;
- no old writer is running; and
- the rollback/roll-forward owner has acknowledged the post-migration
  boundary.

The July 29 clone rehearsal proves that the reviewed migration can work in
isolation. It is not the fresh recovery point required for a later production
window.

The production cutover gate is deliberately split at the migration boundary.
Its v4 verdict authorizes only the next controlled action while production is
still at 0042 and frozen. Applying 0043 requires that passing pre-migration
record; deploying or enabling any writer additionally requires a new,
separately accepted post-migration record under the same governance mode. One
evidence document cannot claim both states.

## Phase 4 — Same-SHA deployment while read-only

Deploy the website, OAuth/MCP gateway, hosted Runner, Runner image, and E2B
template from one reviewed release record. Keep the explicit global write
ceiling, MCP surface fence, and participant surface fence at `read_only`, and
keep Runner execution off.

### Exit criteria

- every surface reports the same full commit SHA;
- Sites, gateway, and Runner report the same Turso database fingerprint;
- live diagnostics report migration head `0043`;
- the strict release manifest is valid;
- the strict manifest records explicit valid values for the global, MCP, and
  participant modes;
- public reads, OAuth discovery, and health endpoints work; and
- durable counts remain unchanged.

## Phase 5 — Controlled Runner smoke

While public producers remain frozen:

1. enable exactly one reviewed Runner consumer;
2. submit one operator-owned Lean fixture;
3. verify one accepted isolated replay;
4. verify consecutive positive queue-event sequences;
5. verify Bundle, request, result, output, and signature hashes; and
6. stop the consumer again.

### Exit criteria

- the controlled Run reaches the expected acknowledged terminal state;
- no NULL or duplicate sequence is produced;
- strict release diagnostics remain valid; and
- the correlation ID and non-secret evidence are preserved.

## Phase 6 — Staged unfreeze

After post-migration acceptance under the same governance mode, open production
in separately observed steps:

1. start the exact-SHA reviewed Runner consumer;
2. set the global write ceiling to `read_write` while MCP and participant
   surface modes remain `read_only`, and prove both write probes stay blocked;
3. set MCP to `read_write`, perform one bounded Agent-originated mutation, and
   prove participant mutation remains blocked; and
4. set participant mode to `read_write`, perform one bounded browser mutation,
   then begin the monitoring window.

Any surface that opens before its step requires immediate refreeze. Automatic
deployments remain disabled until this staged unfreeze and first-user smoke
complete.

## Phase 7 — Credentialed ordinary-user and two-Person smoke

### Researcher Person A

1. Open one pinned public target.
2. Sign in through the supported provider.
3. Install and connect a local research Agent through browser approval.
4. Create a bounded Attempt.
5. Record one owner-approved checkpoint.
6. Stage one reproducible Artifact Bundle.
7. Request and receive one isolated Lean result.

Completion through this point establishes the bounded
`ordinary-user research ready` state: a real user can connect an Agent, record
approved evidence, and receive a truthful Lean result. It does not establish
novelty, independent review, credit, or a Contribution Receipt.

### Reviewer Person B

1. Sign in as a different Person.
2. Connect a review-scoped Agent.
3. Accept the exact Bundle's independent-review assignment.
4. Inspect controlled evidence and perform the required independent replay.
5. Sign one claim-specific decision.

### Receipt

1. Confirm every required gate refers to the same Attempt and Bundle.
2. Issue the Contribution Receipt.
3. Verify its issuer signature, content hash, owner attribution, Agent
   delegation, review ownership separation, and dependency links through the
   public endpoint.

### Exit criteria

- Person A and Person B are different owners;
- neither Person's private Agent key leaves their machine;
- every state transition is durable and idempotent;
- the Receipt is publicly re-verifiable; and
- the evidence record contains no prompt, private workspace, token, or secret.

Observe queue depth, leases, sequencing failures, OAuth failures, Runner
terminal events, review completion, and Receipt verification throughout the
release window. Any old-writer or NULL-sequence attempt requires immediate
refreeze.

## Ordinary-user product contract

The interface should present five owner-side steps:

1. Choose a question.
2. Connect your Agent.
3. Research locally.
4. Approve evidence.
5. Lean verification.

Independent review and Receipt issuance follow these owner-side steps. The UI
must never imply that Lean acceptance alone creates authorship, novelty,
independent verification, credit, or a Contribution Receipt.

## Release decision

The release is:

- **blocked** if any evidence is missing or any surface reports a different
  SHA, database authority, migration head, or operation mode;
- **read-only ready** when the same-SHA deployment and non-mutating checks
  pass; and
- **ordinary-user research ready** only after a real Person A completes Agent
  connection, Attempt, approved Bundle, and isolated Lean result against the
  opened production release; and
- **certified contribution ready** only after a genuinely different Person B
  completes the required review and the resulting Receipt passes public
  verification.
