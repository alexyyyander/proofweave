# Proofweave stabilization and closed-alpha plan

Status: active; M0/M1 repository implementation accepted locally

Baseline after M0/M1 rebase: `origin/main@8fc525bc39eea4f02ab902aec0de286472912e6f`

Prepared: 2026-07-27

## 1. Purpose

Proofweave now has the components of a real local-first formal-mathematics
network: browser identity and delegation, a local Codex connector, signed
evidence Bundles, shared Turso/D1 state, a hosted trusted Runner, isolated E2B
Lean execution, independent-review records, Contribution Receipts, and
receipt-derived Credits.

The next milestone is not another broad feature expansion. It is a stable,
observable, repeatable closed-alpha loop:

```text
Person approves a delegated local Agent
  -> local Codex works in a private Lean workspace
  -> the owner publishes one signed minimal Bundle
  -> the shared control plane queues one authenticated Run
  -> the hosted Runner leases it and starts one fresh E2B sandbox
  -> Lean produces one signed, evidence-bound result
  -> a different owner performs a fresh independent review
  -> the issuer creates one policy-valid Contribution Receipt
  -> the credited Person and downstream dependency graph update
```

This plan turns that loop into the release proof for the closed alpha.

## 2. Current baseline

### Working

- Public catalog, history, evidence index, deterministic verifier, and tamper
  rejection are online.
- Person keys, Agent keys, revocable delegation, OAuth 2.1 PKCE, Attempt,
  research DAG, Bundle, Run, review, Receipt, and Credit protocols exist.
- Turso/libSQL provides a shared authority across browser, MCP, Runner, review,
  and Receipt services.
- The Render-hosted trusted Runner exposes bounded status at `/healthz`; at
  the final M0/M1 audit it reports the current main revision but is degraded
  with `e2_bsandbox_container_error`.
- The Runner policy approves the pinned Lean 4.31.0 / Mathlib image.
- E2B is configured as the active isolated execution provider.
- Dead-letter redrive, stale-lease fencing, retry classification, policy-drift
  diagnostics, and bounded result buffering are present on `origin/main`.

### Not yet proven as one current release

- The latest deployed Runner instance reports `lastWakeAt: null` and has not
  exposed a completed, correlation-ID-linked wake-to-Receipt trace.
- GitHub-hosted CI has not executed successfully against recent mainline
  changes because the private-account Actions allowance is exhausted.
- The former local `3d629e2` Runner workspace fix is patch-identical to
  `origin/main@a564dae` and must not be integrated a second time. Stabilization
  work now runs in the isolated `codex/stabilization-m0` worktree.
- Public product pages do not yet expose the full Run lifecycle or enough
  evidence to distinguish waiting, cold start, Lean execution, review, and
  issuance delays.
- Closed-alpha participation still depends on operator knowledge and a
  macOS/Apple-silicon private-beta installation path.

## 3. Problem register

