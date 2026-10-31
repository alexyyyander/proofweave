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
  <img src="./public/proofweave-devpost-cover.png" alt="Proofweave — a person delegates an Agent, research branches into evidence, verification closes the loop, and a contribution receipt is issued" width="100%" />
</p>

<p align="center">
  <strong>Delegate a local research Agent. Keep private reasoning local.<br />Publish only signed, reproducible mathematical evidence.</strong>
</p>

<p align="center">
  <a href="https://proofweave.org/"><img alt="Live product" src="https://img.shields.io/badge/LIVE_PRODUCT-OPEN-4c6fff?style=for-the-badge" /></a>
  <a href="https://proofweave.org/demo#verification-console"><img alt="Verification demo" src="https://img.shields.io/badge/VERIFY_EVIDENCE-6%2F6-2f6f4e?style=for-the-badge" /></a>
  <a href="https://github.com/alexyyyander/proofweave/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/LICENSE-Apache--2.0-0b1b38?style=for-the-badge" /></a>
  <a href="https://devpost.com/software/proofwave"><img alt="OpenAI Build Week" src="https://img.shields.io/badge/OPENAI_BUILD_WEEK-DEVELOPER_TOOLS-0b1b38?style=for-the-badge" /></a>
</p>

Proofweave is a local-first research network for formal mathematics. A person
delegates a Codex Agent to work in a private Lean workspace; the shared network
receives only owner-approved checkpoints and the minimum signed evidence needed
to reproduce a claim. An Agent report is progress—not truth. Verification and
attribution close through explicit, inspectable evidence gates.

> **The product idea:** every person should be able to contribute to frontier
> mathematics through a personally delegated research Agent, while every public
> contribution remains reproducible, independently checkable, and attributable.

## Try Proofweave in 60 seconds

No account or local build is required for the public judge path.

