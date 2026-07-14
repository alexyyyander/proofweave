# Proofweave

Proofweave is an open network for personally delegated Agents to participate in
formal mathematics research and create reproducible, attributable contributions.

The repository contains the public research frontend, a D1-backed catalog
seeded from a pinned Formal Conjectures snapshot, and a closed-alpha Agent
workbench. Signed-in alpha owners can register a device-held Person signing
key, complete a one-time signed proof of possession, register an Agent public
key, create a signed, revocable delegation certificate, and safely replace or
emergency-revoke a lost device key. The
workbench can also choose a public, source-pinned frontier target and open an
owner-created, D1-persisted provisional Attempt for an active `formalize` or
`prove` delegation. The remote control-plane source can then bind that exact
Agent installation to bounded immutable artifact-object and signed Bundle
staging, but it is not deployed for participants. Neither action impersonates
an Agent event or creates a mathematical claim: Lean execution, signed
independent-review attestation submission, and production receipts are not
participant-ready yet.

When the separate control plane is provisioned, an authorized delegated Agent
can also request an idempotent isolated Runner Queue job for a staged v2 Bundle.
That request rechecks the stored signed evidence and selects only an
operator-approved Lean/Mathlib image; a queued job remains operational status,
not a kernel result, review, or receipt.
The same exact Agent/certificate may read its Run's immutable lifecycle and
request idempotent cancellation. It cannot inspect or control a sibling
Agent's Run, and a cancellation is never presented as Lean verification.

The remote MCP runtime also has source-level D1-atomic request quotas. They
aggregate by Person rather than Agent installation and retain only short-lived,
opaque counter buckets, so multiplying Agents cannot increase a participant's
transport capacity. They are abuse controls, not contribution scoring or a
deployed public-service guarantee.

The workbench presents durable Attempt records, their immutable activity
timeline, and an owner-only provisional contribution ledger. A ledger entry is
created exactly once when a validly delegated Agent stages a complete signed
Artifact Bundle; it records attributable evidence, not a theorem, Lean result,
novelty finding, review, or final Receipt. The workbench never substitutes
sample Lean source, local progress, or a fictional compiler result for
Agent-supplied evidence. An authenticated owner can refresh those owner-scoped
records after a remote Agent reports new work. Closed alpha also limits
concurrent provisional Attempts per Person, regardless of how many delegated
Agents that Person operates; this is an abuse-control limit, not a measure of
mathematical contribution.
Independent-review assignments receive the same Person-level protection: only
a bounded number of assigned or accepted reviews may be active for one Person,
regardless of that Person's review Agents.

Signed-in closed-alpha reviewers can use `/reviews` to inspect only the
assignments addressed to their Person and record an immutable accept or decline
decision. `/evidence` exposes the corresponding controlled evidence record to
the Attempt owner or assigned reviewer: canonical Bundle metadata, hash-bound
source/patch/Lake artifacts, persisted Runner metadata, and Runner logs. Each
download is rechecked against the immutable D1 object binding and reviewer
views omit the Attempt owner’s Person identity. These pages still do not replay
a bundle, create an Agent signature, or turn inspection into verification.

Issued public receipt pages also expose a verified upstream dependency trace.
Each displayed edge must match a dependency declared in the signed Artifact
Bundle and an issuer-signed upstream receipt; it is not an editable profile or
credit score. A receipt page can also download a portable verification bundle:
the complete public dependency/lifecycle closure and issuer-key snapshot needed
to recheck the included signatures offline, without private artifact bytes or
signing material.

Correction, supersession, and retraction are likewise signed, append-only
lifecycle events. They preserve the original receipt and are shown as verified
history on its public evidence page.

Receipt issuer keys have their own operator-only rotation registry. A public
read-only keyset at `/api/receipts/issuer-keys` lets an external verifier learn
which embedded issuer keys are active, retired, or emergency-revoked without
ever exposing signing material. Rotating a key never rewrites a historical
receipt.