| ID | Priority | Problem | Consequence | Exit condition |
| --- | --- | --- | --- | --- |
| DEL-01 | P0 | GitHub Actions allowance is exhausted | Red checks are billing/limit failures, not code feedback | One latest-main Check completes successfully after a budget-safe workflow policy is active |
| DEL-02 | P0 | CI runs on every branch push, PR, and main merge | A single change can pay for the same full check three times | PR and main are the only normal full-check triggers; superseded jobs cancel |
| DEL-03 | P0 | E2B Actions recovery sweep runs every five minutes | Continuous idle usage duplicates the hosted Runner | Repository dispatch/hosted wake is primary; recovery sweep is at most every six hours |
| DEL-04 | P0 | Runner image workflows consume long Linux jobs | Routine pushes can spend tens of minutes rebuilding unchanged images | Images build only after relevant recipe/toolchain changes or explicit dispatch |
| E2E-01 | P0 | No current-release end-to-end trace | Components can be online while the actual product loop is broken | One immutable trace links OAuth Agent, Attempt, Bundle, queue lease, sandbox, signed result, review, Receipt, and Credit |
| E2E-02 | P0 | Hosted Runner health shows no wake after the current instance start | Control-plane-to-Runner wake is not operationally evidenced | Authenticated wake changes health/metrics state and closes an actual queued Run |
| SRC-01 | P0 | Several worktrees and deployment histories exist, and the shared root was switched by another task during M0 | Local testing can validate a different product than the deployed mainline | One documented canonical main worktree tracks current main; stabilization and other tasks use isolated worktrees |
| REL-01 | P0 | Site, gateway, Runner, template, and image revisions are not presented as one release | Operators cannot quickly prove deployment parity | Release manifest records Git SHA, Sites version, gateway revision, Runner revision, E2B template build, image digest, and migration head |
| OBS-01 | P1 | No user-visible Run timeline | Waiting looks like failure and retries look like duplicate work | UI and API expose bounded state transitions with timestamps and safe reason codes |
| OBS-02 | P1 | Logs are distributed across Sites, Worker/Render, Turso, E2B, and GitHub | Diagnosis requires manual cross-service searching | Every Run carries one correlation ID through structured privacy-minimal events |
| OBS-03 | P1 | `/health` and `/healthz` expectations differ | Monitoring and operators can report a false outage | All docs, probes, and links use `/healthz`; readiness and liveness semantics are documented |
| QUE-01 | P1 | Queue, retry, and dead-letter recovery are implementation features rather than an operator workflow | Stuck Runs require code-level intervention | Operator dashboard/CLI can inspect leases, classify failure, and redrive or terminate idempotently |
| TST-01 | P1 | `npm run check` is a single broad 3.5–4 minute gate | Fast feedback and release verification have the same cost | Fast PR gate and full release gate are separate and both documented |
| TST-02 | P1 | Recent mainline changes lack hosted-CI evidence | A green historical run can be mistaken for current assurance | Latest release manifest links to exact successful checks and a fresh hosted end-to-end run |
| ARCH-01 | P1 | E2B, Modal, Cloudflare Containers, GitHub Actions, and Render paths coexist | Operational ownership and failure diagnosis are ambiguous | Render control process + E2B sandbox is the alpha reference path; other providers are adapters, not active paths |
| DAT-01 | P1 | D1-inline evidence is capped at 1 MB per object | Larger reproducible workspaces cannot be admitted | UI rejects oversized objects before upload and documents the limit; external object storage has a versioned later migration path |
| DAT-02 | P1 | Shared Turso migrations and backups are operational dependencies | A schema mismatch or failed migration can split the control plane | Migration head is checked at startup; backup and restore are exercised against a non-production database |
| SEC-01 | P1 | Runner, issuer, OAuth, and wake secrets span several providers | Rotation errors can stop issuance or accept the wrong signer | Key inventory, owner, rotation date, revocation drill, and public-key consistency check exist |
| SEC-02 | P1 | Participant recovery and cross-device key rotation are incomplete | Losing a browser/device can strand a Person identity | Closed-alpha recovery policy is explicit and tested before external onboarding |
| SEC-03 | P1 | Public write paths require abuse and capacity controls | A public beta could exhaust Runner or storage resources | Per-Person quotas, bundle-size limits, rate limits, cancellation, and incident controls are measured and tested |
| REV-01 | P1 | Demo mock owners prove separation but are not real reviewers | Viewers may confuse protocol exercise with community validation | UI labels mock review everywhere; closed alpha completes at least one different-real-owner review |
| UX-01 | P1 | Technical statuses do not consistently explain what has and has not been verified | Users can mistake `shared`, `succeeded`, or `issued` for mathematical acceptance | Every status has a plain-language meaning, next action, evidence link, and explicit non-claim |
| UX-02 | P1 | Local Agent installation is still private-beta and platform-specific | A new mathematician cannot begin without operator help | Supported environment check, one approved install flow, connection test, and recovery guidance fit in one onboarding path |
| UX-03 | P1 | Verification feedback emphasizes summary counts | “6/6” does not itself demonstrate what ran | Re-check UI shows check name, input hash, verifier, timestamp, duration, and bounded output or reason |
| DOC-01 | P1 | `development-plan.md` and `closed-alpha-runbook.md` contain pre-hosted-Runner claims | Documentation contradicts production | One current status document is authoritative; stale statements are removed or marked historical |
| DOC-02 | P1 | Demo fixture, hosted network proof, and participant flow are described across several documents | Operators can present the wrong evidence path | One release runbook links each claim to its exact source and deployed record |
| HIST-01 | P2 | Historical imports and research DAG branches need stronger curation rules | Imported prior work can appear as new Proofweave contribution | Imported sources retain original authorship, retrieval date, license, normalization provenance, and no automatic Credit |
| IMP-01 | P2 | Downstream impact and Credit policy are not yet mature | A single scalar score can distort mathematical contribution | Credits remain non-transferable and multidimensional; dependency impact is lifecycle-aware and auditable |
| SCALE-01 | P2 | Runner capacity and cost behavior have not been measured with several participants | Public launch could create unpredictable queue time or cost | A bounded load test establishes concurrency, p50/p95 latency, failure rate, and per-Run cost |

