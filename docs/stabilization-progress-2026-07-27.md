# Proofweave stabilization progress

Status: active execution record

Branch: `codex/stabilization-m0`

Main baseline: `1c7b6b4666a2b270b9d5d084d4cbe2f2ac768fa8`

This document records evidence for each stabilization acceptance gate. A phase
is not complete merely because its implementation exists; its stated checks
must pass against the same source revision.

## M0 — Source of truth and release manifest

Status: post-rebase repository acceptance passed; hosted CI, merge, and release
parity pending

### Completed

- Confirmed `3d629e2` and `a564dae` have the same stable patch ID.
- Created an isolated stabilization worktree.
- Fetched and rebased the stabilization branch onto `origin/main@1c7b6b4`;
  the canonical clean `main` worktree still needs its final fast-forward before
  release verification.
- Recorded worktree purposes and disposition.
- Added a privacy-minimal offline release manifest.
- Added strict fail-closed revision, template, image, and migration checks.
- Added eight release-manifest regression tests.
- Synchronized the Drizzle queue-event projection with migration `0043`,
  including nullable legacy sequences, a positive-value constraint, and the
  partial per-Run unique index.
- Added the required stop-the-world
  [`0043` cutover runbook](runner-queue-0043-cutover-runbook.md). It makes the
  producer freeze, drain, consumer freeze, backup, migration, exact-SHA deploy,
  strict manifest, controlled smoke, recovery boundary, and named approvals
  explicit.
- Confirmed the public Runner reports ready at revision `1c7b6b4` with the
  approved Lean/Mathlib image policy.
- Confirmed the current Sites production version is 143 at source
  `f05dc40dd91a49761cd19e9fa36d5d2d96b58001`.

### Current release-parity result

The product is intentionally **not** marked as one aligned release:

```text
origin/main       1c7b6b4
hosted Runner     1c7b6b4 (ready; no current-instance wake recorded)
Sites version 143 f05dc40
```

Gateway revision and deployed database migration head are not yet exposed as
non-secret release inputs. The strict manifest must remain invalid until those
values and the Sites revision align. The Runner also reports `lastWakeAt: null`,
so this is source parity, not a completed live execution.

### Validation evidence

- Release manifest tests: 8/8 passed.
- Actions budget policy tests: 9/9 passed.
- The independent PR fast gate passed in approximately 20 seconds locally;
  it excludes build, Miniflare/D1 integration, and network suites.
- Workspace protocol/runtime tests: 12/12 passed.
- Connector tests: 13/13 passed when the test environment permits loopback.
- Targeted ESLint and TypeScript: passed.
- Runner suite: 93/93 passed on each accepted post-rebase full run.
- Run store: 13/13 passed, including legacy result timing and late-event
  rejection.
- Verification stores: 16/16 passed, including guarded projection races and
  exact immutable history gates.
- Receipt store: 9/9 passed.
- Remote MCP gateway: 55/55 passed.
- Queue lifecycle test: 50/50 final repetitions passed after the atomicity
  changes, in addition to the queue checks inside both full runs.
- Two consecutive complete `npm run check` executions passed against
  `origin/main@1c7b6b4`, including clean production builds, the dependency
  security gate, Miniflare/libSQL integration, MCP gateway, and rendered HTML.
- `git diff --check`: passed.
- A bounded secret-pattern scan of the final diff found no credential material.

### Security gate discovered during full check

The first full check found production high-severity advisories in:

- `next@16.2.10`;
- E2B's `glob -> minimatch -> brace-expansion@5.0.7`.

The candidate fix is intentionally bounded:

- Next `16.2.12`;
- React/React DOM/RSDW `19.2.8`;
- `@vitejs/plugin-rsc@0.5.30`;
- `eslint-config-next@16.2.12`;
- E2B remains `2.35.0`;
- transitive `brace-expansion@5.0.8`;
- transitive `tar@7.5.22`.

After the lock refresh, `npm audit --omit=dev --audit-level=high` exits
successfully with zero high-severity production findings. Two related moderate
findings remain in the MCP SDK's unused Hono static-server path; they must not
be force-overridden across a declared major-version boundary without separate
transport testing.

