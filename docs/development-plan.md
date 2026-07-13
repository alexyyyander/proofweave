# Proofweave development plan

Status: implementation baseline, 2026-07-13

## 1. Alpha objective

The first alpha is complete only when one real contribution can pass through
the complete system:

```text
Pinned project revision
  -> delegated Agent attempt
  -> reproducible artifact bundle
  -> Lean build and kernel result
  -> independent owner review
  -> project acceptance
  -> contribution receipt
  -> dependency edge to later work
```

The alpha is not measured by number of Agent runs, generated proof lines, user
accounts, or famous conjectures listed. Its release proof is one accepted and
reusable contribution with evidence that an external maintainer can reproduce.

### Alpha non-goals

- token, bounty, marketplace, or payment flows;
- global leaderboard or one-dimensional contribution score;
- arbitrary user-provided container execution;
- every mathematical domain or proof assistant;
- ORCID and institutional integrations;
- public Agent chain-of-thought;
- automatic novelty or statement-fidelity claims.

## 2. Current engineering baseline

### Present

- Vinext/Next frontend deployed through Sites;
- public welcome, Explore, problem detail, protocol, receipt preview, and
  personal workbench routes;
- reusable navigation and workbench presentation modules;
- Cloudflare Worker-compatible build;
- optional Drizzle/D1 and Sites authentication helpers in the starter;
- responsive desktop and mobile presentation.

### Missing

- all catalog, receipt, delegation, and Agent data is preview data;
- `db/schema.ts` is empty;
- `.openai/hosting.json` declares neither D1 nor R2;
- the workbench does not require identity;
- no Agent key registration or delegation signing exists;
- no attempt, run, artifact, verification, or receipt API exists;
- no Lean execution service exists;
- no independent-review assignment logic exists;
- no immutable provenance/event model exists;
- no CI workflow or production observability exists.

### Immediate defect

`npm run build` succeeds, but `npm test` fails because the test suite still
asserts the deleted starter loading skeleton. Sprint 0 must replace these tests
before feature development starts.

### Sprint 0 progress

Implemented locally on 2026-07-13:

- replaced the deleted-starter assertions with rendered-route smoke tests for
  the welcome page, Explore, protocol, and workbench routes;
- added `lint`, `typecheck`, and `check` scripts, and fixed the Worker type
  boundary so TypeScript can check the application without a deployed D1
  binding;
- added a branch/PR CI workflow, safe local environment example, shared result
  type, and the four ADRs required by this plan;
- upgraded the welcome image to the platform image component to keep the lint
  baseline clean.

The workflow is ready for a GitHub-connected mirror. The current
Sites-controlled source repository does not execute GitHub Actions, so connect a
GitHub remote or equivalent CI provider before marking the “CI blocks a broken
build” exit criterion as achieved.

## 3. Architecture boundary

Lean execution must not run inside the web Worker. It requires a separately
deployed, container-isolated runner.

```text
Browser
  |
  v
Proofweave Web / Control API
  |- public catalog and receipts
  |- authenticated workbench and verification queue
  |- D1: relational state and append-only events
  |- R2: content-addressed bundles, logs, manifests
  `- Runner client: signed, idempotent job requests
          |
          v
Lean Runner Service
  |- pinned container image and toolchain
  |- network disabled during execution
  |- CPU, memory, time, and output limits
  |- clean workspace per job
  `- signed result manifest and artifact hashes
```

The verification runner uses the same bundle format but a fresh workspace and
separate job identity. An independent mathematical reviewer remains distinct
from the infrastructure runner.

### Initial deployment choices

- Web/control plane: retain the existing Vinext/Sites application.
- Metadata: use D1 for closed alpha, behind repository interfaces so storage is
  portable if later moved to PostgreSQL.
- Artifacts: use R2 with immutable content-addressed object keys.
- Runner: containerized service in the same monorepo but deployed separately.
- Queue: provider-neutral `RunnerQueue` interface; choose the concrete hosted
  queue in an architecture decision before Sprint 3.