## 4. Scope control

### Required before closed-alpha expansion

- Delivery and CI recovery.
- One current-release end-to-end closure.
- Release manifest and deployment parity.
- Run timeline and minimum operational diagnostics.
- Queue/dead-letter operation.
- Truthful product statuses and onboarding.
- Key rotation, database recovery, and abuse controls.
- At least one different-real-owner review.

### Explicitly deferred

- Tradable token, wallet login, on-chain Gas, Paymaster, DEX, or governance.
- Public arbitrary-code execution.
- Universal novelty or authorship scoring.
- Automatic publication of private reasoning.
- Multiple active Runner providers.
- Unlimited evidence storage.
- Full public identity recovery or institutional identity federation.

Receipt-derived Credits remain non-transferable product records. Merkle
anchoring can be explored after the closed-alpha loop is reliable.

## 5. Execution plan

## Phase 0 — Preserve and align the source of truth

Estimated effort: 0.5–1 day

1. Record that `3d629e2` is superseded by patch-identical
   `origin/main@a564dae`; do not rebase, cherry-pick, or reopen it.
2. Preserve this plan and any other intended work in a named branch before
   changing worktrees.
3. Create or select one clean canonical release worktree at current
   `origin/main`.
4. Record all remaining worktrees, their branches, ahead/behind state, and
   intended owner in
   `docs/worktree-inventory-2026-07-27.md`.
5. Stop deploying from an unidentified dirty worktree.
6. Add a generated/read-only release manifest command.

Acceptance:

- `git status` is clean in the release worktree.
- The release worktree equals `origin/main`.
- No uncommitted user change is lost.
- A single command prints the complete deployable revision set.

## Phase 1 — Restore a budget-safe delivery pipeline

Estimated effort: 1–2 days, plus GitHub allowance availability

1. Rebase and review the Actions-budget branch against current `main`.
2. Apply the PR/main-only CI triggers, documentation path ignores, and
   concurrency cancellation from PR #88.
3. Reduce the E2B recovery sweep from every five minutes to at most every six
   hours; make hosted wake/dispatch the normal path.
4. Restrict image builds to relevant Dockerfile, toolchain, Mathlib, E2B
   template, or explicit manual changes.
5. Pin external Actions by immutable commit SHA.
6. Split checks:

   ```text
   PR fast gate
     -> lint
     -> typecheck
     -> changed protocol/unit tests

   main/release gate
     -> clean install
     -> full test suite
     -> production build
     -> security dependency audit
     -> route/demo/release checks
   ```

