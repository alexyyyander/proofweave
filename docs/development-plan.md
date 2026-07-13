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
- public welcome, Explore, problem detail, protocol, issued-receipt display, and
  personal workbench routes;
- reusable navigation and workbench presentation modules;
- Cloudflare Worker-compatible build;
- D1 schema, generated migrations, and a D1 catalog repository;
- a pinned Formal Conjectures seed with source, license, toolchain, Mathlib,
  content-hash, and retrieval-time provenance;
- public catalog APIs for records and declaration-level detail;
- D1 data model for closed-alpha provisional Attempts and events;
- Ed25519 delegation protocol, immutable D1 records for Person keys, Agents,
  certificates, and revocations, plus closed-alpha owner APIs;
- OAuth PKCE/token-rotation protocol and D1 credential-hash persistence for
  Agent installations, authorization codes, access tokens, and refresh tokens;
- Lean runner v1 protocol for content-addressed bundles, pinned environments,
  resource limits, disabled networking, and evidence-bound results;
- artifact bundle v1 historical manifest plus v2 executable-workspace manifest
  that fixes archive, patch, Lake manifest, final tree, Lean environment,
  target, dependency receipts, Agent event signature, and axiom/sorry policy;
- immutable R2/D1 artifact store that verifies Agent signatures, delegation
  timing, referenced object hashes, and canonical bundle manifests;
- bounded Run state machine with idempotent request/result binding and
  cancellation acknowledgement semantics;
- signed RunnerQueue envelopes plus runner-side issuer-key allowlist
  verification for control-plane job authentication;
- Cloudflare Queue producer/consumer adapter, queued-job retry/DLQ template,
  and a no-Internet Cloudflare Container deployment policy for closed alpha;
- D1/R2 Runner Bundle resolver that re-hashes the canonical manifest and
  re-checks request-to-bundle/object binding before source transfer;
- Runner preflight and stager that bind an authenticated Queue delivery to
  exactly one persisted Run, then use retryable workspace preparation before a
  verified private handoff can transition it to `running`;
- deployment-owned pinned-image registry that binds image digests to exact
  Lean and Mathlib environments before a Run can be claimed;
- operator-managed runner-key allowlist with signed-result verification before
  immutable Run evidence is accepted;
- independent Person-level review assignments and review-delegated Agent
  attestations with immutable D1 audit events, plus an owner-scoped
  closed-alpha review queue for accept/decline decisions;
- a canonical signed Contribution Receipt protocol and conservative issuance
  policy plus internal immutable D1 issuance, dependency-edge projection, and
  signed append-only lifecycle events with read-only verified
  receipt/dependency/lifecycle lookup, plus an operator-only issuer-key
  registry with one active key, retirement, emergency revocation, and a
  public read-only keyset; no public issuance;
- a repository-versioned research skill, retired local MCP prototype, and
  Worker-compatible remote MCP/identity protocol scaffolding, including a
  D1/R2-backed public catalog/Attempt/progress and immutable Bundle-staging
  store, review-scope-bound remote Agent attestation-admission adapter, and a
  fail-closed gateway deployment entrypoint;
- D1-atomic remote-MCP transport quotas that aggregate every Agent
  installation under its owner Person, retain only opaque, short-lived bucket
  counters, and cover catalog, Attempt, progress, artifact, and review tools;
- privacy-minimal structured audit boundaries for the external MCP Worker and
  Lean Runner Queue Worker: request path/status/duration and aggregate Queue
  delivery totals only, with no headers, query strings, tokens, bodies,
  identities, artifact bytes, or exception text;
- logical D1 (`DB`) and R2 (`ARTIFACTS`) bindings declared for Sites;
- responsive desktop and mobile presentation.

### Missing

- the workbench now renders only persisted provisional Attempt events and
  explicit evidence gates; it does not simulate a proof branch, compiler
  output, Agent progress, or bundle submission. An authenticated closed-alpha
  owner can open or refresh a persistent provisional Attempt under a valid
  delegated Agent authority, but subsequent Agent work and bundle staging
  require the separately deployed remote control plane;
- closed-alpha Attempt creation is atomically capped per Person across every
  delegated Agent. This capacity guard is an abuse-control measure rather than
  a contribution score; it does not alter existing records or evidence;
- independent-review assignment creation is atomically capped per reviewer
  Person across every review Agent. Only assigned or accepted work consumes
  capacity; completed and declined reviews remain auditable but release it;
