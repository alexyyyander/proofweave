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
`prove` delegation. That does not impersonate an Agent event or create a
mathematical claim: the research branch's progress controls, remote connection,
Lean execution, signed independent-review attestation submission, and
production receipts are not participant-ready yet.

Signed-in closed-alpha reviewers can use `/reviews` to inspect only the
assignments addressed to their Person and record an immutable accept or decline
decision. `/evidence` exposes the corresponding controlled evidence record to
the Attempt owner or assigned reviewer: canonical Bundle metadata, hash-bound
source/patch/Lake artifacts, persisted Runner metadata, and Runner logs. Each
download is rechecked against the immutable D1/R2 object binding and reviewer
views omit the Attempt owner’s Person identity. These pages still do not replay
a bundle, create an Agent signature, or turn inspection into verification.

Issued public receipt pages also expose a verified upstream dependency trace.
Each displayed edge must match a dependency declared in the signed Artifact
Bundle and an issuer-signed upstream receipt; it is not an editable profile or
credit score.

Correction, supersession, and retraction are likewise signed, append-only
lifecycle events. They preserve the original receipt and are shown as verified
history on its public evidence page.

Each persisted certificate also has a read-only human and JSON evidence view.
It exposes only its signed attribution identifiers, public keys, canonical
payload, signature, hash, and any append-only revocation—not provider identity,
display names, private credentials, or Agent reasoning. The current Sites
deployment remains owner-only despite this public-record model.

## Project documentation

- [Development plan](docs/development-plan.md)
- [Frontend MVP](docs/frontend-mvp.md)
- [Information-source map](docs/resource-map.md)
- [Closed-alpha Agent delegation API](docs/agent-delegation-api.md)
- [Lean runner contract](docs/runner-contract.md)
- [Cloudflare runner deployment boundary](docs/runner-cloudflare-deployment.md)
- [Lean Runner image build contract](docs/runner-container-image.md)
- [Artifact bundle contract](docs/artifact-bundle-contract.md)
- [Deterministic workspace-tree protocol](packages/protocol/workspace-tree.mjs)
- [Artifact storage contract](docs/artifact-storage-contract.md)
- [Run state contract](docs/run-state-contract.md)
- [Independent verification contract](docs/verification-contract.md)
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
  `services/proofweave-identity/` contain the separate remote MCP resource and
  OAuth-identity Worker scaffolding.
- `skills/proofweave-research/` is the versioned Codex workflow skill that
  keeps MCP updates evidence-bound and provisional.
- `.openai/hosting.json` declares the `DB` D1 binding and `ARTIFACTS` R2
  binding. The catalog uses D1 now; R2 is reserved for immutable bundles in
  the runner phase.

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
- `npm test`: build and smoke-test the rendered product routes
- `npm run check`: run the required lint, typecheck, build, and route tests
- `npm run db:generate`: generate Drizzle migrations after schema changes
- `npm run catalog:verify-source`: validate the pinned Formal Conjectures seed
  before creating a new catalog migration
- `npm run mcp:check`: syntax-check the local Codex MCP bridge
- `npm run mcp:gateway:check`: test the remote gateway and identity protocol
  scaffolding
- `npm run runner:check`: validate the isolated Lean runner protocol and
  Cloudflare Queue/Container policy adapter
- `npm run runner:fixtures:check`: run the checked-in local Lean fixtures
- `npm run runner:execution:check`: exercise the source-only Container Lean
  executor with those local Lean fixtures (requires `lake`/Lean locally)
- `npm run runner:e2e:check`: reconstruct a real v2 `tar.zst` fixture and run
  it through the local Container workspace and Lean-executor source boundaries
- `npm run artifact:check`: validate the immutable artifact bundle manifest
- `npm run artifact:store:check`: exercise signed R2/D1 artifact staging
- `npm run run:check`: validate bounded-run lifecycle and result binding
- `npm run run:store:check`: exercise D1 Run lifecycle and immutable evidence
- `npm run verification:check`: validate signed independent-review attestations
- `npm run verification:store:check`: exercise D1 review assignment policy
- `npm run receipt:check`: validate signed Contribution Receipt protocol/policy
- `npm run receipt:store:check`: exercise internal immutable D1 receipt issuance
- `npm run mcp`: start the local MCP bridge after setting its environment

## Codex MCP direction

Static MCP token issuance is retired. A remote Streamable HTTP gateway and
separate OAuth identity-service scaffold are now in the repository; they are
not deployed until the independent browser identity and consent layers are
configured. PKCE, token rotation, credential-hash persistence, delegated
Agent-installation checks, a D1-backed catalog/Attempt/progress store, and a
review-scope-bound signed-attestation admission path are implemented locally.
The endpoint, scopes, identity boundary, and rollout gates are defined in the
[remote MCP gateway contract](docs/remote-mcp-gateway.md).

The gateway records `agent_reported_only` activity only under the selected
Agent's exact active `formalize` or `prove` certificate and can transport one
already-signed review-Agent attestation for an assignment addressed to the
authorized Person. It cannot fabricate Lean kernel acceptance, independently
decide a review, infer novelty, or issue a contribution receipt.

## Delegated Agent status

The closed-alpha control plane can now persist an authenticated Person's
Ed25519 signing key, registered Agent, signed delegation certificate, and
append-only revocation. The signed-in workbench now reflects that persisted
setup while its research-run content remains preview-only. Each Person key must
complete a one-time signed proof of possession before it can delegate. A key
revocation blocks subsequent Agent progress under delegations it signed. This
is still attribution infrastructure, not public onboarding: account recovery,
public cross-device rotation policy, and the separate remote identity/MCP
services are not deployed.

New provisional Attempt records are bound to that Agent and a valid
`formalize` or `prove` delegation; later agent-reported progress is rejected
when the authority has expired or been revoked.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