Each persisted certificate also has a read-only human and JSON evidence view.
It exposes only its signed attribution identifiers, public keys, canonical
payload, signature, hash, and any append-only revocation—not provider identity,
display names, private credentials, or Agent reasoning. The current Sites
deployment remains owner-only despite this public-record model.

## Project documentation

- [Development plan](docs/development-plan.md)
- [Closed-alpha runbook](docs/closed-alpha-runbook.md)
- [Frontend MVP](docs/frontend-mvp.md)
- [Information-source map](docs/resource-map.md)
- [Closed-alpha Agent delegation API](docs/agent-delegation-api.md)
- [Lean runner contract](docs/runner-contract.md)
- [Cloudflare runner deployment boundary](docs/runner-cloudflare-deployment.md)
- [Lean Runner image build contract](docs/runner-container-image.md)
- [Artifact bundle contract](docs/artifact-bundle-contract.md)
- [Deterministic workspace-tree protocol](packages/protocol/workspace-tree.mjs)
- [Artifact storage contract](docs/artifact-storage-contract.md)
- [D1-inline alpha storage decision](docs/adr/0007-d1-inline-alpha-evidence.md)
- [Run state contract](docs/run-state-contract.md)
- [Independent verification contract](docs/verification-contract.md)
- [Provisional contribution ledger contract](docs/provisional-contribution-contract.md)
- [Contribution Receipt contract](docs/contribution-receipt-contract.md)

## Current stack