- no public identity, account recovery, cross-device key-rotation policy, or
  participant-ready delegation service exists; closed-alpha browser-held keys
  now have proof-of-possession and append-only revoke/replace controls, but
  this is not a public identity or recovery system;
- a private-alpha Sites session/consent adapter now supports standard browser
  OAuth authorization for an already-created Person and selected delegated
  Agent; no independent participant identity, deployed MCP gateway control
  plane, bounded-run, artifact, verification, or receipt API exists;
- the closed-alpha Agent connection page now reports that no external endpoint
  is available rather than exposing a placeholder URL or configuration. It
  directs users to the durable Person/Agent/delegation setup that is available
  now and describes the scoped OAuth flow only as a post-deployment capability;
- no Lean execution service exists;
- no participant-facing fresh runner replay exists. Closed-alpha owners and
  assigned reviewers can inspect a controlled Bundle/Run metadata view and
  download D1-index-checked private R2 artifacts, but that inspection is not a
  fresh replay or a verification claim. The source has a remote Agent
  attestation-admission path, but it remains unavailable until the separate
  identity and MCP gateway control plane are deployed;
- no public contribution-receipt issuance endpoint exists. Issuer-key rotation
  is now source-complete through an operator-only D1 registry and public
  keyset, but it has no deployed operator secret provider or incident runbook;
- no production observability exists. Source Workers now emit privacy-minimal,
  structured HTTP/Queue boundary events to their platform console, but no
  deployed log retention, metrics, tracing, alerts, incident response, or cost
  accounting exists. GitHub Actions runs the complete `npm run check` workflow
  for every push and pull request, but an enforced required-check branch policy
  remains a repository/account administration decision and is not asserted by
  this source repository. CI also rejects known high-severity production
  dependency vulnerabilities, while Dependabot proposes weekly npm and GitHub
  Actions updates;

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

The GitHub remote is connected and the `Check` workflow now runs `npm run
check` for pushes and pull requests; the main-branch run for commit `04cf45f`
passed on 2026-07-13. This proves remote CI execution, not that GitHub will
reject a merge: making that workflow a required branch check remains a
repository/account policy to configure separately.

### Sprint 1 progress

Implemented locally on 2026-07-13:

- enabled logical D1 and R2 bindings, created the six-table catalog schema, and
  generated deployable D1 migrations;
- seeded the immutable Formal Conjectures `bench-v1-lean4.27.0` snapshot with
  a fixed commit, exact source and manifest hashes, license, Lean toolchain,
  Mathlib revision, source lines, and retrieval time;
- added a typed catalog repository and public read APIs for catalog lists and
  declaration-level record detail;
- replaced the homepage, Explore catalog, and problem page preview data with
  D1 repository reads, while keeping Practice structurally separate from
  frontier records;
- added source-fixture validation and a local D1 regression test that checks
  repeat seeding does not duplicate records.

The local D1 harness passed on 2026-07-13 and the catalog was deployed to the
private Sites environment. Hosted catalog access remains protected by its
owner-only platform policy.

### MCP direction change

The static-token, local-stdio prototype was retired on 2026-07-13. It required
a copied bearer token, a local source path, and a Sites bypass credential, none
of which is suitable for participant onboarding. Migration `0003` revokes every
existing prototype token and token issuance now returns `410 Gone`.

The replacement is a remote Streamable HTTP MCP gateway with Proofweave OAuth.
The source now includes separated Worker-compatible gateway and identity
services, standard discovery metadata, stateless MCP request handling,
scope-gated tool definitions, a D1-backed gateway store for source-pinned
catalog reads, delegated Attempt/progress writes, immutable Artifact Bundle
staging, and signed review attestations. The private Sites Worker also has a
CSRF-bound browser-consent adapter for the already-authenticated alpha owner.
The resource-server deployment entrypoint remains deliberately non-deployable
for participants until independent identity, gateway control-plane provisioning,
revocation operations, and observability exist. The product contract is in
[`docs/remote-mcp-gateway.md`](remote-mcp-gateway.md) and the architectural
decision is ADR 0005.

### OAuth control-plane progress

Implemented locally on 2026-07-13:

- OAuth authorization-code PKCE validation, redirect URI validation, code
  single-use, resource-bound access tokens, and refresh-token rotation;
- explicit Agent-installation lookup in each grant; the underlying owner,
  Agent status, certificate validity, and revocation are checked before a token
  can be issued or accepted by the resource server;