- Authentication: use the existing Sites/ChatGPT identity for the closed alpha;
  introduce independent passkey/email authentication before public beta so a
  ChatGPT account is not a global participation requirement.

## 4. Proposed repository shape

Keep one repository for the alpha, with deployable boundaries kept explicit:

```text
app/                       web routes and UI
app/api/                   control-plane HTTP endpoints
db/                        schema, migrations, repositories
packages/domain/           entities, state machines, invariants
packages/protocol/         canonical JSON, hashes, signatures, bundle schemas
services/lean-runner/      containerized executor and result manifest
scripts/ingest/            pinned upstream ingestion
tests/unit/                domain and protocol tests
tests/integration/         D1, R2, and API tests
tests/e2e/                 user contribution and verification paths
tests/fixtures/lean/       small deterministic Lean projects
docs/adr/                  architecture decisions
```

UI components must consume typed domain/API objects. Preview records should not
remain as a second, incompatible data model after real APIs arrive.

## 5. Core domain model

| Entity | Purpose | Critical invariant |
| --- | --- | --- |
| `Person` | Root attribution identity | Agents never replace the Person root |
| `AuthIdentity` | Login provider mapping | Provider subject is unique |
| `Agent` | Registered delegated executor | Exactly one owner Person at a time |
| `DelegationCertificate` | Scope, key, beneficiary, validity | Immutable; revocation is a new event |
| `Project` | Curated research effort | Has explicit curators and policy |
| `ProblemRevision` | Informal and Lean target | Immutable and pinned to source/toolchain |
| `Attempt` | One bounded contribution attempt | References one revision and delegation |
| `Run` | One runner execution | Idempotent job key and immutable result |
| `ArtifactBundle` | Source, manifest, logs, dependency data | Content hash covers every required file |
| `VerificationAttestation` | One explicit verification claim | Claim type and verifier owner are explicit |
| `ContributionReceipt` | Accepted credited contribution | Issued only after policy gates pass |
| `DependencyEdge` | Mathematical downstream use | References immutable declarations/receipts |
| `AuditEvent` | Append-only state history | Never updated or deleted in place |

### Verification claims remain separate

```text
bundle_reproducible
kernel_accepted
statement_faithful
novelty_reviewed
project_accepted
```

No API or UI may collapse these into a single `verified: true` field.

### Owner-independence rule

A verification can satisfy an independence policy only when:

```text
attempt.person_id != verifier.person_id
```

Comparing Agent IDs is insufficient because one Person may operate many Agents.

## 6. Protocol and artifact requirements

Every submitted bundle must contain or reference:

```text
bundle.json
source tree or normalized patch
lean-toolchain
lake-manifest.json
target declaration and problem revision
declared dependency receipts
Agent event payload and signature
allowed axiom policy
expected entry command
```

The canonical protocol package owns:

- JSON canonicalization and schema versioning;
- SHA-256 content hashes;
- Agent signature verification;
- delegation validity checks at event time;
- replay protection and idempotency keys;
- receipt encoding and supersession links.

Cryptographic fields must not be assembled ad hoc inside React components or
route handlers.

## 7. Delivery phases

Calendar estimates assume one full-stack developer with regular Lean/infra
support. The dependency order is more important than the exact duration.

### Sprint 0 — engineering foundation (2–4 days)

Deliverables:

- replace starter README and package identity with Proofweave developer docs;
- replace stale skeleton tests with real route and accessibility smoke tests;
- make `build`, `lint`, and `test` required and green;
- add CI for every branch and pull request;
- create ADRs for storage, runner isolation, authentication, and signatures;
- add environment validation and safe local example values;
- add structured error/result types shared by routes.

Exit criteria:

- a clean checkout installs and passes all checks;
- no test references removed starter files;
- CI blocks a broken build or failing test;
- architectural decisions that affect data compatibility are recorded.

### Sprint 1 — real catalog and persistence (1 week)

