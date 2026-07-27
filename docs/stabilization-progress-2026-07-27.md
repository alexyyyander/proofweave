# Proofweave stabilization progress

Status: active execution record

Branch: `codex/stabilization-m0`

Main baseline: `8fc525bc39eea4f02ab902aec0de286472912e6f`

This document records evidence for each stabilization acceptance gate. A phase
is not complete merely because its implementation exists; its stated checks
must pass against the same source revision.

## M0 — Source of truth and release manifest

Status: local acceptance complete; merge and release parity pending

### Completed

- Confirmed `3d629e2` and `a564dae` have the same stable patch ID.
- Created an isolated stabilization worktree.
- Fast-forwarded the canonical clean `main` worktree to `8fc525b`.
- Recorded worktree purposes and disposition.
- Added a privacy-minimal offline release manifest.
- Added strict fail-closed revision, template, image, and migration checks.
- Added six release-manifest regression tests.
- Confirmed the public Runner reports revision `8fc525b` and the approved
  Lean/Mathlib image policy.
- Confirmed the current Sites production version is 143 at source
  `f05dc40dd91a49761cd19e9fa36d5d2d96b58001`.

### Current release-parity result

The product is intentionally **not** marked as one aligned release:

```text
origin/main       8fc525b
hosted Runner     8fc525b (degraded: e2_bsandbox_container_error)
Sites version 143 f05dc40
```

Gateway revision and deployed database migration head are not yet exposed as
non-secret release inputs. The strict manifest must remain invalid until those
values and the Sites revision align. The Runner also reports `lastWakeAt: null`,
so this is source parity, not a completed live execution.

### Validation evidence

- Release manifest tests: 6/6 passed.
- Actions budget policy tests: 9/9 passed.
- The independent PR fast gate passed in approximately 20 seconds locally;
  it excludes build, Miniflare/D1 integration, and network suites.
- Workspace protocol/runtime tests: 12/12 passed.
- Connector tests: 13/13 passed when the test environment permits loopback.
- Targeted ESLint and TypeScript: passed.
- Runner suite: 89/89 passed on each accepted full run.
- Queue lifecycle test: 50/50 subagent repetitions plus 20/20 independent
  repetitions passed.
- Four complete `npm run check` executions passed; the final execution ran
  after the PR/full gate split and after rebasing onto
  `origin/main@8fc525b`.
- `git diff --check`: passed.

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
9f0f4d3 Add fail-closed release manifest and secure dependencies
a19a416 Make runner lifecycle ordering deterministic
5049e4c Bound GitHub Actions usage
0f12f22 Split fast PR and full release gates
```

The branch diff contains no duplicate `3d629e2` workspace patch.

### Open before release acceptance

- Merge the reviewed stabilization branch.
- Deploy Sites, gateway, Runner, and migration `0043` from one merged SHA.
- Supply their non-secret revision fields to strict release-manifest mode.
- Require strict manifest state `valid`; the current inspection state remains
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

Status: blocked on merge/deployment and degraded live Runner

No live Bundle will be queued until:

- source revision is explicit;
- delivery policy is reviewed;
- full checks pass;
- release manifest records the exact Runner/template/image/migration inputs.

The M2 acceptance remains one correlation-linked path from local Agent through
Receipt and Credit, including a different-owner review and offline portable
verification. Before queueing that fixture, resolve the live Runner
`e2_bsandbox_container_error`, deploy migration `0043`, and obtain a strict
release manifest for the same merged SHA.
