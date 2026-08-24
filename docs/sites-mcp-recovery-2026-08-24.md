# Sites and MCP recovery — 2026-08-24

This runbook records the current production incident, the evidence already
available in the repository, and the only safe recovery order. It deliberately
separates Sites project access, public edge access, application deployment,
OAuth/MCP, Turso, and the trusted Runner. A healthy value in one layer is not
evidence that another layer works.

## Decision summary

The canonical Site identity is already known and consistent:

- public origin:
  `https://proofweave-research.yualex031821.chatgpt.site`;
- Sites project ID:
  `appgprj_6a54400d01a8819199224b722afae056`;
- repository: `alexyyyander/proofweave`;
- configured Turso fingerprint: `3f9e7934a04a22ec`;
- last Runner-configured Sites version: `156`.

Do not create a replacement Site, derive a project ID from the slug, or replace
`.openai/hosting.json`. The immediate control-plane blocker is that the Sites
API returns `project_not_found` for the canonical project in the current
OpenAI workspace/account context. The public origin also returns Cloudflare
`403` before any Proofweave route can be validated.

The safe recovery is therefore:

1. restore visibility of the existing Sites project in the correct OpenAI
   workspace/account;
2. inspect its access policy, live URL, current version, environment, and logs;
3. align and push the exact release commit to the configured source branch;
4. save and deploy a version from the successful build of that exact commit;
5. restore public discovery and read-only MCP before any authenticated or
   writable operation;
6. restore Turso release verification on Sites and Render;
7. keep Runner execution disabled until release identity, migration ledger,
   OAuth revocation, and an isolated Lean smoke all pass.

## Why a correct URL and correct OAuth values are not sufficient

The request must cross several independently controlled boundaries:

```text
visitor or Codex
  -> chatgpt.site Cloudflare edge and Site audience policy
  -> existing Sites project and deployed version
  -> Proofweave Worker route
  -> OAuth issuer / consent / token state
  -> MCP resource authorization
  -> shared Turso migration ledger
  -> optional Render/E2B Runner
```

OAuth client metadata is evaluated only after the request reaches the deployed
authorization routes. A valid MCP URL and a previously saved refresh token
cannot repair a disabled/invisible Site, a Cloudflare block, an unavailable
deployment, or a failed Turso verification. Conversely, reconnecting OAuth
cannot make a `403` edge response become a valid MCP challenge.

OpenAI documents Site audience and application authentication as separate
controls. Public publishing also depends on the current workspace and admin
policy. Cloudflare documents that Bot Management sets `__cf_bm`, that edge
rules can return `403`, and that Ray IDs are the correlation key for support
and log investigation:

- [Creating and managing ChatGPT Sites](https://help.openai.com/en/articles/20001339-creating-and-managing-chatgpt-sites)
- [Managing ChatGPT Sites for your workspace](https://help.openai.com/en/articles/20001338-managing-chatgpt-sites-for-your-workspace)
- [Cloudflare 4xx and 403 troubleshooting](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/)
- [Cloudflare cookies and `__cf_bm`](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/)

## Evidence by layer

| Layer | Evidence on 2026-08-24 | Interpretation | Required state |
| --- | --- | --- | --- |
| Local source | `codex/mcp-runtime-health` at `1205228045e53e3469cce4f97bedde9dde0b9260`; remote feature branch has the same SHA | The MCP health fix is safely pushed on its feature branch | The configured production source branch, and repository `origin/main` under current policy, must point to this exact reviewed SHA before saving a Site version |
| Site identity | `.openai/hosting.json`, production policy, historical commits, and Runner config all name `appgprj_6a54400d01a8819199224b722afae056` | The local ID is not an accidental or newly invented value | The current OpenAI identity must be owner/editor of this exact project |
| Sites control plane | `get_site` returns `Sites project not found` | Current workspace/account cannot resolve the canonical project; no safe deploy or log inspection can start | `get_site` must return project metadata, role, access policy, live URL, and version |
| Public edge | `/` and `/api/mcp/capabilities` return Cloudflare HTTP `403`, `server: cloudflare`, and `__cf_bm` | Strongly consistent with an edge/challenge or Site audience block; origin logs are needed to distinguish the exact rule | Public pages and discovery routes must reach the deployed Worker |
| Sites deployment | Runner is configured with Sites version `156`, but the Sites API cannot currently verify it | Version 156 is a last-known configuration claim, not proof of the current live deployment | A newly saved/deployed version must expose its version ID, number, source SHA, deployment ID, and succeeded URL |
| OAuth/MCP | The old installed plugin can report `connected: true` while authenticated calls fail with `Proofweave could not exchange the browser approval` | A saved browser record is not a live MCP session | Discovery metadata succeeds; unauthenticated MCP returns the correct `401` resource challenge; authenticated read-only authority call succeeds |
| Turso | Policy fingerprint is `3f9e7934a04a22ec`; Runner reports `ledgerHead: null` and `control_plane_verification_failed` | The configured database identity is consistent, but live connectivity/migration verification is not healthy | Both Turso variables are present together, the token is current, the fingerprint matches, and the complete migration ledger verifies |
| Runner | `/healthz` reports revision `bbf4b74f7bd18d3be3985701a954f0f6673cdf9e`, Sites version `156`, `state: degraded`, `executionEnabled: false`, and `trusted_runner_process_configuration_error` | The Runner is stale/degraded but safely fail-closed | It first becomes healthy and paused on the same release identity; execution is enabled only after controlled smoke approval |

At `2026-08-24T06:29:47Z`, representative Cloudflare Ray IDs were:

- `/`: `a3004dfdea66d2a8-FRA`;
- `/api/mcp/capabilities`: `a3004dfdeca730cf-FRA`.

These IDs are incident evidence, not stable configuration. Capture fresh Ray
IDs when reproducing the problem for support.

## Existing repository policy that controls recovery

The repository already makes the following decisions:

1. **One active web/gateway topology.** The active alpha serves the frontend,
   identity, and `/api/mcp` from the Sites deployment. The standalone
   Cloudflare MCP Worker document is explicitly non-current and must not be
   deployed as an incident shortcut.
2. **One writable database authority.** Sites routes and the Render Runner use
   the same Turso/libSQL authority. Sites D1 is not a second writable
   participant database.
3. **Exact release identity.** A production release is not valid unless source,
   Site version, gateway/Runner revision, database fingerprint, migration head,
   image/template identity, and operation modes are collected and agree.
4. **Public read before participant writes.** The homepage, catalog, target,
   demo, and capabilities endpoint must remain truthfully readable in
   `read_only` mode. A failed public preflight prevents reopening contribution
   actions.
5. **Fail closed.** A missing database ledger, mismatched release identity, or
   unverified Runner policy must not be converted into a successful connection,
   Lean result, or receipt.
6. **No token or key deletion as first aid.** Local Agent keys and OAuth state
   are not the cause of a site-wide edge `403`. Reauthorization is appropriate
   only when live status specifically reports an invalid refresh token.

Primary local policy sources:

- `.openai/hosting.json`;
- `config/production-drill-policy.json`;
- `docs/ordinary-user-readiness.md`;
- `docs/turso-zero-cost-control-plane.md`;
- `docs/runner-provider-neutral-deployment.md`;
- `docs/closed-alpha-runbook.md`;
- `scripts/print-release-manifest.mjs`.

## Recovery procedure

### Phase 0 — preserve the incident

Do not delete the Site, clear `.openai/hosting.json`, invalidate every Turso
token, rotate Agent keys, enable Runner execution, or create a new database.
Record:

- UTC timestamp and visitor network;
- exact URL and method;
- response status and current `cf-ray`;
- current OpenAI account/workspace name;
- whether the Site appears in that workspace's Sites list;
- any workspace-admin disablement or public-publishing setting.

### Phase 1 — restore the existing Sites project

In the OpenAI account/workspace that originally created the Site:

1. confirm Sites is enabled for the user's role;
2. confirm public publishing is allowed;
3. locate the Site with the canonical URL and project ID;
4. restore owner/editor access if the creator moved workspaces or lost the
   relevant role;
5. if it is disabled, identify whether `disabled_by` is `workspace_admin` or
   `openai` and use the corresponding admin/support path;
6. do not delete and recreate it—OpenAI documents deletion as permanent.

The exit gate is a successful read of the exact project showing its user role,
status, access mode, live URL, and latest version.

### Phase 2 — inspect before changing production

After project visibility returns:

1. inspect recent failed Worker invocations for `/`,
   `/api/mcp/capabilities`, `/.well-known/*`, and `/api/mcp`;
2. inspect Site audience policy and confirm the intended `public` mode;
3. inspect environment variable presence and revision without printing secret
   values;
4. verify `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are both present;
5. verify release identity variables name the canonical Site project and the
   exact candidate source SHA;
6. compare the live Site version and source SHA with the Runner diagnostics.

Do not rotate Turso merely because the website returns `403`. Rotate only when
the Worker or Runner proves authentication/expiry failure, then update Sites
and Render before invalidating old database tokens.

### Phase 3 — create one exact release candidate

The candidate in this incident is
`1205228045e53e3469cce4f97bedde9dde0b9260`. Before publishing:

1. confirm that SHA is the reviewed source and is pushed to the Site's
   configured branch;
2. under the current release policy, confirm `origin/main` resolves to the same
   SHA—the previous main push was not confirmed because GitHub connectivity
   failed;
3. build and run the repository checks from a clean checkout at that SHA;
4. package only the successful Sites build output from that exact source;
5. save a Site version with that exact `commit_sha` and archive;
6. inspect the saved version's source provenance before deploying it;
7. deploy that saved version to the existing project and wait for terminal
   `succeeded` status.

Never save a version from one SHA and deploy an archive built from another.

### Phase 4 — restore the public read boundary

Test in this order, without credentials:

1. `GET /` returns `200`;
2. `GET /explore` returns `200` and does not require Turso writes;
3. `GET /demo` and `POST /api/demo/verify` retain the distinction between
   signed-evidence re-verification and fresh Lean execution;
4. `GET /.well-known/oauth-authorization-server` returns valid issuer metadata;
5. `GET /.well-known/oauth-protected-resource` returns the MCP resource metadata;
6. `POST /api/mcp` without a token returns the expected `401` challenge, not
   `403`, `500`, or `503`;
7. `GET /api/mcp/capabilities` returns a truthful, release-bound read-only
   projection;
8. run the public ordinary-user smoke with `--expect-mode read_only`.

No browser reconnect is useful before these gates pass.

### Phase 5 — restore authenticated read-only MCP

Install the v0.2.1 plugin package only after the public boundary is healthy.
The updated connection check distinguishes:

- `savedConnection`: local OAuth/installation material exists;
- `liveConnection`: a fresh authenticated read-only authority call succeeds;
- `edge_blocked`: repair Sites/edge access, do not reconnect;
- `refresh_token_invalid`: reconnect once through browser approval;
- `network_unavailable` or `network_timeout`: repair transport and retry.

Then verify, in order:

1. `get_connection_authority` succeeds with no mutation;
2. `list_frontier_problems` succeeds;
3. an expired/revoked installation is rejected;
4. connection status does not claim success from stored credentials alone.

This proves authenticated read access. It does not prove writes, Runner
execution, independent review, or receipt issuance.

### Phase 6 — align Turso and the Runner

Keep `RUNNER_EXECUTION_ENABLED=false`. Update Sites and Render with coordinated
Turso credentials and exact release identity, then require:

- matching database fingerprint `3f9e7934a04a22ec`;
- non-null, repository-matching migration `ledgerHead`;
- Site, gateway, and Runner source/version identity parity;
- approved immutable Runner image, E2B template ID, and build ID;
- Runner `/healthz` healthy in paused mode;
- a fresh release manifest with no missing or mismatched deployment fields.

Only a separately approved controlled smoke may change execution to `true`.
That smoke must bind a terminal isolated Lean run to the exact source, Site
version, migration head, image digest, template build, and Runner signature.

## Acceptance matrix

| Gate | Expected result | Blocks |
| --- | --- | --- |
| Existing Site lookup | Exact canonical project returned; current user is owner/editor | Every deployment action |
| Access policy | Intended audience is public and workspace policy permits public publishing | All anonymous traffic |
| Public pages | Root, catalog, target, and demo are `200` | Product availability |
| OAuth discovery | Both well-known documents are `200` and internally consistent | Browser approval and token exchange |
| MCP challenge | Unauthenticated MCP is `401` with correct protected-resource metadata | MCP clients |
| Capabilities | `200`, truthful `read_only`, exact release diagnostics | Plugin installation and read-only use |
| Authenticated authority | Fresh read-only call succeeds | Claiming MCP is connected |
| Turso ledger | Matching fingerprint and non-null complete migration head | Writes and Runner readiness |
| Release manifest | Source/Sites/Runner/database/image fields all present and equal | Production release claim |
| Runner paused health | Healthy, exact release identity, execution disabled | Controlled Lean smoke |
| Credentialed smoke | Revocation, retries, signatures, isolation, and different-owner review pass | Participant writes and receipts |

## Support escalation payload

If the canonical project remains `NOT_FOUND`, send OpenAI Support or the
workspace owner/admin this minimal payload:

```text
Product: ChatGPT Sites public beta
Site URL: https://proofweave-research.yualex031821.chatgpt.site
Canonical project ID: appgprj_6a54400d01a8819199224b722afae056
Repository: alexyyyander/proofweave
Last known/configured Sites version: 156
Observed UTC time: <fresh timestamp>
Current workspace/account: <name and account email, sent privately>
Sites API result: 404 project_not_found for the exact persisted project ID
Public result: Cloudflare HTTP 403 on / and /api/mcp/capabilities
Fresh CF-RAY values: <root ray>, <capabilities ray>
Requested action: restore owner/editor visibility of the existing project and
confirm whether it is disabled by workspace policy, OpenAI policy, beta limits,
or an account/workspace ownership mapping issue. Do not create a replacement.
```

Do not place Turso tokens, OAuth refresh tokens, Site bypass tokens, Runner wake
tokens, private JWKs, or local Agent private keys in a support ticket.

## Current truthful status

- The local code fix and plugin package are complete and tested.
- The feature branch is pushed at `1205228045e53e3469cce4f97bedde9dde0b9260`.
- A push of that SHA to `origin/main` is not confirmed because GitHub network
  access failed; `origin/main` is still observed locally at
  `3d7cb8c95473bcb45e210f409ea042b26abc14a9`.
- The existing Sites project is not visible to the current Sites connection,
  so no version has been saved or deployed during this recovery attempt.
- The public Site and MCP routes are not healthy while they return `403`.
- MCP must not be described as connected merely because local credentials are
  saved.
- Runner execution remains correctly disabled while database/release
  verification is degraded.