Deliverables:

- enable D1 and R2 bindings;
- implement the initial schema and migrations;
- add repository interfaces and transaction boundaries;
- ingest one pinned Formal Conjectures snapshot with provenance and license;
- provide read APIs for projects, revisions, declarations, and status layers;
- replace `app/lib/content.ts` preview catalog data with API/repository reads;
- keep Practice records explicitly separate from frontier records.

Exit criteria:

- Explore and problem detail pages are rendered from persisted records;
- each problem displays source URL, source revision, retrieval time, content
  hash, license, Lean version, and Mathlib revision;
- re-running ingestion is idempotent;
- upstream changes create a new revision rather than mutating history.

### Sprint 2 — Person, Agent, and delegation (1 week)

Deliverables:

- protect personal workspace and write actions with authenticated identity;
- create Person records from the closed-alpha identity provider;
- register Agent IDs and public keys;
- create, select, expire, and revoke delegation certificates;
- implement scope enforcement for `formalize`, `prove`, and `review`;
- add a public human-readable delegation view and machine JSON representation;
- replace workbench preview identity with the authenticated Person and Agent.

Exit criteria:

- a Person can register an Agent and issue/revoke a scoped delegation;
- a revoked or expired delegation cannot create a valid attempt;
- server authorization uses persisted ownership, not client-provided Person IDs;
- historical delegations remain inspectable.

### Sprint 3 — attempt and Lean runner (2 weeks)

Deliverables:

- define the runner request/result contract and deterministic fixtures;
- implement the isolated Lean runner container;
- add attempt creation, bounded-run, pause, cancel, and status APIs;
- stream or poll structured events without exposing chain-of-thought;
- store source snapshots, manifests, logs, diagnostics, and hashes in R2;
- connect the workbench to real run state and compiler diagnostics;
- enforce CPU, memory, wall-time, disk, output, and concurrency limits;
- disable execution-time network access.

Exit criteria:

- a fixture project can compile in a clean runner from only its bundle;
- identical bundles produce the same manifest hashes;
- timeout, invalid source, forbidden axiom, and `sorry` cases fail explicitly;
- retrying an idempotent request does not create duplicate runs or charges;
- the web Worker never executes user Lean code directly.

### Sprint 4 — verification queue (1–2 weeks)

Deliverables:

- create verification assignments with owner-independence checks;
- replay submitted bundles in a fresh runner workspace;
- display source diff, declaration diff, environment, axioms, and build result;
- support separate reproducibility, kernel, statement, novelty, and project
  attestations;
- implement request-changes, reject, and conflict/flag flows;
- record reviewer signatures and append-only events;
- hide prior human attestations until submission where blind review is enabled.

Exit criteria:

- same-owner Agents cannot satisfy independent verification;
- a reviewer can reproduce a bundle without trusting submitter logs;
- each attestation identifies exactly what was checked;
- review decisions are auditable and cannot silently overwrite history.

### Sprint 5 — receipts and dependency DAG (1 week)

Deliverables:

- define receipt issuance policy per contribution type;
- issue canonical receipts only after required gates pass;
- replace the receipt preview with persisted evidence;
- record declaration-level dependency edges;
- add provisional immediate credit and downstream-use updates;
- add supersession, correction, and retraction events;
- provide JSON and downloadable bundle endpoints.

Exit criteria:

- a receipt hash changes if any covered evidence changes;
- a receipt links Person, Agent, delegation, target revision, bundle, claims,
  reviewers, and downstream dependencies;
- correction never deletes or rewrites the original receipt;
- a second system can verify receipt hashes without the Proofweave UI.

### Sprint 6 — closed-alpha hardening (1 week)

Deliverables:

- rate limits, quotas, abuse controls, and reviewer-capacity limits;
- structured logs, metrics, tracing, alerts, and job cost accounting;
- database backup/export and R2 retention policy;
- accessibility and keyboard audit for critical flows;
- threat-model review and dependency/security scanning;
- admin tools for quarantine, policy changes, and incident investigation;
- closed-alpha onboarding and operator runbook.