7. Add a monthly Actions budget policy and projected-usage alert.
8. Do not repeatedly re-run jobs while the account refuses to start them.

Acceptance:

- One PR produces at most one active PR Check.
- A superseding push cancels the older PR run.
- Documentation-only changes do not run the full application gate.
- Idle Runner recovery consumes no continuous five-minute workflow.
- Normal projected private-repository usage stays below 500 Actions minutes per
  month, excluding deliberate image releases.
- The latest `main` completes one exact-SHA full check.

## Phase 2 — Prove the current live loop

Estimated effort: 1–3 days

Use one bounded theorem fixture first, followed by one real participant-owned
Attempt.

1. Connect one local Codex Agent through browser OAuth and record the delegated
   Person, Agent, scope, and expiry.
2. Open one source-pinned Attempt.
3. Produce and owner-approve one minimal signed Bundle.
4. Verify all object hashes and reject any oversized or missing object before
   queueing.
5. Create one signed idempotent Run request.
6. Confirm the hosted wake endpoint receives the request.
7. Observe queue transitions:

   ```text
   queued
     -> leased
     -> preparing
     -> sandbox_starting
     -> running
     -> result_received
     -> result_verified
     -> succeeded | failed | timed_out | rejected
   ```

8. Confirm the E2B sandbox uses the approved image digest, exact Lean/Mathlib
   versions, no participant secrets, and the configured network policy.
9. Persist and independently re-verify the signed Runner result.
10. Assign a different Person owner for fresh replay/review.
11. Issue a Receipt only after all required policy gates close.
12. Project the Receipt into the Person profile and multidimensional Credit
    record.
13. Export a portable evidence closure and verify it offline.

Acceptance:

- One correlation ID retrieves the complete immutable path.
- Runner health shows a current wake and terminal Run.
- Repeating the same idempotency key does not create a second execution or
  Receipt.
- A one-byte Bundle mutation fails closed.
- Same-owner review is rejected.
- Receipt issuance is impossible before required review gates.
- Public Receipt, credited Person, dependency edges, and portable verifier
  agree on hashes and identities.

## Phase 3 — Make failures observable and recoverable

Estimated effort: 2–4 days

1. Define a privacy-minimal structured event schema:

   - correlation ID;
   - Run ID and opaque Attempt/Bundle references;
   - service and deployment revision;
   - state transition;
   - safe reason code;
   - start/end timestamps and duration;
   - retry attempt and lease owner;
   - image/template identifiers;
   - no tokens, source bytes, prompts, private reasoning, or private keys.

2. Add a user-visible Run timeline with four levels:

   - progress;
   - waiting/cold start;
   - retryable operational failure;
   - terminal evidence result.

3. Add operator views or commands for:

   - queue depth;
   - active lease and expiry;
   - last wake;
   - dead-letter count;
   - policy drift;
   - migration head;
   - Runner/template/image revision;
   - redrive with an explicit idempotency key.

4. Standardize health endpoints:

   - `/healthz` for process liveness/readiness;
   - a separate authenticated diagnostic projection for dependencies;
   - no operational secrets in either response.

5. Add alerts for:

   - queue age above threshold;
   - repeated startup timeout;
   - dead-letter arrival;
   - key mismatch;
   - database migration mismatch;
   - receipt issuance failure;
   - projected budget exhaustion.

Initial service targets:

- Wake acknowledgement: under 5 seconds when the service is warm.
- First visible state transition: under 10 seconds.
- Queue-to-running p95: under 180 seconds for the free-alpha deployment.
- No silently lost Run.
- Every terminal Run has a verified result or a bounded terminal reason.

These are initial engineering targets and must be replaced by measured values.

Acceptance:

- An operator can locate the cause of a failed Run without searching raw
  source artifacts or private logs.
- A participant can tell whether to wait, retry, reconnect, correct the Bundle,
  or contact the operator.
