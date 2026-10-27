<p align="center">
  <strong>English</strong> | <a href="./README.zh-CN.md">中文</a>
</p>

<h1 align="center">Proofweave</h1>

## Let every mathematical contribution be seen

The solution to a difficult mathematical problem begins long before the final
line of its proof.

Before an answer emerges, someone poses the question, someone tests its
boundaries, and someone creates the mathematical tools it needs. Someone finds
a promising path; someone else's unsuccessful attempt shows later researchers
where a path does not work. Together, these efforts advance research, yet they
are not always fully represented in the final result.

**Proofweave exists for this collaboration.**

We want to build an open mathematical research platform where problems,
conjectures, lemmas, tools, reasoning steps, and verification results can be
recorded, cited, and reused. Each advance can connect to the work it depends
on, helping others continue from existing results and keeping contributors'
names connected to the value they create.

Through formal verification and traceable contribution records, we aim to
reduce duplicated effort, improve collaboration, and provide a foundation for
more transparent and fair recognition and reward allocation.

Mathematics grows through connections between countless people's ideas.
Proofweave aims to make these connections visible, so that every contribution
that advances knowledge can be seen.

**Proofweave: help mathematical collaboration keep growing, and let every
contribution leave a trace.**

<p align="center">
  <img src="./public/proofweave-devpost-cover.png" alt="Proofweave: a person delegates an agent, shares research evidence, and receives attribution after verification" width="100%" />
</p>

<p align="center">
  <strong>Verifiable collaboration for people and their agents.<br />Starting with formal mathematics.</strong>
</p>

<p align="center">
  <a href="https://proofweave.org/"><img alt="Public alpha" src="https://img.shields.io/badge/PRODUCT-ALPHA-4c6fff?style=for-the-badge" /></a>
  <a href="https://proofweave.org/demo#verification-console"><img alt="Reference evidence demo" src="https://img.shields.io/badge/REFERENCE_EVIDENCE-DEMO-2f6f4e?style=for-the-badge" /></a>
  <a href="https://github.com/alexyyyander/proofweave/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/LICENSE-Apache--2.0-0b1b38?style=for-the-badge" /></a>
</p>

Proofweave explores a network where people publish bounded tasks, work with
their own AI agents, share useful intermediate results, and receive attribution
through reproducible evidence and independent review.

**The current alpha focuses on formal mathematics.** It implements pinned Lean
targets, delegated agents, signed research checkpoints, evidence bundles,
isolated Lean replay, and contribution receipts. Research writes and review
assignments remain controlled. Broader agent support, non-mathematical tasks,
and monetary bounties are future work.

The intended workflow is: **define a task → collaborate → submit evidence →
verify independently → attribute contributions → apply a reward policy**.
The final reward step currently has an experimental research-credit protocol;
it is not a cash payout service.

## Try Proofweave in 60 seconds

The public inspection path needs no account or local build.

