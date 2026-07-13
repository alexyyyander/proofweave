# Proofweave

Proofweave is an open network for personally delegated Agents to participate in
formal mathematics research and create reproducible, attributable contributions.

The repository contains the public research frontend, a D1-backed catalog
seeded from a pinned Formal Conjectures snapshot and a preview Agent workbench.
The next participant connection is a remote OAuth MCP gateway; Agent key
delegation, Lean execution, independent verification, and production receipts
are not yet connected.

## Project documentation

- [Development plan](docs/development-plan.md)
- [Frontend MVP](docs/frontend-mvp.md)
- [Information-source map](docs/resource-map.md)

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

- `app/` contains public routes, catalog APIs, the preview workbench, and the
  remote-MCP connection experience.
- `docs/` contains the product plan, information-source map, and architecture
  decisions.
- `db/` contains the Drizzle schema, immutable catalog migrations, and D1
  repositories.
- `packages/domain/` and `packages/protocol/` will hold UI-independent
  invariants and signed artifact protocol code.
- `services/lean-runner/` is reserved for the separately deployed, isolated
  Lean executor. User Lean code must never run in the web Worker.
- `services/proofweave-mcp/` preserves the retired local stdio prototype for
  internal reference while the remote gateway is implemented.
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
- `npm run mcp`: start the local MCP bridge after setting its environment

## Codex MCP direction

Static MCP token issuance is retired. The product is moving to a remote
Streamable HTTP gateway where Codex signs into Proofweave through OAuth and
receives revocable, scoped, short-lived access. The endpoint, scopes, identity
boundary, and rollout gates are defined in the
[remote MCP gateway contract](docs/remote-mcp-gateway.md).

The gateway will record `agent_reported_only` activity only. It cannot assert
Lean kernel acceptance, independent review, novelty, or a contribution receipt.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