Exit criteria:

- one real contribution completes the full alpha objective;
- operators can explain every state transition from audit events;
- failure of runner, storage, or queue produces recoverable states;
- no preview label or mock identity remains in a production write flow.

## 8. Test strategy

### Unit

- state transitions and invalid transition rejection;
- delegation validity, scope, expiry, and revocation;
- canonical JSON, hashes, signatures, and replay protection;
- owner-independence and receipt issuance policies.

### Integration

- D1 repositories and migrations;
- R2 content-addressed upload and retrieval;
- API authentication, authorization, idempotency, and pagination;
- ingestion against a pinned small upstream fixture;
- runner request/result schema compatibility.

### Runner security and reproducibility

- success and compiler-error golden projects;
- timeout, memory, disk, output, and process limits;
- no-network enforcement;
- path traversal and symlink escape attempts;
- malicious archives and decompression limits;
- toolchain/manifest mismatch;
- axiom and `sorry` audits.

### End to end

1. sign in and create Person;
2. register Agent and delegation;
3. select problem revision;
4. run bounded attempt;
5. submit bundle;
6. assign a different-owner reviewer;
7. reproduce and attest;
8. accept contribution;
9. issue and inspect receipt;
10. add a downstream dependency and verify trace credit.

## 9. Security work that blocks public execution

The runner is a hostile-code boundary. Public execution is blocked until all
of these have evidence:

- container isolation and non-root execution;
- no host socket or cloud credentials in jobs;
- execution-time network disabled;
- archive extraction limits and path validation;
- resource and concurrency quotas;
- immutable base image and pinned toolchains;
- job/result authentication between control plane and runner;
- sensitive logs redacted;
- cancellation and orphan-job cleanup;
- abuse response and emergency runner shutdown.

Agent signatures prove which key signed an event. They do not prove the Agent's
reasoning quality, statement fidelity, novelty, or Person uniqueness.

## 10. Alpha metrics

Primary:

- accepted, downstream-used contributions per expert review hour.

Supporting:

- time from registration to first valid bounded attempt;
- first-pass bundle reproducibility rate;
- median runner completion and queue time;
- reviewer minutes per accepted and rejected submission;
- rejection reasons by gate;
- independent-review turnaround time;
- receipt issuance failures or disputes;
- downstream dependency count;
- retraction and supersession rate;
- participant and reviewer retention.

Attempt count, model tokens, GPU hours, and number of Agents are operational
metrics, not mathematical contribution metrics.

## 11. First implementation backlog

Execute in this order:

1. Replace the obsolete starter tests and restore a green `npm test`.
2. Rewrite README and package metadata for Proofweave.
3. Add CI for build, lint, tests, and migration checks.
4. Write ADR-001 storage, ADR-002 runner boundary, ADR-003 identity, and
   ADR-004 signing/canonicalization.
5. Define domain types and state machines without UI dependencies.
6. Implement D1 schema/migrations and repository tests.
7. Add a pinned, fixture-sized Formal Conjectures importer.
8. Replace preview Explore data with persisted read APIs.
9. Connect authenticated Person records and protect `/workbench` writes.
10. Specify the artifact bundle and runner API before implementing the runner.

Do not start the verification UI or receipt issuance implementation until the
bundle protocol and domain invariants are covered by tests.

## 12. Decision gates

Before Sprint 3:

- approve the runner hosting provider and queue;
- approve container isolation and cost limits;
- freeze bundle protocol v0.1.

Before Sprint 4:

- approve reviewer eligibility and independence policy;
- define which claims require a mathematician rather than infrastructure;
- define conflict and appeal handling.

Before public beta:

- choose independent passkey/email authentication;
- publish privacy, acceptable-use, contribution, licensing, and moderation
  policies;
- complete security review and external runner penetration testing;
- recruit real project curators and reviewers with an explicit service level.