1. Browse the [research catalog](https://proofweave.org/explore). Inspect a
   target's source, pinned environment, and acceptance conditions.
2. Open the [verification console](https://proofweave.org/demo#verification-console).
   Select **Re-verify signed evidence**, then **Tamper-test a copy**.
3. Inspect the reference Receipt's hashes, signatures, dependencies, and
   lifecycle. Browse the [public receipt index](https://proofweave.org/receipts)
   for published records; the index may be empty during alpha.

The demo uses fixed reference evidence and explicitly labelled mock reviewer
identities. Re-verification checks that evidence and its signatures; it does
not run Lean again or establish new mathematical results. Real participation
requires an enabled account, an authorized agent connection, and an available
verification environment and review pool.

## Why Proofweave

A collaborative task can produce useful lemmas, reductions, counterexamples,
and reproducibility fixes before anyone completes the final result. Proofweave
records these intermediate steps and the dependencies between them.

The product aims to make four things inspectable:

- **Reusable progress:** a signed checkpoint can cite and build on earlier work.
- **Reproducible evidence:** an exact submission can be replayed under a pinned policy.
- **Independent review:** a different owner evaluates a bounded claim.
- **Attribution:** a receipt links accepted evidence and dependencies to contributors.

These mechanisms are implemented first for Lean research. Their effect on
collaboration quality and fair credit still needs evaluation with real
participants. Extending them to other fields requires explicit acceptance
criteria and suitable verification methods for each field.

## Open source and access

This repository contains the public alpha implementation under
[Apache-2.0](LICENSE). You can inspect the protocols, run the application
locally, and contribute code, documentation, or catalog proposals through the
[contribution guide](CONTRIBUTING.md).

The hosted service has controlled write access. Public source does not grant
access to production credentials, private workspaces, or restricted evidence.
`package.json` uses `private: true` because this is an application and deployment
bundle, not an npm package; the repository itself is public.

## The participant journey

A **Person** owns a delegated **Agent**. An **Attempt** records work on one
pinned target. A **Bundle** contains the submitted evidence; a **Run** records
its execution. A **Receipt** records attribution after the required checks close.

The following is the current Lean workflow. Access, Runner capacity, and review
availability determine which steps a participant can complete in the alpha.

| Stage | Person and agent responsibilities | Sent to Proofweave | Received or downloaded |
| --- | --- | --- | --- |
| 1. Define or select a target | A proposer supplies a source and bounded claim; a participant selects an admitted target. General task publishing is planned. | A target proposal and source references, if proposing | Target brief, source references, pinned Lean/Mathlib versions, acceptance conditions |
| 2. Connect and delegate | The person authorizes an agent and a research or review role in the browser. | Agent public key and scoped delegation metadata | Connection status and authorized task data; credentials are stored locally |
| 3. Start an Attempt | The person chooses the target and local workspace; the agent obtains upstream sources and investigates. | Attempt metadata and any deliberately submitted private progress records | Attempt ID and relevant research graph; source files are obtained separately from upstream |
| 4. Share progress | The agent drafts a checkpoint; the person approves its exact public content. | Signed summary, checkpoint kind, parent nodes, citations, and optional evidence hashes | Public checkpoint and branch references, initially `shared_unverified` |
| 5. Submit evidence | The agent runs local checks and prepares a bundle; the person approves the selected files and submission. | Source archive, normalized patch, locked dependency manifest, signed bundle metadata, and Run request | Bundle and Run IDs, execution state, logs, and signed result when available |
| 6. Review independently | After accepted Lean evidence, the author opens review. A different person accepts an assignment; their agent requests fresh replay and prepares a decision for owner approval. | A signed decision limited to the assigned claim and bound to replay evidence | Authorized reviewers can retrieve the assigned evidence and replay results |
| 7. Inspect attribution | Contributors inspect the issued Receipt and its dependencies after all required gates pass. | Any later correction follows the signed lifecycle protocol | Receipt and portable verification JSON; experimental credit records where policy permits |

On the current website, **Continue in Codex** copies a task brief for the local
client. A Markdown download is also available. This handoff does not launch a
local agent or upload a workspace. Support for other agents is planned;
current client-specific setup is folded below.

An executable v2 bundle contains `source.tar.zst`, `normalized.patch`, and
`lake-manifest.json`. Signed metadata binds these bytes to the target,
toolchain, entry command, workspace hashes, and execution policy. The alpha
limits each artifact to **1,000,000 decoded bytes**. The standard local packer
supports edits to existing tracked text files; other file changes require a
supported, explicitly selected submission path. See the
[bundle contract](docs/artifact-bundle-contract.md) for exact constraints.

Raw source and artifact downloads are access-controlled to the owner and
assigned reviewers. A public portable Receipt bundle contains verification
records, signatures, and lifecycle evidence; it does not include private source
archives. Public checkpoints contain only their approved publication payload.

| Record | What it establishes | Remaining work |
| --- | --- | --- |
| Signed checkpoint | Who signed a progress update | Check correctness, relevance, and originality |
| Evidence Bundle | Exactly which bytes and environment were submitted | Execute and assess those bytes |
| Successful Lean Run | Acceptance under the recorded Lean execution policy | Independently review reproducibility and project acceptance |
| Review attestation | A different owner signed a bounded claim | Close the other required claims |
| Contribution Receipt | Required evidence gates closed under the issuer's policy | Respect its scope, dependencies, and later lifecycle events |

## What works today

| Availability | Scope |
| --- | --- |
| **Public inspection** | Catalog, research branches, signed reference verifier, tamper test, and public Receipt inspection routes |
| **Controlled alpha / client beta** | Person identity, revocable delegation, local OAuth-PKCE connection, Attempt and checkpoint writes, evidence submission, and assigned reviews |
| **Implemented protocol and tests** | D1/Turso evidence storage, Run lifecycle, owner separation, claim-specific review, signed Receipts, and portable verification bundles |
| **Configured execution path** | Trusted hosted Runner with fresh E2B Lean sandboxes; actual use depends on live health, approved target environments, and capacity |
| **Experimental attribution** | Receipt-derived, non-transferable research credits, verification-market policies, and settlement code; active rewards are not implied |
| **Planned expansion** | More agent clients, general task publication, software and algorithm verification, additional verifier types, and funded bounties |

A queued Run still needs execution. A successful Lean Run still needs the
required independent reviews. A checkpoint alone is not accepted evidence.
The catalog is not a guarantee that every listed environment can currently run;
check the target and connection status before submitting.

## Connect your agent

The goal is to support any agent client that can implement Proofweave's
connection and evidence requirements. The current tested packaged integration
is the Codex private beta; universal agent compatibility is not yet available.

The remote MCP endpoint is `https://proofweave.org/api/mcp`. Inspect the
[capability document](https://proofweave.org/api/mcp/capabilities) and
[gateway contract](docs/remote-mcp-gateway.md) when building an integration.
An MCP transport connection alone is insufficient: a client must also support
browser authorization, delegated identity, local signing, owner approvals,
version compatibility, and the evidence submission workflow.

Connection does not automatically send prompts, private reasoning, or workspace
files to Proofweave. The chosen agent or model provider has its own data flow;
using a cloud model can send content to that provider. The local connector
stores its agent private key and OAuth refresh token on the participant's machine.

<details>
<summary>Current Codex adapter: installation, authorization, and updates</summary>

The optional plugin beta is tested with **Codex for macOS on Apple silicon**
and Node.js `>=22.13.0`. See the [published installation guide](https://proofweave.org/codex-install.md)
and [plugin workflow](docs/codex-plugin.md).

The normal installation verifies a published archive checksum before extraction:

```bash
PROOFWEAVE_DOWNLOAD_DIR="$HOME/Downloads/proofweave-install"
PROOFWEAVE_MARKETPLACE_DIR="$HOME/.local/share/proofweave/marketplace"
mkdir -p "$PROOFWEAVE_DOWNLOAD_DIR" "$PROOFWEAVE_MARKETPLACE_DIR"
curl --fail --location --output "$PROOFWEAVE_DOWNLOAD_DIR/proofweave-research-marketplace.tar" \
  "https://proofweave.org/downloads/proofweave-research-marketplace.tar"
curl --fail --location --output "$PROOFWEAVE_DOWNLOAD_DIR/proofweave-research-marketplace.tar.sha256" \
  "https://proofweave.org/downloads/proofweave-research-marketplace.tar.sha256"
cd "$PROOFWEAVE_DOWNLOAD_DIR"
shasum -a 256 -c proofweave-research-marketplace.tar.sha256
tar -xf proofweave-research-marketplace.tar -C "$PROOFWEAVE_MARKETPLACE_DIR"
codex plugin marketplace add "$PROOFWEAVE_MARKETPLACE_DIR"
codex plugin add proofweave-research@proofweave-private-beta
```

Codex must show the selected directories and commands and receive approval
before running them. Never pipe downloaded content into a shell. Installation
alone does not authorize an account or workspace. Complete the separate browser
OAuth approval and choose the permitted research or review role.

A GitHub account, source checkout, or GitHub token is not required for the normal
participant connection. Source checkout remains an advanced development option.

`connection_status` reports connection health and plugin compatibility. Its
public distribution check reports `current`, `update_available`, or `unknown`
without sending OAuth credentials or workspace data. Updates require a displayed
archive URL, SHA-256, size, paths, and commands, followed by owner approval and
restart; they are not installed automatically.

</details>

## Contributions and rewards

### A contribution network that grows through reuse

The product goal is to connect new theorems, lemmas, methods, tools, and proof
strategies to their contributors and to the later results that use them.
A contribution can retain its attribution across tasks. Under a future
participating reward policy, later accepted reuse can make its contributors
eligible for a share of each new task's reward budget.

Three records have different roles:

| Record | Purpose |
| --- | --- |
| Contribution | Identifies a bounded result or method, its version, contributors, evidence, and acceptance status |
| Reuse relationship | Records which accepted contribution a later result uses, where it is used, and the evidence supporting that relationship |
| Reward settlement | Records the budget, policy, approved recipients and shares for one accepted task |

For example, Alice proves lemma A, Bob uses A to develop method B, and Carol
uses B with Dan's strategy C to solve problem P. A participating reward pool
for P would consider the accepted work on A, B, C, and P. If another task Q
later uses B, its own policy could allocate a new share to B and the eligible
upstream work on A. Each pool must fund and approve its own allocation.

### Proposed rules for contribution value and reward allocation

These rules describe the intended extension; they are not an active payout
policy or a completed allocation algorithm.

- **Establish a baseline.** Existing mathematical knowledge, standard theorems,
  and libraries remain cited foundations. Ordinary use does not automatically
  earn reward shares. Missing historical attribution stays explicitly unknown;
  older work needs evidence and review before admission to a reward policy.
- **Record new contributions over time.** New results and methods receive
  versioned attribution and evidence. Useful boundary checks and failed
  approaches can be recorded; reward eligibility requires evidence of their
  accepted scope and actual role in later work.
- **Evaluate the work actually used.** A task proposes a bounded reward value
  and budget. Allocation considers accepted contribution to the result,
  criticality, available alternatives, the advance enabled, and supporting
  evidence. Key ideas and indispensable steps can receive greater weight.
  Formal dependency checks support this assessment; evaluating the influence
  of a strategy also requires approved research records and review.
- **Count distinct contributions.** Node count, path count, commit count,
  Agent count, and compute spend do not determine value. A policy must handle
  shared ancestors, equivalent contributions, and overlapping work so that
  splitting or repeating a contribution cannot increase its total share.
- **Approve each settlement.** Before activation, a task publishes its budget,
  eligible contribution types, baseline, upstream scope, valuation procedure,
  and dispute process. Locking records the exact dependency graph, reviewed
  weights, recipients, and policy version. Shares must fit the fixed budget.
  Contested allocations remain pending until adjudicated.
- **Make continued participation explicit.** Future tasks can reward accepted
  reuse again under their own policies. Attribution alone creates no automatic
  royalty obligation for ordinary mathematical citation or external users.
  Financial distributions require a funded program and approved payment rules.

### Current implementation

Sharing a checkpoint, running an agent, or spending compute does not by itself
create a reward entitlement. A Receipt records accepted evidence and attribution
under a specific policy. It is not a payment or an unrestricted authorship claim.

The implemented experimental credit protocol uses **non-transferable,
non-financial research credits**. It includes allocation and settlement logic
for final results, verified dependencies, independent verification, and a
challenge reserve. Eligibility depends on valid Receipts and the applicable
pool policy; intermediate work must meet the relevant verification and
dependency conditions. This code does not establish that a funded or active
reward pool is available. See the [credit-market design](docs/credit-market-v1.md).

The [Receipt credit implementation](packages/protocol/receipt-credit.mjs)
already records `downstream_impact` for the verified beneficiaries of dependency
Receipts. These entries record reuse; their units do not measure mathematical
value or specify a share of money. The v1 pool policy reserves 30% for the final
result, 40% for verified dependencies, 20% for independent verification, and 10%
for challenges. These bucket totals do not determine the relative value of
individual upstream contributions.

The next implementation work is to specify and test cross-task reward
eligibility, reviewed contribution weights, shared-ancestor deduplication,
multi-level allocation, and auditable settlement proposals. These rules need
real collaboration examples and review before they govern funded tasks.

A general bounty service would also need sponsor budgets, task-specific
acceptance rules, duplicate and dependency policies, conflicts of interest,
dispute handling, and payment settlement. These are future product work;
Proofweave currently makes no cash-payout promise.

## Local development

### Prerequisites

- Node.js `>=22.13.0` and npm
- Lean/Lake for checks that execute Lean; follow the [smoke prerequisites](docs/solo-contribution-smoke.md)

### Run the application

```bash
git clone https://github.com/alexyyyander/proofweave.git
cd proofweave
npm install
npm run dev
```

### Verify the submission path

```bash
npm run smoke:solo-contribution
npm run demo:check
npm run build
npm run demo:release:check
```

The solo smoke uses temporary local D1/R2 state, one primary Lean Run, two fresh
claim-specific Lean replays, generated test reviewers, and a signed test
Receipt. It does not write to the hosted control plane. The mock owners test
identity separation; they do not establish independent human review or public
contribution credit. See the [smoke contract](docs/solo-contribution-smoke.md)
for prerequisites and the remaining cloud boundary.

`demo:check` validates the fixed reference evidence and rejection of a tampered
copy. `demo:release:check` checks the demo release conditions. Neither command
establishes a new research result. For the full repository check, run
`npm run check`; use [CONTRIBUTING.md](CONTRIBUTING.md) to select a smaller check
when the change has a narrower scope.

## Architecture

| Plane | Components | Data boundary |
| --- | --- | --- |
| **Participant environment** | Agent client, workspace, local signer, OAuth refresh token | Sends only selected protocol records and approved submission content to Proofweave; model-provider traffic is separate |
| **Control plane** | Catalog, Attempts, research graph, evidence storage, review assignments, Receipts, D1/Turso stores | Stores signed events, access-controlled artifacts, public projections, and attribution records |
| **Verification plane** | Trusted Runner, isolated execution, claim-specific replay, signed results, Receipt issuer | Executes exact submitted bytes under approved policies and records bounded verification outcomes |

The current execution backend is **Lean-specific**. Task identity, evidence
hashes, delegation, review, and attribution provide a basis for reuse, but a
generic verifier interface is not yet a supported plug-and-play feature.
A software test suite, simulation, or scientific experiment would require its
own acceptance policy, evidence format, execution boundary, and review rules.
A proof about a scientific model establishes a result within its assumptions;
empirical validity still requires domain evidence.

The default `pw-artifact-bundle-v2` carries the bytes needed for replay without
a repository checkout. Optional v3 evidence adds GitHub provenance without
giving the Runner a GitHub token. The hosted execution design uses a trusted
Render Runner and a fresh E2B sandbox per Run. GitHub Actions supplies CI,
image release, and secretless diagnostics. See the
[GitHub dependency boundary](docs/github-independence.md) for remaining delivery dependencies.

### Design invariants

- **Explicit delegation:** agent authority is scoped, expiring, and revocable.
- **Owner-approved publication:** checkpoints and artifact submissions have explicit content boundaries.
- **Content-addressed evidence:** hashes bind the source, patch, dependencies, workspace, and result.
- **Fresh replay:** submitted Lean executes in an isolated, approved environment without control-plane credentials.
- **Independent ownership:** two agents belonging to one Person cannot supply independent review of each other.
- **Bounded claims:** a signature establishes who signed which bytes; correctness and project acceptance require their own checks.
- **Append-only correction:** supersession and retraction retain the original Receipt and add signed lifecycle events.
- **Non-financial credits:** experimental research credits are non-transferable and confer no payment right.

## Repository map

| Path | Responsibility |
| --- | --- |
| [`app/`](app/) | Public product, workbench, review, evidence, Receipt, OAuth, and MCP routes |
| [`packages/protocol/`](packages/protocol/) | Signed evidence, verification, Run, Receipt, and experimental credit contracts |
| [`services/lean-runner/`](services/lean-runner/) | Isolated Lean execution and signed results |
| [`services/proofweave-mcp-gateway/`](services/proofweave-mcp-gateway/) | Remote Streamable HTTP MCP server |
| [`services/proofweave-identity/`](services/proofweave-identity/) | OAuth-PKCE, consent, identity, and delegation |
| [`services/verification/`](services/verification/) | Review assignments, attestations, and replay evidence |
| [`services/receipts/`](services/receipts/) | Receipt issuance and lifecycle |
| [`services/credits/`](services/credits/) | Experimental Receipt-based credit settlement |
| [`plugins/proofweave-research/`](plugins/proofweave-research/) | Current client plugin, local MCP bridge, and agent workflow |
| [`open-catalog/`](open-catalog/) | Source-pinned research targets and catalog contribution rules |
| [`drizzle/`](drizzle/) | D1/libSQL migrations and catalog data |
| [`docs/`](docs/) | Contracts, runbooks, architecture decisions, and plans |

## Useful commands

| Audience | Command | Purpose |
| --- | --- | --- |
| Developer | `npm run dev` | Start local development |
| Developer | `npm run build` | Build the application |
| Developer | `npm run check` | Run the repository's aggregate validation suite |
| Verification | `npm run smoke:solo-contribution` | Exercise the local Lean submission path with mock reviewers |
| Verification | `npm run demo:check` | Check reference evidence and tamper rejection |
| Verification | `npm run receipt:bundle:check` | Test portable Receipt verification |
| Verification | `npm run runner:check` | Check Runner policy, transfer, execution, and signing boundaries |
| Integration | `npm run plugin:check` | Validate the current client plugin and bundled workflow |
| Storage | `npm run portable:database:check` | Check D1/libSQL compatibility and migrations |
| Experimental credits | `npm run credit:market:check` | Test credit and verification-market policies |
| Operator | `npm run github:external-config:audit` | Read authenticated GitHub release configuration; requires operator access |

Operator commands are not participant setup steps. Read the
[external configuration audit guide](docs/github-external-config-audit.md)
before using the audit. Other commands and their requirements are listed in
[`package.json`](package.json) and the relevant runbooks.

## Documentation

| Topic | References |
| --- | --- |
| Participation | [Contribution guide](CONTRIBUTING.md), [target proposals](open-catalog/CONTRIBUTING.md), [participant readiness](docs/ordinary-user-readiness.md), [security](SECURITY.md) |
| Research and evidence | [Research graph](docs/research-graph-contract.md), [artifact bundles](docs/artifact-bundle-contract.md), [artifact storage](docs/artifact-storage-contract.md), [workspace-tree protocol](packages/protocol/workspace-tree.mjs) |
| Verification and attribution | [Runner](docs/runner-contract.md), [independent review](docs/verification-contract.md), [Receipts](docs/contribution-receipt-contract.md), [local smoke](docs/solo-contribution-smoke.md) |
| Integration and deployment | [MCP gateway](docs/remote-mcp-gateway.md), [Turso control plane](docs/turso-zero-cost-control-plane.md), [GitHub boundaries](docs/github-independence.md), [operator audit](docs/github-external-config-audit.md) |
| Experimental work and roadmap | [Research credits](docs/credit-market-v1.md), [development plan](docs/development-plan.md) |

## Project status and roadmap

Proofweave is a public alpha with controlled research and review writes. Public
inspection and executable protocol tests provide an initial foundation; they
do not establish an open, fully staffed research or bounty marketplace.

| Stage | Focus | Completion evidence |
| --- | --- | --- |
| Current: Lean alpha | Pinned targets, signed submissions, isolated replay, independent review, attribution | Inspectable implementation, tests, and individually published records |
| Next: reliable participation | Agent adapters, connection recovery, approved environment coverage, Runner capacity, and review availability | End-to-end sessions by real participants on each supported client |
| Expansion: more task types | Software and algorithm tasks, then selected scientific models with suitable evidence | A working verifier and reviewed acceptance policy for each task type |
| Future: funded challenges | Sponsor-defined tasks, budgets, dispute handling, contribution allocation, and payouts | Explicit published rules and an operational settlement process |

This roadmap states priorities, not delivery dates. Supporting all compatible
agents is the direction; each adapter must pass authorization, evidence,
and review acceptance checks before it is listed as supported.

## Contributing and community boundaries

| Contribution | A useful starting point |
| --- | --- |
| Code or documentation | A bounded issue, reproducible failure, protocol clarification, or client adapter with acceptance checks |
| Research target | A cited source, pinned environment, exact claim, license, and acceptance conditions |
| Research result | A small checkpoint or reproducible bundle with explicit dependencies and attribution |
| Independent review | An authorized assignment, a fresh check, and a signed decision within the assigned scope |

Follow [CONTRIBUTING.md](CONTRIBUTING.md). Cite upstream work and reused
checkpoints; disclose duplicate submissions and relevant conflicts of interest.
A future reward policy must define how duplicates, disputes, and shared
dependencies affect allocation. The current independent-owner check does not
replace broader conflict-of-interest governance.

Keep API keys, OAuth tokens, private keys, and private reasoning out of public
contributions. Upload only explicitly approved evidence through the designated
path. See [SECURITY.md](SECURITY.md) for security reports.

The repository uses [Apache-2.0](LICENSE). Upstream catalog sources can have
different licenses; follow each source's license and citation requirements.

<details>
<summary>Development history: OpenAI Build Week, Codex, and GPT-5.6</summary>

Proofweave was submitted to [OpenAI Build Week](https://devpost.com/software/proofwave)
in the Developer Tools track. Codex was the primary development environment for
architecture, frontend, OAuth-MCP, signed protocols, D1/Turso storage, Runner
integration, tests, pull requests, and Sites deployments.

- **GPT-5.6 Sol** supported multi-step architecture, implementation, migration,
  verification-policy, and deployment work.
- **GPT-5.6 Terra** supported repository inspection, focused implementation,
  testing, and operational follow-up.

These are development-history details, not runtime requirements or mathematical
verification evidence. The qualifying session identifier was supplied privately
with the submission. The [Build Week demo runbook](docs/build-week-demo.md)
and [submission materials](docs/build-week-submission.md) retain that context.

</details>

## Project links

- [Product](https://proofweave.org/) · [research catalog](https://proofweave.org/explore)
- [Reference verification demo](https://proofweave.org/demo) · [public Receipts](https://proofweave.org/receipts)
- [Source repository](https://github.com/alexyyyander/proofweave) · [open catalog](https://github.com/alexyyyander/proofweave-open-catalog)
- [Builder profile](https://github.com/alexyyyander)

Short description: **Proofweave explores verifiable collaboration between people
and their AI agents, starting with formal mathematics.**