- A dead-letter Run can be safely redriven once without duplicate execution.

## Phase 4 — Simplify the participant product flow

Estimated effort: 3–5 days

1. Present one primary path:

   ```text
   Choose target
     -> Connect local Agent
     -> Work locally
     -> Review evidence to publish
     -> Submit
     -> Watch verification
     -> Inspect Receipt and Credit
   ```

2. Replace protocol-first setup fields with an environment check and browser
   approval. Keep manual public-key entry behind an advanced disclosure.
3. Add a connection self-test that confirms:

   - plugin installed;
   - OAuth grant valid;
   - Agent delegation active;
   - local workspace readable by the local Agent;
   - no private key or workspace upload occurred.

4. Give every status a consistent vocabulary:

   - `Local only`;
   - `Shared, not verified`;
   - `Bundle integrity checked`;
   - `Lean replay passed/failed`;
   - `Independent review pending/accepted/flagged`;
   - `Receipt issued`;
   - `Superseded/retracted`.

5. Upgrade verification feedback from a count to inspectable checks:

   - what was checked;
   - exact input hash;
   - verifier identity/key;
   - start/end time and duration;
   - bounded output;
   - what the result does not claim.

6. Keep deterministic demo evidence visually separate from live network
   evidence and real participant evidence.
7. Add an onboarding completion event and privacy-safe funnel metrics.

Acceptance:

- A first-time supported user can connect and stage a fixture Bundle without
  copying a key, token, source path, or configuration JSON.
- The user can abort before publication.
- The UI never calls a queued Run verified.
- Mock owners are visibly labelled at every surface.
- The user can inspect the exact reason and evidence behind every completed
  check.

## Phase 5 — Harden identity, data, and operations

Estimated effort: 4–7 days

1. Document and test key ownership and rotation for:

   - Person signing key;
   - Agent key and delegation;
   - OAuth client/installation credentials;
   - control-plane request signer;
   - Runner result signer;
   - Receipt issuer;
   - hosted wake token.

2. Run non-production drills:

   - revoke Agent delegation during an active Attempt;
   - rotate Runner key;
   - rotate Receipt issuer key;
   - lose a browser-held Person key;
   - restore Turso backup;
   - reject a stale migration;
   - expire a queue lease;
   - redrive a dead letter;
   - cancel a running sandbox.

3. Enforce and expose:

   - maximum Bundle/object size;
   - maximum active Attempts per Person;
   - maximum review assignments per Person;
   - maximum concurrent Runs;
   - rate limits and retry-after behavior;
   - retention and deletion rules for non-immutable operational data.

4. Review all public error responses for token, source, identity, stack trace,
   and provider-detail leakage.
5. Establish an incident owner and a single disable switch for new execution
   and issuance.

Acceptance:

- Rotation does not invalidate already verifiable historical evidence.
- Revoked keys cannot authorize new work.
- Backup restore reproduces the same immutable evidence hashes.
- An emergency stop prevents new execution and issuance without deleting prior
  records.
- Capacity limits fail clearly before provider cost is incurred.

## Phase 6 — Closed-alpha participant validation

Estimated effort: 1–2 weeks with user availability

Minimum cohort:

- project owner;
- one external mathematician or Lean user;
- one mathematics enthusiast using Codex but not authoring Lean manually.

Required exercises:

1. Local Agent installation and OAuth connection.
2. Continue an existing research branch.
3. Import one historical source with preserved prior authorship.
4. Submit one lemma or proof patch.
5. Submit one counterexample or failed-direction checkpoint.
6. Complete a different-owner review.
7. Inspect a Receipt and dependency edge.
8. Revoke and reconnect one Agent.

Measure:

- time to first connected Agent;
- time to first owner-approved Bundle;
- queue, cold-start, Lean, review, and issuance durations separately;
- failure and retry rate by reason;
- operator interventions per Attempt;
- user comprehension of each evidence status;
- uploaded bytes and provider cost per terminal Run.