- D1 tables and adapter that store only hashes of authorization codes, access
  tokens, and refresh tokens, with atomic consumption in D1 integration tests.
- D1 remote-MCP store that rechecks the selected installation on every
  operation, derives Agent attribution from D1 rather than tool input, limits
  Attempt discovery, reads, and progress to the exact Agent/certificate pair,
  and is covered by actual OAuth-token-to-MCP-to-D1 integration tests.
- bounded `artifact:write` ingress that rechecks the exact active Attempt and
  its current `formalize` or `prove` delegation before accepting one immutable
  object or signed v2 Artifact Bundle; Bundle staging appends only a
  `bundle_staged` activity event and remains separate from the isolated runner
  and review pipeline.
- a source-level `run:request` bridge that accepts only that exact Agent's
  staged signed v2 Bundle, rechecks its immutable D1/R2 evidence, chooses an
  operator-approved Lean/Mathlib image, and atomically binds it to one signed,
  idempotent Runner Queue request. It remains unavailable until every separate
  Queue, Runner image, limits, and signing binding is provisioned; and
- source-level `run:read` and idempotent `run:cancel` tools that recheck the
  same exact Agent/certificate/Attempt binding, expose only immutable Run
  lifecycle metadata, and distinguish queued cancellation from an
  evidence-backed running cancellation; and
- a fail-closed Cloudflare gateway deployment entrypoint that composes D1
  token lookup, D1/R2 evidence storage, and stateless OAuth resource-server
  enforcement from explicit Worker bindings; and
- a source-level structured audit boundary around each remote MCP HTTP request
  and Lean Runner Queue batch. It generates an opaque correlation ID plus only path,
  method, status, duration, and aggregate delivery totals; the log sink cannot
  affect execution. This is not a deployed telemetry or alerting service; and
- D1-atomic remote-MCP rate-limit buckets keyed by an opaque Person/operation
  digest. A second Agent installation for the same Person cannot bypass a
  quota; only ephemeral transport counters are retained. Load validation,
  deployed retention, and an abuse-response process remain rollout work; and
- dynamic OAuth client registration closed by default, with discovery exposing
  it only for a finite operator-reviewed metadata allowlist; the private Sites
  runtime reads that allowlist only from an explicit deployment binding, and D1
  assigns idempotent client IDs to identical approved registrations; and
- a private Sites OAuth adapter with one-use D1 consent challenges, HttpOnly
  CSRF binding, capability-filtered Agent selection, and automatic revocable
  Agent-installation creation for a browser-approved MCP client; and
- an owner workbench connection-control panel that lists each Agent/client
  installation and records an immutable owner revocation while immediately
  invalidating its resource-server access; and
- an updated repository Codex research Skill with an explicit catalog →
  Attempt → progress → Bundle → independent-review workflow, including a
  fail-closed instruction not to claim a remote event when the MCP server is
  absent; and
- a portable `proofweave-research` Codex plugin source package that carries
  that checked Skill and is regression-tested for exact source alignment. It
  deliberately has no MCP endpoint, local bridge, or static credential
  configuration before the remote OAuth control plane is deployed; and
- a tested remote-MCP deployment preflight that rejects placeholder bindings
  and documents the requirement for one shared external D1/R2 control-plane
  boundary before any public Worker is deployed.

The default standalone identity Worker is intentionally still unavailable.
The private Sites application now also carries a closed-alpha OAuth adapter:
it reuses the existing authenticated Sites session only to find a pre-existing
Person, renders a one-time CSRF-bound consent page, filters selected Agents by
active delegation scope, and issues a revocable client installation. This does
not provide independent login, account linking, recovery, or public
participant access; those remain deployment gates for the standalone identity
service.

### Sprint 2 progress

Implemented locally on 2026-07-13:

- canonical JSON, payload hashing, Ed25519 signature verification, scope,
  validity-window, beneficiary, and revocation checks for delegation v1;
- D1 persistence for Person signing keys, stable one-owner Agents, immutable
  delegation certificates, and append-only revocations;
- closed-alpha authenticated APIs to inspect a Person profile, register a key
  and Agent, issue a signed delegation, and revoke it;
- a one-time five-minute Person-key proof-of-possession challenge, canonical
  signature verification, immutable D1 challenge/proof evidence, and an
  issuance guard that requires an intact proof before a key can delegate;