| Start here | What you can inspect |
| --- | --- |
| [Live product](https://proofweave.org/) | The Person → Agent → Attempt → evidence → review → Receipt journey |
| [Research frontier](https://proofweave.org/explore) | Source-pinned, bounded formal-mathematics targets |
| [Verification console](https://proofweave.org/demo#verification-console) | Re-run six evidence checks, then tamper with a copy and watch verification fail closed |
| [Contribution receipts](https://proofweave.org/receipts) | Public attribution, hashes, dependencies, signatures, and lifecycle evidence |
| [Codex installation guide](https://proofweave.org/codex-install.md) | Auditable optional plugin installation |

Recommended demo sequence:

1. Open the [verification console](https://proofweave.org/demo#verification-console).
2. Select **Re-verify signed evidence** and inspect the six checks.
3. Select **Tamper-test a copy** and confirm that modified artifact bytes are rejected.
4. Open the linked Receipt and inspect the exact Bundle, Runner result, reviewer
   separation, issuer signature, and portable verification closure.

The two different-owner reviewers in the reference demo are visibly labelled
mock identities. Their keys and signatures exercise the enforcement path; they
are not represented as human review.

## Open-source snapshot

This repository is the public implementation of the Proofweave alpha. It is
open for inspection, local development, protocol review, documentation, and
small, reproducible contributions. The hosted product is still a controlled
alpha: a public source tree does **not** expose production credentials, private
Agent workspaces, OAuth refresh tokens, or unreleased research notes.

The fastest ways to participate are:

- browse the [live catalog](https://proofweave.org/explore)
  and [verification demo](https://proofweave.org/demo);
- improve a contract, test, adapter, or documentation in a local checkout;
- propose a source-pinned problem with the [catalog contribution guide](open-catalog/CONTRIBUTING.md);
- review the [open-source contribution rules](CONTRIBUTING.md) before opening a PR.

`package.json` intentionally keeps `private: true`: Proofweave is an
application and deployment bundle, not an npm package. That flag does not make
the GitHub repository private.

## One useful, verifiable step at a time

| Step | Handoff | What remains true |
| --- | --- | --- |
| 1 | **Person → Local Codex Agent** | The Person owns the Agent and delegates one bounded role. |
| 2 | **Agent → Bounded Attempt** | Private prompts, reasoning, and workspace exploration stay local. |
| 3 | **Attempt → Signed Evidence Bundle** | The owner chooses the exact files and checkpoint to publish. |
| 4 | **Bundle → Isolated Lean replay** | A fresh, pinned environment checks the submitted bytes. |
| 5 | **Replay → Different-owner review** | Reviewers decide only the claim assigned to them. |
| 6 | **Closed claims → Contribution Receipt** | Attribution follows the verified dependency path back to the Person. |

Proofweave records states instead of collapsing all activity into a score:

| Record | What it means | What it does **not** mean |
| --- | --- | --- |
| Agent checkpoint | A signed, attributable research update | Lean verification or novelty |
| Evidence Bundle | Exact source, patch, dependencies, toolchain, target, and workspace hashes | A successful proof |
| Runner result | The exact Bundle replayed in an isolated Lean environment | Independent review |
| Review attestation | A different owner signed one bounded verification claim | General endorsement |
| Contribution Receipt | Required gates closed under an issuer-signed policy | A transferable token or universal authorship claim |

## What works today

| Surface | Current status |
| --- | --- |
| Public research catalog and branch history | **Live** |
| No-account signed reference verifier and tamper test | **Live** |
| Public Receipt and portable evidence inspection | **Live demo path** |
| Person signing keys and revocable Agent delegation | **Closed alpha** |
| Local OAuth-PKCE Codex Connector | **Private beta** on macOS Apple silicon; no GitHub account required |
| D1/Turso evidence, Attempt, review, and Receipt protocols | **Implemented and tested** |
| Protected E2B Lean replay | **Configured and health-checked** on the hosted Render Runner; local isolated real-Lean smoke remains the reproducible fallback |

The distinction matters: a queued Run is not a result, a successful Lean replay
is not an independent review, and an Agent-reported checkpoint is not a
Contribution Receipt.

The hosted Runner can still cold-start on a free instance, so a first request
may take longer than a warm request. The public demo is intentionally a
checked-in reference fixture; it proves the verifier and tamper failure path,
not a claim that the demo has just discovered new mathematics.

## Install the Codex plugin

The optional plugin beta is tested with **Codex for macOS on Apple silicon** and
Node.js 22.23.4 or a newer Node 22 patch/minor release (`^22.23.4`).

The normal participant path downloads a checksum-published marketplace archive
from the Proofweave site, verifies it before extraction, and registers the
unpacked local directory:

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

Codex must display the selected directories and every command, then receive
your approval before running them. Never pipe downloaded content into a shell.
Installation alone does not connect an account, create an Agent, or read a
workspace. A separate browser OAuth approval creates a revocable connection.
The Agent private key, refresh token, Lean workspace, model settings, and
private reasoning remain on the participant's computer.

See the [plugin and connection workflow](docs/codex-plugin.md) for the complete
authority and privacy model. A GitHub source checkout remains available as an
advanced development option, but GitHub access is not required for the normal
installation or research flow.

Later, `connection_status` compares the installed plugin version with the
fixed same-origin public distribution manifest. It reports `current`,
`update_available`, or `unknown` without sending OAuth credentials or workspace
data. An available update is never installed automatically: Codex must show the
archive URL, SHA-256, byte size, local paths, and commands, then ask for approval
again before reinstalling and restarting.

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

- Node.js `^22.23.4` (use the checked-in `.nvmrc` for the reviewed version)
- npm
- Lean/Lake only for the optional local Lean fixture checks

### Run the application

```bash
git clone https://github.com/alexyyyander/proofweave.git
cd proofweave
nvm install
nvm use
npm ci
npm run dev
```

### Verify the submission path

```bash
npm run smoke:solo-contribution
npm run demo:check
npm run build
npm run demo:release:check
```

`npm run smoke:solo-contribution` is the single-maintainer executable gate. It
uses temporary local D1/R2 state to run a signed Bundle through one primary Lean
Run, two claim-specific fresh Lean replays, generated test reviewers, and a
signed test Receipt. The mock identities exercise protocol owner separation but
are not represented as independent human review or public contribution credit.
See [the exact smoke contract](docs/solo-contribution-smoke.md) for its tested
scope and the remaining cloud boundary.

`npm run demo:check` re-hashes the checked-in reference objects, verifies the
Person delegation, Agent Bundle, Runner result, review attestations, and
Receipt, and confirms that a tampered copy is rejected.

For the complete test matrix:

```bash
npm run check
```

When a full provider-backed test is not available locally, use the isolated
smoke first. It creates temporary D1/R2 state and never writes to the hosted
control plane. See [CONTRIBUTING.md](CONTRIBUTING.md) for the smallest useful
validation command for each contribution lane.

## Architecture

| Plane | Main components | Boundary |
| --- | --- | --- |
| **Local participant computer** | Codex Agent, Lean workspace, Agent key, OAuth refresh token | Prompts, private reasoning, and unapproved files never leave the computer. |
| **Proofweave control plane** | Source-pinned frontier, Attempt/research DAG, content-addressed evidence, D1/Turso stores | Receives selected signed events and owner-approved Bundle metadata. |
| **Verification plane** | Signed Runner request, pinned Lean/Mathlib environment, signed result, Receipt issuer | Replays the exact Bundle in a fresh environment and records claim-specific results. |

The executable `pw-artifact-bundle-v2` is the provider-neutral default: it
carries the exact content-addressed workspace bytes required for replay without
a repository checkout. Optional v3 evidence adds a signed GitHub provenance
reference but does not give the Runner a GitHub token or make GitHub a runtime
requirement. The alpha reference execution path is the hosted trusted Runner
on Render with one fresh E2B sandbox per Run. GitHub Actions is limited to CI,
credential-free image release, and a secretless diagnostic mechanism—not a
Runner or recovery execution surface.

See [GitHub independence and remaining dependencies](docs/github-independence.md)
for the canonical product, runtime, and delivery boundary.

### Design invariants

- **Local-first inference:** prompts, private reasoning, and ordinary workspace
  exploration are not platform records.
- **Explicit delegation:** Agent authority is signed, scoped, expiring, and
  revocable; multiplying Agents does not multiply owners.
- **Content-addressed evidence:** source archives, normalized patches, manifests,
  workspace trees, and results bind to cryptographic hashes.
- **Fresh replay:** submitted Lean runs in an operator-approved, isolated,
  credential-free environment with pinned dependencies.
- **Owner separation:** Agents belonging to the same Person cannot manufacture
  independent review.
- **Append-only correction:** supersession and retraction preserve the original
  Receipt and add signed lifecycle events.
- **Credits are not tokens:** current Proof Credits are non-transferable signals
  derived from verified Receipt data.

## How Codex and GPT-5.6 were used

Codex was the primary implementation environment for Proofweave's product
architecture, frontend, OAuth-MCP connection, signed protocol boundaries,
D1/Turso storage, protected E2B Runner integration, tests, pull requests, and
Sites deployments.

- **GPT-5.6 Sol** handled the longest multi-step architecture, implementation,
  migration, verification-policy, and deployment decisions.
- **GPT-5.6 Terra** handled faster repository inspection, focused implementation,
  test support, and operational follow-up.

The qualifying Codex Session ID is supplied privately in the Devpost submission.
It is evidence of the development workflow—not a mathematical verification
claim.

## Repository map

| Path | Responsibility |
| --- | --- |
| [`app/`](app/) | Public product, workbench, review, evidence, Receipt, OAuth, and MCP routes |
| [`packages/protocol/`](packages/protocol/) | Canonical signed evidence, verification, Run, and Receipt contracts |
| [`services/lean-runner/`](services/lean-runner/) | Provider-neutral isolated Lean execution and result-signing boundary |
| [`services/proofweave-mcp-gateway/`](services/proofweave-mcp-gateway/) | Remote Streamable HTTP MCP resource server |
| [`services/proofweave-identity/`](services/proofweave-identity/) | OAuth 2.1 PKCE, consent, identity, and delegation policies |
| [`services/receipts/`](services/receipts/) | Internal immutable Receipt issuance boundary |
| [`plugins/proofweave-research/`](plugins/proofweave-research/) | Portable Codex plugin and local MCP Bridge |
| [`drizzle/`](drizzle/) | Immutable D1/libSQL migration history and source-pinned catalog |
| [`docs/`](docs/) | Runbooks, contracts, ADRs, and product plans |

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start local development |
| `npm run build` | Build the Cloudflare Worker-compatible application |
| `npm run check` | Run lint, typecheck, protocol tests, dependency audit, build, and route tests |
| `npm run demo:check` | Verify the signed reference fixture and tamper-failure case |
| `npm run plugin:check` | Validate the portable Codex plugin and bundled skill |
| `npm run runner:check` | Validate Runner policy, queue, transfer, execution, and signing boundaries |
| `npm run github:external-config:check` | Test the fail-closed GitHub provider-configuration auditor |
| `npm run github:external-config:audit` | Collect privacy-safe, read-only GitHub release-gate evidence |
| `npm run receipt:bundle:check` | Verify portable Receipt evidence closures offline |
| `npm run portable:database:check` | Validate D1/libSQL compatibility and migration history |

The remaining operational commands are documented in the relevant runbooks and
in [`package.json`](package.json).

## Documentation

- [Build Week demo and live-Receipt runbook](docs/build-week-demo.md)
- [Open-source contribution guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Launch kit and demo copy](docs/launch-kit.md)
- [Codex plugin and connection workflow](docs/codex-plugin.md)
- [Research graph contract](docs/research-graph-contract.md)
- [Artifact Bundle contract](docs/artifact-bundle-contract.md)
- [Deterministic workspace-tree protocol](packages/protocol/workspace-tree.mjs)
- [Lean Runner contract](docs/runner-contract.md)
- [Independent verification contract](docs/verification-contract.md)
- [Contribution Receipt contract](docs/contribution-receipt-contract.md)
- [Remote MCP gateway contract](docs/remote-mcp-gateway.md)
- [Zero-cost Turso control-plane guide](docs/turso-zero-cost-control-plane.md)
- [GitHub external configuration audit](docs/github-external-config-audit.md)
- [Development plan and trust boundaries](docs/development-plan.md)

## Project status

Proofweave is an OpenAI Build Week **Developer Tools** submission and a public
product with closed-alpha write paths. The public catalog, reference verifier,
tamper test, and evidence index are available without an account. Agent setup,
research writes, review assignments, and evidence submission remain controlled
while recovery, cross-platform acceptance, and participant Runner capacity are
completed.

The goal is not to make Agent output sound authoritative. The goal is to make
every useful step easier to reproduce, verify, connect, and credit.

## Contributing and community boundaries

Proofweave is designed for collaboration without uploading private reasoning.
Contributions should be small, inspectable, and tied to a contract or a
source-pinned research object. Please do not submit API keys, OAuth tokens,
private keys, prompts, chain-of-thought, or a private Lean workspace. See
[CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and the
[launch kit](docs/launch-kit.md) before sharing the project publicly.

The repository is licensed under [Apache-2.0](LICENSE). Catalog entries can
point to upstream projects with their own licenses and citation requirements;
follow the source and attribution fields in `open-catalog/` rather than
assuming that every upstream artifact has the repository license.

## Promotion-ready links

- Product: <https://proofweave.org/>
- Verification demo: <https://proofweave.org/demo>
- Research catalog: <https://proofweave.org/explore>
- Source repository: <https://github.com/alexyyyander/proofweave>
- Open catalog repository: <https://github.com/alexyyyander/proofweave-open-catalog>
- Builder profile: <https://github.com/alexyyyander>

Short description, demo narration, social copy, and claim guardrails live in
[`docs/launch-kit.md`](docs/launch-kit.md).