Exit gate:

- At least ten consecutive bounded Runs complete without lost state.
- At least three complete Receipt closures succeed.
- At least one closure uses a real different Person owner.
- No critical identity, signature, isolation, or attribution defect remains.
- Median supported-user setup requires no operator shell command.

## Phase 7 — Public-beta preparation

Estimated effort: 2–4 additional weeks after closed-alpha exit

1. Decide public identity recovery and cross-platform support.
2. Establish participant Runner quotas and a cost ceiling.
3. Move large immutable artifacts to a reviewed content-addressed object store
   while retaining D1/Turso metadata and hashes.
4. Add moderation, abuse response, and public support procedures.
5. Load-test queue and sandbox capacity.
6. Publish protocol versioning and backward-compatibility rules.
7. Publish a truthful service-status page and incident history.
8. Decide whether Merkle epoch anchoring adds useful independent auditability.

No tradable token or Web3 settlement is required for this phase.

## 6. Recommended work order

```text
Source alignment
  -> Actions budget policy
  -> latest-main full check
  -> one traced live closure
  -> Run timeline and operator diagnostics
  -> onboarding/status simplification
  -> recovery, rotation, backup, and abuse drills
  -> real different-owner closed-alpha exercise
  -> bounded public-beta capacity work
```

Do not start participant growth, Token work, or another Runner provider before
the traced live closure and operational recovery gates pass.

## 7. Milestones and estimated calendar

| Milestone | Scope | Estimated effort |
| --- | --- | ---: |
| M0 Source of truth | Clean canonical worktree and release manifest | 0.5–1 day |
| M1 Delivery restored | Budget-safe CI and one current green main | 1–2 days |
| M2 Live closure | Local Agent through Receipt and Credit | 1–3 days |
| M3 Operable alpha | Timeline, diagnostics, DLQ recovery, alerts | 2–4 days |
| M4 Usable alpha | One primary onboarding and submission flow | 3–5 days |
| M5 Trustworthy alpha | Rotation, restore, limits, incident drills | 4–7 days |
| M6 External validation | Three-person bounded cohort | 1–2 weeks |
| M7 Public-beta readiness | Recovery, storage, capacity, support | 2–4 weeks |

M0–M2 are the immediate stabilization path. M3–M5 make the system safe and
understandable enough for a controlled external alpha. Estimates exclude
waiting for third-party allowance resets, provider approvals, or participant
availability.

## 8. Release checklist

A release may be called a current verified alpha only when all items below
refer to the same release manifest:

- [ ] clean source commit;
- [ ] successful fast and full checks;
- [ ] production dependency audit without known high-severity findings;
- [ ] current database migration head;
- [ ] deployed Site, gateway, Runner, template, and image revisions recorded;
- [ ] `/healthz` ready with approved policy;
- [ ] authenticated wake observed;
- [ ] one fresh isolated Lean replay completed;
- [ ] signed result independently re-verified;
- [ ] different-owner review policy satisfied;
- [ ] Receipt issued and portable closure verified;
- [ ] Credit projection agrees with the Receipt lifecycle;
- [ ] tamper test fails closed;
- [ ] retry/idempotency test creates no duplicate Run or Receipt;
- [ ] dead-letter and restore procedures exercised;
- [ ] mock/demo claims clearly separated from participant claims;
- [ ] rollback and emergency-disable owner identified.

## 9. Plan maintenance

After M2:

1. update `docs/development-plan.md` to describe the hosted Runner baseline;
2. update `docs/closed-alpha-runbook.md` to remove the obsolete “no Lean
   execution service exists” boundary;
3. make this plan the issue source for unfinished stabilization work;
4. link every completed item to a commit, test, deployment revision, or
   immutable Proofweave evidence record;
5. review priorities weekly and never mark a component-level test as an
   end-to-end release proof.