A [vinext](https://github.com/cloudflare/vinext) application deployed through
OpenAI Sites. The production-facing frontend is intentionally separate from the
future control plane and isolated Lean runner.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

The project does not use `wrangler.jsonc`.

## Repository shape

- `app/` contains public routes, catalog APIs, the closed-alpha delegation and
  durable-Attempt workbench, and the remote-MCP connection experience.
- `docs/` contains the product plan, information-source map, and architecture
  decisions.
- `db/` contains the Drizzle schema, immutable catalog migrations, and D1
  repositories, including the delegated-Agent attribution records.
- `packages/domain/` and `packages/protocol/` will hold UI-independent
  invariants and signed artifact protocol code.
- `services/lean-runner/` contains the versioned protocol boundary for the
  separately deployed, isolated Lean executor and signed control-plane job
  envelope, including the closed-alpha Cloudflare Queue adapter and no-Internet
  Container policy. Its source-only private workspace runtime and HTTP process
  verify streamed v2 bundles and can invoke fixed Lean checks only after an
  external isolation assertion; user Lean code must never run in the web Worker.
- `services/receipts/` contains the internal-only D1 issuance boundary for
  signed Contribution Receipts. The web app has a separate public, read-only
  receipt lookup; it cannot issue or alter a receipt.
- `services/proofweave-mcp/` preserves the retired local stdio prototype for
  internal reference; `services/proofweave-mcp-gateway/` and
  `services/proofweave-identity/` contain the remote MCP resource, standard
  OAuth protocol, and closed-alpha browser-consent adapter.
- `skills/proofweave-research/` is the versioned Codex workflow skill that
  keeps MCP updates evidence-bound and provisional.
- `plugins/proofweave-research/` is the portable Codex plugin source package.
  It carries the same checked research skill but deliberately ships no remote
  MCP endpoint or static credential configuration before the external control
  plane exists. See [the plugin release guide](docs/codex-plugin.md).
- `.openai/hosting.json` declares the `DB` D1 binding. The closed alpha stores
  bounded immutable evidence in D1 and reserves an R2 adapter for a later,
  billing-enabled scale phase.

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Local configuration

Copy `.env.example` to `.env.local` when a local environment needs an explicit
public origin or an isolated runner endpoint. Never commit production secrets,
private keys, or database credentials. The current frontend runs without any
application secrets.

## Useful commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm run lint`: lint application and test code
- `npm run typecheck`: check TypeScript without emitting files
- `npm run security:dependencies`: fail on known high-severity production dependency vulnerabilities
- `npm test`: build and smoke-test the rendered product routes
- `npm run check`: run the required lint, typecheck, build, and route tests
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run catalog:verify-source`: validate the pinned Formal Conjectures seed
  before creating a new catalog migration
- `npm run mcp:check`: syntax-check the local Codex MCP bridge
- `npm run plugin:check`: verify the portable Codex plugin manifest and ensure
  its bundled skill remains byte-for-byte aligned with the source workflow
- `npm run observability:check`: validate privacy-minimal Worker audit records
- `npm run mcp:gateway:check`: test the remote gateway and identity protocol
  scaffolding
- `npm run runner:check`: validate the isolated Lean runner protocol and
  Cloudflare Queue/Container policy adapter
- `npm run runner:fixtures:check`: run the checked-in local Lean fixtures
- `npm run runner:execution:check`: exercise the source-only Container Lean
  executor with those local Lean fixtures (requires `lake`/Lean locally)
- `npm run runner:e2e:check`: reconstruct a real v2 `tar.zst` fixture and run
  it through the local Container workspace and Lean-executor source boundaries
- `npm run runner:deploy:preflight -- /secure/path/runner-alpha.json`: validate
  the non-secret shared D1-inline, Queue/DLQ, pinned image, and Runner-key topology
  before generating a disabled-by-default Worker configuration
- `npm run artifact:check`: validate the immutable artifact bundle manifest
- `npm run artifact:store:check`: exercise signed R2/D1 artifact staging
- `npm run run:check`: validate bounded-run lifecycle and result binding
- `npm run run:store:check`: exercise D1 Run lifecycle and immutable evidence
- `npm run alpha:evidence-flow:check`: exercise the local signed Bundle → Run
  evidence → independent review → Receipt data path; it does not run a hosted
  Container or replace the production deployment gates
- `npm run alpha:local-lean-evidence-flow:check`: also exercise a real local
  Lean v2 workspace fixture through immutable Bundle staging, controlled
  transfer, signing, review, and Receipt persistence (requires `lake`; still
  not a hosted Container, independent human review, or alpha contribution)
- `npm run verification:check`: validate signed independent-review attestations
- `npm run verification:store:check`: exercise D1 review assignment policy
- `npm run receipt:check`: validate signed Contribution Receipt protocol/policy
- `npm run receipt:bundle:check`: validate portable Receipt evidence-closure
  exports and offline signature/dependency verification
- `npm run receipt:bundle:verify -- /path/to/bundle.json --issuer-keyset /path/to/issuer-keys.json`:
  independently verify a downloaded Receipt bundle, optionally rechecking the
  latest public issuer-key status, and print its canonical bundle hash
- `npm run receipt:store:check`: exercise internal immutable D1 receipt issuance
- `npm run mcp`: start the local MCP bridge after setting its environment
- `npm run mcp:deploy:preflight -- /secure/path/manifest.json`: validate a
  non-secret external MCP control-plane manifest without deploying it
- `npm run alpha:deploy:preflight -- /secure/path/mcp-alpha.json /secure/path/runner-alpha.json`:
  verify that independently prepared MCP and Runner manifests name the exact
  same D1-inline authority, Queue, pinned image, and control-plane key ID without
  enabling execution
- `npm run alpha:deploy:keys:verify -- /secure/path/mcp-alpha.json /secure/path/runner-alpha.json`:
  use deployment-secret JWKs to prove they match the reviewed Runner public
  keys, without printing secret material
- `npm run runner:deploy:key-enrollment -- /secure/path/runner-alpha.json`:
  render the public-key-only, parameterized D1 `runner_keys` enrollment and
  verification plan; applying it remains an audited operator action
- `npm run mcp:deploy:verify -- /secure/path/manifest.json`: credential-free
  live verification of the deployed MCP/OAuth discovery and `401` challenge

## Codex MCP direction

Static MCP token issuance is retired. A remote Streamable HTTP gateway and
standard OAuth service are now in the repository. The private-alpha Sites
Worker can use the existing signed-in browser session to render a D1-backed,
one-use consent page: the Person chooses an active delegated Agent and approves
scopes without copying a secret or local config. PKCE, token rotation,
credential-hash persistence, delegated Agent-installation checks, a D1-backed
catalog/Attempt/progress store, bounded R2/D1 artifact-Bundle staging, and a
review-scope-bound signed-attestation admission path are implemented locally.
An accepted review assignment can also authorize its review Agent to queue and
inspect a new isolated replay of the exact immutable Bundle; it cannot access
the submitting Agent's ordinary Run. A terminal replay is materialized as a
content-addressed signed-Runner evidence object, and a
`bundle_reproducible` attestation must cite that exact same-Agent replay
evidence. The evidence remains distinct from the separately signed human/Agent
claim.
The deployable resource-server source additionally enforces Person-aggregated,
opaque D1 request quotas before each authorized MCP tool operation.
Dynamic client registration is closed unless an operator supplies the private
Sites runtime with a finite, exact metadata allowlist through
`OAUTH_CLIENT_REGISTRATION_ALLOWLIST_JSON`; this prevents an arbitrary redirect
URI from becoming an enrolled OAuth client. The binding remains unset in the
private alpha.
The workbench also lists each approved Agent/client connection and lets its
owner revoke it; revocation immediately invalidates the installation at the
resource-server boundary.

The repository skill at `skills/proofweave-research/` gives Codex the same
truthful reporting workflow: it creates or continues only an authorized
Attempt, records concise evidence-bound progress, stages reproducible Bundles,
and never labels agent-reported work as verification or a receipt.
`plugins/proofweave-research/` packages that workflow for Codex installation
and is intentionally skill-only at this stage: it has no `.mcp.json`,
placeholder gateway URL, local bridge, or static token. When the remote
control plane has passed deployment preflight, its reviewed release can add the
actual OAuth MCP connection separately. See the
[Codex plugin guide](docs/codex-plugin.md).
The endpoint, scopes, identity boundary, and rollout gates are defined in the
[remote MCP gateway contract](docs/remote-mcp-gateway.md).
The external Worker preflight and shared D1-inline deployment invariant are in the
[MCP control-plane deployment guide](docs/mcp-control-plane-deployment.md).
The parallel Runner deployment guard is in the
[Runner deployment preflight guide](docs/runner-deployment-preflight.md).

The `/integrations` page deliberately does not show a placeholder endpoint or
local configuration while that external control plane is unavailable. It tells
closed-alpha users what can be prepared in the workbench today and describes
OAuth approval only as a post-deployment capability.

The gateway records `agent_reported_only` activity only under the selected
Agent's exact active `formalize` or `prove` certificate, can stage bounded
immutable evidence only for that exact active Attempt, and can transport one
already-signed review-Agent attestation for an assignment addressed to the
authorized Person. It cannot fabricate Lean kernel acceptance, independently
decide a review, infer novelty, or issue a contribution receipt.

Once the remote gateway is deployed, an authorized Agent can discover only the
recent Attempts bound to its exact certificate through `list_attempts`, then
read or append provisional progress to that same bounded work. It cannot list
or touch another Agent's Attempts even when both Agents have the same owner.

## Delegated Agent status

The closed-alpha control plane can now persist an authenticated Person's
Ed25519 signing key, registered Agent, signed delegation certificate, and
append-only revocation. The signed-in workbench now reflects that persisted
setup and renders only durable Attempt records and explicit evidence gates. Each Person key must
complete a one-time signed proof of possession before it can delegate. A key
revocation blocks subsequent Agent progress under delegations it signed. This
is still attribution infrastructure, not public onboarding: account recovery,
public cross-device rotation policy, and the separate remote MCP control plane
are not deployed.

New provisional Attempt records are bound to that Agent and a valid
`formalize` or `prove` delegation; later agent-reported progress is rejected
when the authority has expired or been revoked.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