### Accepted implementation commits

```text
c8187e0 Add fail-closed release manifest and secure dependencies
92817d4 Make runner lifecycle ordering deterministic
522120d Bound GitHub Actions usage
a49a88f Split fast PR and full release gates
```

The branch diff contains no duplicate `3d629e2` workspace patch.

### Post-rebase truth-boundary hardening

Independent read-only audits after the `1c7b6b4` rebase found correctness
boundaries that must close before this branch is mergeable:

- migration `0043` now rejects new queue events without `event_sequence`, so
  an old writer fails closed instead of appending reorderable NULL events;
- a partially configured Turso authority now fails closed instead of silently
  splitting writes into Sites D1;
- evidence summaries, details, outputs, replay eligibility, and downloads are
  scoped by Bundle manifest hash rather than only by Attempt;
- positive `bundle_reproducible` and `kernel_accepted` attestations require an
  exact fresh replay from the assigned independent review Agent;
- attestation, assignment projection, and immutable assignment event are one
  atomic batch;
- Run and queue lifecycle projections, results, and immutable events now commit
  atomically; guarded conflicts abort the whole batch and exact canonical
  retries repair only bounded legacy partial state;
- Receipt issuance re-verifies completed assignments, signed attestations,
  reviewer ownership, Agent/Person key fingerprints, delegation authority,
  revocation time, effective claim decisions, and publication side effects.

Independent correlation and concurrency reviews returned `GO`. Negative
fixtures, two full checks, and repeated queue tests passed. The remaining
repository step is to record these reviewed changes in bounded commits and
update the draft PR. The cutover runbook is now present, but executing it and
all remaining release steps are external gates.

### Open before release acceptance

- Merge the reviewed stabilization branch.
- Name the cutover owners and execute the
  [`0043` cutover runbook](runner-queue-0043-cutover-runbook.md); this is not a
  rolling deployment.
- Freeze producers before merge-triggered deployments, drain and freeze
  consumers, back up Turso, apply `0043`, and deploy Sites, gateway, and every
  Runner from one merged SHA while writes remain frozen.
- Supply their non-secret revision fields to strict release-manifest mode.
- Require strict manifest state `valid`, one persisted controlled smoke, and
  named approval before unfreezing. The current inspection state remains
  intentionally incomplete before deployment.

## M1 — Budget-safe and deterministic delivery

Status: first local slice accepted; full M1 acceptance pending

### Work items

- Reimplement the Actions budget policy on current main.
- Remove every-five-minute idle E2B polling.
- Cancel superseded CI and image jobs.
- Add a policy regression test.
- Fix nondeterministic queue event ordering exposed by repeated full checks.
- Close Hosted Runner services in test cleanup even when a test assertion or
  network call fails, preventing orphaned local listeners.
- Re-run the complete check more than once to detect test flakiness.

### Acceptance

- One PR has at most one active Check.
- Documentation-only changes skip the full application Check.
- E2B recovery sweep runs at most every six hours.
- Repeated queue lifecycle tests preserve the same event order.
- Two consecutive full local checks pass.
- The latest main eventually obtains a real hosted green Check after Actions
  allowance is available.

The repository implementation passes its local acceptance conditions. Full M1
still requires two external/account-level actions:

- configure and document the GitHub account's monthly Actions budget/usage
  alert; repository YAML cannot set account billing policy;
- merge the reviewed workflow change and obtain one exact-SHA hosted green
  Check after GitHub restores Actions allowance.

## M2 — Current live closure

Status: blocked on merge/deployment and a correlation-linked live execution

No live Bundle will be queued until:

- source revision is explicit;
- delivery policy is reviewed;
- full checks pass;
- release manifest records the exact Runner/template/image/migration inputs.

The M2 acceptance remains one correlation-linked path from local Agent through
Receipt and Credit, including a different-owner review and offline portable
verification. The Runner is ready, but `lastWakeAt: null` means readiness is
not proof of a completed execution. Before queueing that fixture, deploy
migration `0043` through the
[`0043` cutover runbook](runner-queue-0043-cutover-runbook.md) and obtain a
strict release manifest for the same merged SHA.