- immutable Person-key revocation events with a safe replacement guard (or an
  explicit emergency path), browser-private-key removal after success, public
  signer-key status, and effective invalidation of later Agent events signed
  under certificates issued by the revoked key;
- integration tests proving the full key/Agent/sign/revoke sequence plus D1
  immutability triggers;
- a read-only certificate route and human-readable record that rechecks the
  canonical payload hash and Person signature before exposing public signing
  evidence or an append-only revocation; it omits provider identities, display
  names, private keys, credentials, and private Agent reasoning;
- new provisional Attempts bind their Agent, certificate, and delegated scope;
  later progress is rejected after certificate expiry or revocation.

The workbench now reads an authenticated Person's persisted key, Agent, and
active-delegation status, and renders only durable Attempt events and explicit
evidence gates rather than simulated proof work. It has a closed-alpha setup
flow that creates a non-exported browser
WebCrypto Person key, records only its public half, proves possession with a
one-time server challenge, registers an Agent public key, signs a scoped
delegation locally, and offers explicit delegation and key revocation actions.
The Agent private key is never created or copied through the web app. The
workbench still cannot submit Agent work itself: account recovery, public
cross-device rotation policy, independent public identity, and the remote
Agent connection remain required before participant access. The API contract and current
limitation are documented in
[`docs/agent-delegation-api.md`](agent-delegation-api.md).
The new read-only record representation is part of the Sprint 2 inspection
surface, not public participant onboarding: the current Sites deployment still
has an owner-only access policy.

The same closed-alpha workbench now has a D1-backed owner work queue. It lists
only public, source-pinned frontier records, accepts a selected target from a
problem-detail handoff, and derives the registered Agent and certificate
binding server-side from an active `formalize` or `prove` delegation. It then
persists a bounded owner-created provisional Attempt for that exact catalog
revision. It does not append research progress, accept an Agent signature,
submit a Bundle, or award a verification or receipt; those actions remain on
their separate authorization and evidence paths.

### Sprint 3 protocol progress

Implemented locally on 2026-07-13:

- versioned Lean runner request/result schemas and canonical request hashes;
- enforced content-addressed bundle keys, pinned image digests, `lake env lean`
  argument arrays, disabled networking, bounded resources, `sorry` audit, and
  axiom policy;
- result invariants that distinguish runner/kernel evidence from human
  statement, novelty, project, and receipt claims.
- provider-neutral queue envelopes that bind each request hash to an Ed25519
  control-plane signature; runner-side issuer-key allowlist verification;
- an internal orchestrator that persists a single idempotent Run before queue
  delivery and preserves safe retry after a queue-provider failure.

No Lean container, Queue, source-transfer path, Runner Worker, or user-code
executor has been deployed. The checked-in Queue consumer, D1/R2 resolver, and
private Container composition are source-level control-plane gates, deliberately
a prerequisite to—not a substitute for—the isolated runner described in
[`docs/runner-contract.md`](runner-contract.md).

### Artifact bundle progress

`pw-artifact-bundle-v1` rejects traversal, shell commands, unknown fields, and
incomplete evidence while producing a canonical SHA-256 manifest hash.
`pw-artifact-bundle-v2` adds an executable workspace contract: a `tar.zst`
archive with no links, bounded extraction, no-fuzz normalized patch, root Lake
manifest replacement, and a canonical post-patch `pw-tree-v1` hash. Staging
and resolution support both versions, while Runner preflight permits only v2
to move into isolated execution. The canonical manifest remains the single
evidence object intended to move between R2, the runner, independent replay,
and receipts. See
[`docs/artifact-bundle-contract.md`](artifact-bundle-contract.md).

### Artifact storage progress

The internal artifact store now conditionally writes content-addressed R2
objects and keeps immutable D1 indexes for objects and staged bundle manifests.
It validates the Agent signature and event timing against the Attempt's
delegation, then requires every referenced source, patch, and Lake object to be
present with its declared hash. The in-memory control-plane method is bounded
to 32 MiB and is not a participant upload or execution API. See
[`docs/artifact-storage-contract.md`](artifact-storage-contract.md).

The Runner's D1/R2 resolver independently reads and SHA-256 re-checks the
small canonical manifest before resolving it, then compares the request's
Attempt, command, pinned Lean environment, Mathlib revision, and policy to the
signed manifest. It only returns metadata for the referenced archive, patch,
and Lake files after their immutable D1/R2 index records agree; it does not
yet transfer or execute those files. Historical v1 Bundles can be resolved for
audit but cannot create a Runner request or advance a queued Run; only v2 has
safe workspace reconstruction semantics.

`RunnerWorkspaceTransfer` now defines the trusted Worker-to-private-Container
handoff for v2: a fixed workspace declaration and three R2 streams carrying
immutable hash/length metadata. `ContainerWorkspaceRuntime` is the
source-only private process implementation: it re-hashes streamed artifacts,
rejects links/traversal and unsafe patches, reconstructs the workspace under
the declared limits, replaces the Lake manifest, and verifies the final tree
hash before it returns an entry command. `container-http-server.mjs` now binds
that Fetch handler to the private Container port, exposes only a readiness
probe outside the internal Run routes, performs shutdown cleanup, and refuses
to start the executor unless the deployment asserts both no egress and external
CPU/memory/disk/process limits. The ingress HTTP source and its real `tar.zst`
tests are checked in, but there is still no approved Container image, deployed
Worker-to-Container binding, result persistence deployment, or production Lean
process. `ContainerLeanExecutor` now supplies source-only process logic
for the final boundary: it accepts only a matching finalized workspace and
fixed `lake env lean` request, bounds output/time, audits `sorry`, checks the
declared theorem's axioms, and returns unsigned evidence. It refuses to run
unless outer network and resource isolation are explicitly provided, and it
has been exercised locally with success, `sorry`, and compiler-error fixtures.
`npm run runner:e2e:check` additionally reconstructs an actual v2 `tar.zst`
fixture and carries it through the private runtime, Lean executor, Worker
result client, and signing gate to kernel-accepted signed evidence.
`RunnerExecutionResultSigner` is the Worker-side source gate that re-hashes
returned output and binds it to the active Run before applying the existing
operator Ed25519 result signature. `D1R2RunnerOutputStore` now writes exact
stdout/stderr bytes to separate immutable R2 objects and D1 rows; D1 refuses a
signed terminal result whose output hashes lack those rows.
`RunnerExecutionFinalizer` fixes that persistence → signing → D1 ordering.
`cloudflare-worker.mjs` now composes the source-level Queue consumer:
authenticated message, D1 preflight, named private-Container staging,
execution, R2 output persistence, Worker-held signing, then D1 finalization.
It has no public execution route and retries a running Run without recreating
it. While execution is in flight, it polls D1's durable cancellation state and
forwards a cancellation only to the same named private Container; the
Container converts it into Lean-process cancellation before the normal
output/signing/D1 terminal path. A deployed Worker/Container result round
trip, provisioned R2 binding, non-production cancellation lifecycle test, and
an approved image are still required.

The source now includes a digest-required Docker final-assembly recipe that
copies only the protocol and private Container runtime, starts as a non-root
user, rejects mutable base references, and has no dependency-download command.
It requires a separately inspected base image plus an offline build, final
image scan, and recorded digest before it can represent a deployed Lean Runner.

Run lifecycle now records a retryable `preparing` state before private
workspace transfer. Only `RunnerWorkspaceStager` may move a successfully
finalized workspace into `running`; an interrupted R2 transfer remains
preparing and is safe for Queue retry instead of becoming a permanently false
running execution.

### Run lifecycle progress

The control plane now has a tested Run projection and D1 store for queueing,
start, cancellation request, and terminal runner evidence. Its identity fields
are immutable; every transition and terminal result has immutable, canonical
evidence. A runner request can only be constructed from a canonical artifact
bundle, so its command, environment, and policy cannot drift after submission.
Terminal runner results must be signed by an active, operator-provisioned runner
key before the store accepts them. Lean jobs intentionally support
cancellation—not fake pause/resume—because a reproducible checkpoint format
does not exist yet. The store remains internal: no public run-creation or
execution route exists. The remote MCP source may let the exact delegated
Agent read or request cancellation of its own Run, but it cannot make a
cancelled status mean verification. See
[`docs/run-state-contract.md`](run-state-contract.md).

### Verification-assignment progress

The internal verification store now snapshots an Attempt owner's Person ID when
assigning a staged bundle, rejects same-owner review, and records acceptance,
decline, and Agent-signed Attestation events immutably. Completing an
Attestation requires a different owner's active `review` delegation, exact
assignment/claim/evidence match, and Ed25519 verification. `/reviews` now
gives a signed-in closed-alpha reviewer an owner-scoped task queue and immutable
accept/decline actions; it never exposes the Attempt owner, fabricates an
Agent signature, or labels acceptance as verification. `/evidence` now lets an
Attempt owner or independently assigned reviewer inspect the exact canonical
Bundle, indexed source/patch/Lake artifacts, recorded Run result metadata, and
Runner logs. Artifact bytes are returned only after the D1 object index and R2
metadata agree; reviewer views retain the owner-identity boundary. This is an
inspection/download surface only: it does not perform a fresh runner replay or
create an attestation. The remote MCP source now accepts an already-signed
Attestation only through a `verification:write` OAuth installation with an
active `review` delegation, exact installation identity binding, and the same
immutable D1 verification checks; it remains non-deployed until independent
identity/consent and the gateway control plane are provisioned. See
[`docs/verification-contract.md`](verification-contract.md).

### Contribution Receipt protocol progress

`pw-contribution-receipt-v1` now canonicalizes and Ed25519-signs the credited
Person/Agent/delegation, Attempt and target, Bundle, Run hashes, independent
attestation references, and upstream dependency receipts. Its initial policy
requires a succeeded kernel-accepted Run plus `bundle_reproducible`,
`kernel_accepted`, and `project_accepted` evidence by Persons other than the
Attempt owner. A verification receipt can only credit the independent review
Agent that actually attested. `D1ContributionReceiptStore` rebuilds receipt
evidence from immutable staged Bundle, Run/result, and Attestation rows before
signing and append-only persistence; idempotent retries return the existing
receipt. At issuance, every Bundle-declared upstream receipt is rechecked by
exact hash, issuer signature, policy, and time ordering, then written with the
downstream receipt as an immutable D1 dependency edge. The public read-only
`GET /api/receipts/:id` lookup and receipt page re-parse the canonical payload,
recompute its stored hash, and verify its embedded issuer signature before
display; `GET /api/receipts/:id/dependencies` and the receipt page revalidate
the dependency projection before exposing the upstream trace. A separate
`pw-contribution-receipt-lifecycle-event-v1` now captures issuer-signed,
append-only corrections, supersessions, and retractions: it preserves the
original receipt, constrains replacement identity/timing/cycles, and exposes a
verified history through `GET /api/receipts/:id/lifecycle` and the receipt
page. The bounded, newest-first `GET /api/receipts` and `/receipts` index
includes only receipts that pass the same canonical/hash/signature checks and
reports their latest signed lifecycle status. There is still no public issuance
endpoint. The operator-only issuer-key registry now supports retirement and
emergency revocation without mutating historical receipts; its public keyset is
available at `GET /api/receipts/issuer-keys`. See
[`docs/contribution-receipt-contract.md`](contribution-receipt-contract.md).

`npm run alpha:evidence-flow:check` now combines the local D1/R2 boundaries in
one cryptographic fixture: a delegated Agent signs and stages a v2 Bundle, the
trusted Runner boundary persists and signs a kernel-accepted result, different
Persons submit three signed review claims, and the issuer creates an
idempotent Receipt. This is a regression gate for cross-module evidence
compatibility only: it uses fixture execution evidence and does not start a
Container, prove a theorem, deploy the control plane, or count as the alpha's
required real contribution.

Where `lake` is available, `npm run alpha:local-lean-evidence-flow:check`
adds a stricter local fixture: it reconstructs a real v2 `tar.zst` Lean
workspace from an Agent-signed staged Bundle, re-hashes the D1/R2 records as a
Runner would, transfers the declared bytes to the private-runtime source
boundary, executes Lean, persists and signs its exact output, then proceeds
through independent Person review assignments and Receipt issuance. The
fixture still asserts source-level isolation flags rather than running a
deployed Container, and its reviewer attestations are test data—not a real
independent review or an alpha contribution.

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
- Runner: separately deployed Cloudflare Container, one fresh instance per
  Run, with public Internet disabled and no Container credentials.
- Queue: Cloudflare Queues for closed alpha, with a provider-neutral
  `RunnerQueue` contract retained for future portability. The checked-in
  adapter authenticates before execution, but no Queue, Runner Worker, image,
  or Container is deployed yet.
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
- require an immutable proof of possession before a Person key can delegate;
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

- define the runner request/result contract, provider-neutral queue contract,
  and deterministic fixtures;
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
